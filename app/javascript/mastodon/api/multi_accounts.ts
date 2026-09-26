import api from 'mastodon/api';

// The timeout constant lives in a separate dependency-free module and is
// re-exported here. This module is dynamic-import only (a lazy chunk), so a
// caller that statically imports it just to reach the constant would break
// code splitting. Static importers must use the constants file.
export { MULTI_ACCOUNT_REQUEST_TIMEOUT } from './multi_accounts_constants';
import { MULTI_ACCOUNT_REQUEST_TIMEOUT } from './multi_accounts_constants';

interface AuthorizeEntryResponse {
  authorize_url: string;
  state: string;
  nonce: string;
}

interface FetchAuthorizeEntryOptions {
  forceLogin?: boolean;
}

interface ConsumePayload {
  state: string;
  nonce: string;
  authorization_code: string;
}

interface ConsumeResponse {
  token: string;
  account: {
    id: string;
    acct: string;
    username: string;
    display_name: string;
    avatar: string;
    avatar_static: string;
  };
  scope: string;
  expires_at: string | null;
  state: string;
  nonce: string;
}

export const fetchAuthorizeEntry = async (
  options: FetchAuthorizeEntryOptions = {},
): Promise<AuthorizeEntryResponse> => {
  const { forceLogin } = options;
  const response = await api().get<AuthorizeEntryResponse>('/multi_accounts/entry', {
    params: {
      force_login: typeof forceLogin === 'boolean' ? forceLogin : undefined,
    },
    timeout: MULTI_ACCOUNT_REQUEST_TIMEOUT,
  });
  return response.data;
};

export const consumeAuthorizationCode = async (
  payload: ConsumePayload,
): Promise<ConsumeResponse> => {
  try {
    const url = '/api/v1/multi_accounts/consume';
    
    // The consume endpoint verifies by state/nonce, so it is called without
    // an Authorization header.
    const response = await api(false).post<ConsumeResponse>(
      url,
      { payload },
      { timeout: MULTI_ACCOUNT_REQUEST_TIMEOUT },
    );
    return response.data;
  } catch (error: any) {
    console.error('consumeAuthorizationCode error:', {
      url: error?.config?.url,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      data: error?.response?.data,
      error: error,
    });
    
    // Handle API errors with better messages
    if (error?.response?.status === 401) {
      const errorMessage = error?.response?.data?.error || '인증에 실패했습니다. 다시 시도해주세요.';
      throw new Error(errorMessage);
    } else if (error?.response?.status === 400) {
      const errorMessage = error?.response?.data?.error || '잘못된 요청입니다.';
      throw new Error(errorMessage);
    } else if (error?.response?.status === 404) {
      const errorMessage = error?.response?.data?.error || `API 엔드포인트를 찾을 수 없습니다. (${error?.config?.url})`;
      throw new Error(errorMessage);
    } else if (error?.response?.status === 422) {
      const errorMessage = error?.response?.data?.error || '요청을 처리할 수 없습니다.';
      throw new Error(errorMessage);
    } else if (error?.response) {
      const errorMessage = error?.response?.data?.error || `서버 오류가 발생했습니다 (${error.response.status})`;
      throw new Error(errorMessage);
    } else {
      throw new Error(error?.message || '계정 추가 중 오류가 발생했습니다. 네트워크 연결을 확인해주세요.');
    }
  }
};

interface RestorePayload {
  state: string;
  nonce: string;
}

export const restoreMultiAccountSession = async (
  payload: RestorePayload,
): Promise<void> => {
  await api(false).post('/multi_accounts/session/restore', { payload }, {
    timeout: MULTI_ACCOUNT_REQUEST_TIMEOUT,
  });
};

export interface RefreshSessionResponse {
  token: string;
  account: {
    id: string;
    acct: string;
    username: string;
    display_name: string;
    avatar: string;
    avatar_static: string;
  };
  scope: string;
  expires_at: string | null;
}

// `/api/v1/multi_accounts/refresh_token` and `session/refresh` return the
// same shape.
export type MintedSwitchToken = RefreshSessionResponse;

// Mints a fresh long-lived token that can be used for account switching.
//
// The page's session token (`meta.access_token`) is created by
// `SessionActivation` on the web superapp with `long_lived`, `purpose` and
// `multi_account` all unset. `ensure_refresh_token_valid!` rejects those with
// a 422, so storing one means every later switch to that account reports
// "the stored token has expired or cannot be used" - the token is not dead,
// it is the wrong kind. This endpoint is the only place that mints a token
// usable for switching.
//
// The server issues the token to whoever owns the bearer currently installed.
// If that is not `expectedAccountId` the token belongs to someone else, so we
// return null - writing it down would sign the user into another account
// every time they click that entry. HTTP errors are thrown.
export const mintSwitchToken = async (
  expectedAccountId: string,
): Promise<MintedSwitchToken | null> => {
  const response = await api().post<MintedSwitchToken>(
    '/api/v1/multi_accounts/refresh_token',
    undefined,
    { timeout: MULTI_ACCOUNT_REQUEST_TIMEOUT },
  );

  const { token, account } = response.data;

  if (!token || !account.id) {
    console.error('[MultiAccount] refresh_token returned no usable token.');
    return null;
  }

  if (account.id !== expectedAccountId) {
    console.error(
      `[MultiAccount] refresh_token returned a token for ${account.id}, expected ${expectedAccountId}; discarding it.`,
    );
    return null;
  }

  return response.data;
};

export const refreshSession = async (refreshToken: string) => {
  return api(false).post<RefreshSessionResponse>(
    '/api/v1/multi_accounts/session/refresh',
    {
      refresh_token: refreshToken,
    },
    {
      headers: {
        Accept: 'application/json',
      },
      timeout: MULTI_ACCOUNT_REQUEST_TIMEOUT,
    },
  );
};

