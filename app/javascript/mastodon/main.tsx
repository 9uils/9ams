import { createRoot } from 'react-dom/client';

import { defineMessages } from 'react-intl';

import { showAlert } from 'mastodon/actions/alerts';
import { importFetchedAccount } from 'mastodon/actions/importer';
import { setupBrowserNotifications } from 'mastodon/actions/notifications';
import api, { setActiveAccountToken } from 'mastodon/api';
import { MULTI_ACCOUNT_REQUEST_TIMEOUT } from 'mastodon/api/multi_accounts_constants';
import type { ApiAccountJSON } from 'mastodon/api_types/accounts';
import Mastodon from 'mastodon/containers/mastodon';
import { getAccessToken, me } from 'mastodon/initial_state';
import * as perf from 'mastodon/performance';
import ready from 'mastodon/ready';
import { store } from 'mastodon/store';
import { decryptToken } from 'mastodon/utils/multi_account_crypto';
import {
  deleteEncryptedToken,
  loadEncryptedToken,
} from 'mastodon/utils/multi_account_db';
import {
  clearActiveAccountIdInStorage,
  getActiveAccountIdFromStorage,
  setActiveAccountIdInStorage,
  takeSwitchIntent,
} from 'mastodon/utils/multi_account_storage';

import { isProduction, isDevelopment } from './utils/environment';

const messages = defineMessages({
  switchNotApplied: {
    id: 'account_switcher.switch_not_applied',
    defaultMessage: 'The account could not be switched. Please try again.',
  },
});

// Compares the marker left just before a switch with the account actually
// signed in. A mismatch means the session the server handed back did not
// stick, or stuck as a different account. Passing over it in silence looks to
// the user like clicking did nothing at all.
const reportUnappliedSwitch = (sessionAccountId: string | null): void => {
  const intendedAccountId = takeSwitchIntent();

  if (!intendedAccountId || intendedAccountId === sessionAccountId) {
    return;
  }

  console.error(
    `[MultiAccount] Switch to ${intendedAccountId} did not stick; the session is ${
      sessionAccountId ?? 'signed out'
    }.`,
  );
  store.dispatch(showAlert({ message: messages.switchNotApplied }));
};

// Only the session cookie knows who is signed in.
//
// `MA_ACTIVE_ACCOUNT_ID` is no more than a hint recording the last account
// switched to. It usually agrees with the session, but after an ordinary
// logout followed by signing in as someone else, or after the session
// expires, the pointer and the real session are left out of step.
//
// This code used to trust that pointer: it installed that account's stored
// token as the global bearer and overwrote `meta.me` with it. The moment the
// two disagreed,
//   * the account manager ticked two entries as current (the session account
//     and activeAccountId each claimed it) and refused to switch to either,
//   * the account on screen drifted from the one posts went out as, and from
//     the streaming connection.
// Only a full logout, wiping storage, cleared it.
//
// So the pointer is rewritten to follow the session, and the global token is
// simply the session token the page came with.
async function initializeActiveAccountSession(): Promise<void> {
  const sessionAccountId = me ?? null;

  reportUnappliedSwitch(sessionAccountId);

  if (!sessionAccountId) {
    // Signed out. Leaving the pointer lets it come back at the next login.
    clearActiveAccountIdInStorage();
    return;
  }

  if (getActiveAccountIdFromStorage() !== sessionAccountId) {
    setActiveAccountIdInStorage(sessionAccountId);
  }

  // Normally this is where it ends. The page's `meta.access_token` is
  // guaranteed to belong to this session and `containers/mastodon.jsx` has
  // already installed it. Installing the stored long-lived token on top would
  // add a verify_credentials call to every boot, and split the screen from
  // the requests whenever that token belongs to another account.
  if (getAccessToken()) {
    return;
  }

  // Only when the page carries no token do we fall back to the stored one.
  try {
    const encryptedPayload = await loadEncryptedToken(sessionAccountId);

    if (!encryptedPayload) {
      return;
    }

    const token = await decryptToken(encryptedPayload);

    // Use the stored token only after confirming it really is this
    // account's.
    const response = await api().get<ApiAccountJSON>(
      '/api/v1/accounts/verify_credentials',
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: MULTI_ACCOUNT_REQUEST_TIMEOUT,
      },
    );

    if (response.data.id !== sessionAccountId) {
      // Another account's token is stored in this account's slot.
      console.error(
        `[MultiAccount] Stored token for ${sessionAccountId} belongs to ${response.data.id}; discarding it.`,
      );
      await deleteEncryptedToken(sessionAccountId);
      return;
    }

    setActiveAccountToken(token);
    store.dispatch(importFetchedAccount(response.data));
  } catch (error) {
    console.error(
      'Failed to restore the stored token for the current session:',
      error,
    );
  }
}

function main() {
  perf.start('main()');

  return ready(async () => {
    await initializeActiveAccountSession();

    const mountNode = document.getElementById('mastodon');
    if (!mountNode) {
      throw new Error('Mount node not found');
    }
    const props = JSON.parse(
      mountNode.getAttribute('data-props') ?? '{}',
    ) as Record<string, unknown>;

    const root = createRoot(mountNode);
    root.render(<Mastodon {...props} />);
    store.dispatch(setupBrowserNotifications());

    if (isProduction() && me && 'serviceWorker' in navigator) {
      const { Workbox } = await import('workbox-window');
      const wb = new Workbox(
        isDevelopment() ? '/packs-dev/dev-sw.js?dev-sw' : '/sw.js',
        { type: 'module', scope: '/' },
      );
      let registration;

      try {
        registration = await wb.register();
      } catch (err) {
        console.error(err);
      }

      if (
        registration &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        const registerPushNotifications = await import(
          'mastodon/actions/push_notifications'
        );

        store.dispatch(registerPushNotifications.register());
      }
    }

    perf.stop('main()');
  });
}

// eslint-disable-next-line import/no-default-export
export default main;
