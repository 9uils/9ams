import { rootReducer } from '../index';
import metaReducer from '../meta';
import {
  hydrateMultiAccountAction,
  switchAccountAction,
} from '../../actions/multi_account';
import { fromJS } from 'immutable';

import { RESET_ALL, STORE_HYDRATE } from '../../actions/store';

describe('rootReducer', () => {
  it('preserves multiAccount state when RESET_ALL is dispatched', () => {
    const baseState = rootReducer(undefined, { type: '@@INIT' });

    const hydratedState = rootReducer(
      baseState,
      hydrateMultiAccountAction({
        activeAccountId: null,
        accounts: {
          '1': {
            id: '1',
            acct: '@demo',
            displayName: 'Demo User',
            avatar: '',
            encryptedTokenRef: '',
            lastUsedAt: new Date().toISOString(),
          },
        },
      }),
    );

    const switchedState = rootReducer(hydratedState, switchAccountAction('1'));

    const resetState = rootReducer(switchedState, { type: RESET_ALL });

    expect(resetState.getIn(['multiAccount', 'activeAccountId'])).toEqual('1');
    expect(resetState.getIn(['multiAccount', 'accounts']).has('1')).toBe(true);
  });

  // Regression guard. The multi-account boot code used to overwrite `meta.me`
  // with the "last switched account" pointer from localStorage. Whenever the
  // server session held a different account, the account manager ticked two
  // entries as current and refused to switch to either, and the account on
  // screen drifted from the one posts went out as. Only the session decides
  // `me`.
  it('never lets a client-side action rewrite meta.me', () => {
    const hydrated = metaReducer(undefined, {
      type: STORE_HYDRATE,
      state: fromJS({
        meta: { me: '1' },
        role: { permissions: '0' },
      }),
    });

    expect(hydrated.get('me')).toEqual('1');

    const after = metaReducer(hydrated, {
      type: 'MULTI_ACCOUNT_SET_ACTIVE_ACCOUNT_META',
      payload: { accountId: '2' },
    });

    expect(after.get('me')).toEqual('1');
  });
});

