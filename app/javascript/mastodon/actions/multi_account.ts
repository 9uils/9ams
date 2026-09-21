import type { AppDispatch, GetState } from '../store';
import type { ApiAccountJSON } from '../api_types/accounts';
import type { EncryptedPayload, MultiAccountEntry } from '../types/multi_account';
import {
  MultiAccountSwitchError,
  SwitchErrorCode,
} from '../types/multi_account';
import api, { setActiveAccountToken, updateCSRFToken } from '../api';
import {
  deleteEncryptedToken,
  loadEncryptedToken,
  saveEncryptedToken,
} from '../utils/multi_account_db';
import { decryptToken, encryptToken } from '../utils/multi_account_crypto';
import { MULTI_ACCOUNT_REQUEST_TIMEOUT } from '../api/multi_accounts_constants';
import { importFetchedAccount } from './importer';
import SwitchLogger from '../utils/switch_logger';
import {
  clearActiveAccountIdIfMatches,
  markSwitchIntent,
  setActiveAccountIdInStorage,
} from '../utils/multi_account_storage';

type CsrfInfo = {
  csrfToken: string;
  formToken?: string;
};

const readInitialCsrfInfo = (): CsrfInfo | null => {
  const csrfToken = document
    .querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
    ?.getAttribute('content')
    ?.trim();

  if (!csrfToken) {
    return null;
  }

  return {
    csrfToken,
    formToken: undefined,
  };
};

let cachedCsrfInfo: CsrfInfo | null = readInitialCsrfInfo();

const setCachedCsrfInfo = (info: CsrfInfo) => {
  cachedCsrfInfo = info;
  updateCSRFToken(info.csrfToken);
};

// Action types
export const MULTI_ACCOUNT_HYDRATE = 'MULTI_ACCOUNT_HYDRATE';
export const MULTI_ACCOUNT_REGISTER = 'MULTI_ACCOUNT_REGISTER';
export const MULTI_ACCOUNT_SWITCH = 'MULTI_ACCOUNT_SWITCH';
export const MULTI_ACCOUNT_REMOVE = 'MULTI_ACCOUNT_REMOVE';
export const MULTI_ACCOUNT_TOUCH = 'MULTI_ACCOUNT_TOUCH';

// Action creators
export const hydrateMultiAccountAction = (payload: {
  activeAccountId: string | null;
  accounts: Record<string, MultiAccountEntry>;
}) => ({
  type: MULTI_ACCOUNT_HYDRATE,
  payload,
});

export const registerAccountAction = (payload: MultiAccountEntry) => ({
  type: MULTI_ACCOUNT_REGISTER,
  payload,
});

export const switchAccountAction = (accountId: string) => ({
  type: MULTI_ACCOUNT_SWITCH,
  payload: { accountId },
});

export const removeAccountAction = (accountId: string) => ({
  type: MULTI_ACCOUNT_REMOVE,
  payload: { accountId },
});

export const touchAccountAction = (accountId: string) => ({
  type: MULTI_ACCOUNT_TOUCH,
  payload: { accountId },
});

// Thunks
export const registerAccount =
  (entry: MultiAccountEntry, token: string) =>
  async (dispatch: AppDispatch) => {
    try {
      const lastUsedAt = new Date().toISOString();
      const entryWithTimestamp = {
        ...entry,
        lastUsedAt,
      };

      // Encrypt and save the token
      const encryptedPayload = await encryptToken(token);
      await saveEncryptedToken(entry.id, encryptedPayload, entryWithTimestamp);

      // Register the account in Redux
      dispatch(registerAccountAction(entryWithTimestamp));
    } catch (error) {
      console.error('Failed to register account:', error);
      throw error;
    }
  };

export const switchAccount =
  (accountId: string) => async (dispatch: AppDispatch, getState: GetState) => {
    const startTime = SwitchLogger.logSwitchAttempt(accountId);
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark(`multi_account_switch_start_${accountId}`);
    }

    // Whether the server session has already changed. A failure after that
    // point cannot be allowed to end quietly.
    let sessionSwitched = false;

    const reloadToMatchSession = () => {
      if (
        typeof window !== 'undefined' &&
        typeof window.location !== 'undefined'
      ) {
        window.location.reload();
      }
    };

    try {
      const state: any = getState();
      const hasGetIn = typeof state?.getIn === 'function';
      const accountsSource = hasGetIn
        ? state.getIn(['multiAccount', 'accounts'])
        : state?.multiAccount?.accounts ?? null;
      const accountExists =
        !!accountsSource &&
        (typeof accountsSource?.has === 'function'
          ? accountsSource.has(accountId)
          : Object.prototype.hasOwnProperty.call(accountsSource, accountId));

      if (!accountExists) {
        throw new MultiAccountSwitchError(
          SwitchErrorCode.ACCOUNT_NOT_FOUND,
          `Account ${accountId} not found`,
        );
      }

      const { refreshSession } = await import('../api/multi_accounts');

      const encryptedPayload = await loadEncryptedToken(accountId);
      if (!encryptedPayload) {
        throw new MultiAccountSwitchError(
          SwitchErrorCode.TOKEN_MISSING,
          '저장된 토큰을 찾을 수 없습니다. 계정을 다시 추가해주세요.',
        );
      }

      let refreshToken: string;
      try {
        refreshToken = await decryptToken(encryptedPayload);
      } catch (decryptError) {
        // NOTE: never call resetCryptoKey() here. Dropping the master key
        // makes the stored tokens of every account permanently
        // undecryptable, not just this one, and retrying is pointless
        // because a new key cannot open old ciphertext. Treat only this
        // account's token as dead and surface a structured error.
        console.error(
          `Failed to decrypt refresh token for account ${accountId}:`,
          decryptError,
        );
        // Do not call `logSwitchFailure` here; the outer catch below always
        // records it once. Calling both files the same failure twice to the
        // server log and to Sentry.
        throw new MultiAccountSwitchError(
          SwitchErrorCode.TOKEN_INVALID,
          '저장된 계정 토큰을 복호화할 수 없습니다. 계정을 다시 추가해주세요.',
        );
      }

      // No cookies are cleared here. This used to wipe `document.cookie`
      // wholesale before calling refresh. The server issues a new session
      // cookie via `reset_session` + `sign_in` anyway, so there was nothing
      // to gain - and when refresh failed the tab was left with no session
      // cookie at all. The screen still drew the old account while the server
      // considered it signed out, so reloading showed the login page, and
      // logging out from there made Devise print `already_signed_out`
      // ("Signed out successfully."). That is what made a single 422 look
      // like the account had been wiped. The server cleans up the rest.

      const entryRecord =
        typeof accountsSource?.get === 'function'
          ? accountsSource.get(accountId)
          : accountsSource?.[accountId];
      const entry: MultiAccountEntry | null = entryRecord
        ? entryRecord.toJS
          ? entryRecord.toJS()
          : entryRecord
        : null;

      let currentEncryptedPayload: EncryptedPayload | null = encryptedPayload;

      const refreshResponse = await (async () => {
        try {
          const response = await refreshSession(refreshToken);
          const csrfHeader =
            response.headers?.['x-csrf-token'] ??
            (response.headers?.['X-CSRF-Token'] as string | undefined);
          if (typeof csrfHeader === 'string' && csrfHeader.trim().length > 0) {
            setCachedCsrfInfo({
              csrfToken: csrfHeader.trim(),
              formToken: undefined,
            });
          }
          return response;
        } catch (refreshError) {
          const status = (refreshError as any)?.response?.status as
            | number
            | undefined;
          const serverMessage = (refreshError as any)?.response?.data?.error as
            | string
            | undefined;

          console.warn(
            `Failed to refresh session for account ${accountId}:`,
            refreshError,
          );

          // Only a dead stored token earns "add the account again". 401 means
          // revoked or invalid; 422 means `ensure_refresh_token_valid!`
          // refused it as not a multi-account token. Clicking again gives the
          // same answer either way, so drop the dead token here. Otherwise
          // the same error repeats forever, because `ensureAccountStored`
          // leaves an account alone once a token exists. Dropped, it refills
          // itself with a usable token the next time that account is this
          // browser's session.
          if (status === 401 || status === 422) {
            try {
              await deleteEncryptedToken(accountId);
            } catch (deleteError) {
              console.error(
                `Failed to drop the dead token for account ${accountId}:`,
                deleteError,
              );
            }

            throw new MultiAccountSwitchError(
              SwitchErrorCode.TOKEN_INVALID,
              '저장된 계정 토큰을 쓸 수 없습니다. 계정을 다시 로그인하여 추가해주세요.',
            );
          }

          // Everything else is not a token problem. 403 means the feature is
          // off (`refresh_flow`), the user is outside the rollout, or the
          // account is suspended; 429 is rate limiting; 404 means the account
          // is gone. Folding these into "the token expired" would recommend
          // deleting a perfectly healthy entry.
          //
          // The server's wording is not shown as-is: it is English and mixes
          // in developer-facing text such as "refresh_token is required".
          // Whatever is needed to diagnose is already in the `console.warn`
          // above.
          const rejectionMessage = (() => {
            if (status === 429) {
              return '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.';
            }

            if (status === 403) {
              return '지금은 이 계정으로 전환할 수 없습니다. 계정이 정지되었거나 계정 전환이 꺼져 있을 수 있습니다.';
            }

            if (status === 404) {
              return '그 계정을 찾을 수 없습니다. 삭제되었거나 이전되었을 수 있습니다.';
            }

            return '계정 전환에 실패했습니다. 잠시 후 다시 시도해주세요.';
          })();

          // What the server said stays in the console.
          if (serverMessage) {
            console.warn(`[MultiAccount] refresh rejected: ${serverMessage}`);
          }

          throw new MultiAccountSwitchError(
            SwitchErrorCode.REFRESH_REJECTED,
            rejectionMessage,
          );
        }
      })();

      // From here on the server session has already changed: `refresh` ran
      // `reset_session` + `sign_in`. Whatever happens next, this page is
      // holding somebody else's session, so merely throwing would leave the
      // screen (old account) and the session (new account) split apart - and
      // the CSRF token is already void. The same holds if the response came
      // back without a token.
      sessionSwitched = true;

      const sessionToken = refreshResponse?.data?.token as string | undefined;

      if (!sessionToken) {
        throw new MultiAccountSwitchError(
          SwitchErrorCode.SESSION_TOKEN_MISSING,
          '세션 토큰을 발급받지 못했습니다.',
        );
      }

      setActiveAccountToken(sessionToken);

      // What counts is the token's real owner. Records can exist where the
      // key (accountId) and the owner disagree; left alone, clicking that
      // entry drags in somebody else's session every time. Below, the
      // mismatched key is deleted and the record rewritten under the
      // confirmed id.
      const updateEntryMetadata = async (
        accountData: ApiAccountJSON | null,
      ): Promise<void> => {
        if (!accountData) {
          return;
        }

        const resolvedId = accountData.id ?? accountId;
        const normalizedEntry: MultiAccountEntry = {
          id: resolvedId,
          acct:
            accountData.acct ??
            accountData.username ??
            entry?.acct ??
            resolvedId,
          displayName:
            accountData.display_name ??
            accountData.username ??
            entry?.displayName ??
            '',
          avatar:
            accountData.avatar ??
            accountData.avatar_static ??
            entry?.avatar ??
            '',
          encryptedTokenRef: entry?.encryptedTokenRef ?? '',
          lastUsedAt: new Date().toISOString(),
        };

        if (resolvedId !== accountId) {
          console.error(
            `[MultiAccount] Stored token for ${accountId} belongs to ${resolvedId}; repairing the stored entry.`,
          );

          try {
            await deleteEncryptedToken(accountId);
          } catch (deleteError) {
            console.error(
              `Failed to drop the mismatched entry for account ${accountId}:`,
              deleteError,
            );
          }

          dispatch(removeAccountAction(accountId));
          clearActiveAccountIdIfMatches(accountId);
        }

        dispatch(registerAccountAction(normalizedEntry));

        if (currentEncryptedPayload) {
          try {
            await saveEncryptedToken(
              resolvedId,
              currentEncryptedPayload,
              normalizedEntry,
            );
          } catch (saveError) {
            console.error(
              `Failed to update stored metadata for account ${resolvedId}:`,
              saveError,
            );
          }
        }
      };

      const verifiedAccount = await (async () => {
        try {
          const response = await api().get('/api/v1/accounts/verify_credentials', {
            timeout: MULTI_ACCOUNT_REQUEST_TIMEOUT,
          });
          dispatch(importFetchedAccount(response.data));
          return response.data as ApiAccountJSON;
        } catch (verifyError) {
        const status = (verifyError as any)?.response?.status;
        const errorDescription =
          (verifyError as any)?.response?.data?.error_description ?? '';

        const isInvalidToken =
          status === 401 ||
          (status === 403 &&
            typeof errorDescription === 'string' &&
            errorDescription.toLowerCase().includes('invalid_token'));

        if (isInvalidToken) {
          throw new Error(
            '저장된 계정 토큰이 만료되었거나 사용할 수 없습니다. 계정을 다시 로그인하여 추가해주세요.',
          );
        }

        console.error(
          `Failed to verify credentials for account ${accountId}:`,
          verifyError,
        );
        throw verifyError;
      }
      })();

      await updateEntryMetadata(verifiedAccount);

      // The session already changed on the server. The pointer has to name
      // the account actually signed in, not the one that was asked for.
      const activatedAccountId = verifiedAccount?.id ?? accountId;

      setActiveAccountIdInStorage(activatedAccountId);
      // The marker records the account the user clicked. If after the reload
      // the session is not that account - the cookie did not stick, or the
      // stored token belonged to someone else and signed us in as them -
      // `main.tsx` says so. Previously the screen simply came back unchanged
      // with no word, which looked like clicking did nothing.
      markSwitchIntent(accountId);
      SwitchLogger.logSwitchSuccess(activatedAccountId, startTime);

      reloadToMatchSession();

      return sessionToken;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      SwitchLogger.logSwitchFailure(accountId, errorMessage, startTime);
      console.error('Failed to switch account:', error);

      if (sessionSwitched) {
        // A failure after the session already changed. Recording the account
        // the user clicked and reloading keeps the screen in step with
        // whatever session we ended up in, and `main.tsx` reports it when
        // that turns out to be a different account.
        markSwitchIntent(accountId);
        reloadToMatchSession();
        return null;
      }

      throw error;
    }
  };

export const removeAccount =
  (accountId: string) => async (dispatch: AppDispatch, getState: GetState) => {
    try {
      const state: any = getState();
      const wasActive =
        state?.getIn?.(['multiAccount', 'activeAccountId']) === accountId;

      // Delete the encrypted token
      await deleteEncryptedToken(accountId);

      // Remove from Redux state
      dispatch(removeAccountAction(accountId));

      if (wasActive) {
        setActiveAccountToken(null);
      }

      clearActiveAccountIdIfMatches(accountId);
    } catch (error) {
      console.error('Failed to remove account:', error);
      throw error;
    }
  };
