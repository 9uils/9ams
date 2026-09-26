const STORAGE_KEY = 'MA_ACTIVE_ACCOUNT_ID';

const canUseStorage = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
};

export const setActiveAccountIdInStorage = (accountId: string): void => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, accountId);
  } catch (error) {
    console.warn('Failed to persist active account id:', error);
  }
};

export const getActiveAccountIdFromStorage = (): string | null => {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to read active account id:', error);
    return null;
  }
};

export const clearActiveAccountIdInStorage = (): void => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear active account id:', error);
  }
};

// Carries "which account we meant to reach" across the reload that follows a
// switch. It only has to survive inside the tab, so sessionStorage.
const SWITCH_INTENT_KEY = 'MA_SWITCH_INTENT';

export const markSwitchIntent = (accountId: string): void => {
  try {
    window.sessionStorage.setItem(SWITCH_INTENT_KEY, accountId);
  } catch {
    // Without sessionStorage we only lose the check; the switch goes on.
  }
};

export const takeSwitchIntent = (): string | null => {
  try {
    const value = window.sessionStorage.getItem(SWITCH_INTENT_KEY);
    window.sessionStorage.removeItem(SWITCH_INTENT_KEY);
    return value;
  } catch {
    return null;
  }
};

export const clearActiveAccountIdIfMatches = (accountId: string): void => {
  if (!canUseStorage()) return;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === accountId) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Failed to clear active account id for account removal:', error);
  }
};
import type { Store } from '@reduxjs/toolkit';

import { hydrateMultiAccountAction } from '../actions/multi_account';
import { me } from '../initial_state';
import type { MultiAccountEntry } from '../types/multi_account';

import { loadAllEntries } from './multi_account_db';

/**
 * Hydrate the Redux store with data from IndexedDB
 *
 * The global token is never touched here. This function used to decrypt the
 * stored token and call `setActiveAccountToken` as well, but the boot code in
 * `main.tsx` did the same thing, so whichever finished last won. When the two
 * pointed at different accounts, the account posts went out as changed on
 * every reload. Exactly one place decides the token: `main.tsx`.
 */
export const hydrateStore = async (store: Store) => {
  try {
    const storedEntries = await loadAllEntries();

    // A record's IndexedDB key and its entry `id` can disagree (the key used
    // when storing differed from the account the server returned). The
    // reducer keys by `id`, so follow `id` here too - otherwise the same
    // account shows as two rows, or clicking one looks up an account that is
    // not there.
    const accounts: Record<string, MultiAccountEntry> = {};

    Object.entries(storedEntries).forEach(([key, entry]) => {
      if (!entry) {
        return;
      }

      const id = entry.id || key;
      accounts[id] = { ...entry, id };
    });

    // The account the session decided is the active one. Synthesise an entry
    // when none is stored.
    const sessionAccountId = me ?? null;

    if (sessionAccountId && !accounts[sessionAccountId]) {
      const state: any = store.getState?.() ?? null;
      const currentAccount = state?.getIn?.(['accounts', sessionAccountId]);

      const getField = (record: any, key: string) => {
        if (!record) {
          return undefined;
        }

        if (typeof record.get === 'function') {
          return record.get(key);
        }

        return record[key];
      };

      accounts[sessionAccountId] = {
        id: sessionAccountId,
        acct:
          getField(currentAccount, 'acct') ??
          getField(currentAccount, 'username') ??
          '',
        displayName:
          getField(currentAccount, 'display_name') ??
          getField(currentAccount, 'username') ??
          '',
        avatar:
          getField(currentAccount, 'avatar') ??
          getField(currentAccount, 'avatar_static') ??
          '',
        encryptedTokenRef: '',
        lastUsedAt: new Date().toISOString(),
      };
    }

    store.dispatch(
      hydrateMultiAccountAction({
        activeAccountId: sessionAccountId,
        accounts,
      }),
    );
  } catch (error) {
    console.error('Failed to hydrate multi-account store:', error);
  }
};
