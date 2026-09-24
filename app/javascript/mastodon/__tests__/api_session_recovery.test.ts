import type { InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../initial_state', () => ({
  getAccessToken: () => 'page-session-token',
}));

const rejectWith401 = (config: InternalAxiosRequestConfig) =>
  Promise.reject(
    new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
      data: {},
    }),
  );

const loadApi = async () => {
  vi.resetModules();
  return import('../api');
};

const requestWithDeadSessionToken = async (
  api: Awaited<ReturnType<typeof loadApi>>['default'],
) => {
  await api()
    .get('/api/v1/timelines/home', { adapter: rejectWith401 })
    .catch(() => undefined);
};

const signOutCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => url === '/auth/sign_out');

describe('zombie-session recovery during the add-account popup', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    fetchMock = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs out on a 401 for the page session token by default', async () => {
    const { default: api } = await loadApi();

    await requestWithDeadSessionToken(api);

    expect(signOutCalls(fetchMock)).toHaveLength(1);
  });

  it('does not sign out while the popup has suspended recovery', async () => {
    const { default: api, suspendSessionRecovery } = await loadApi();

    const release = suspendSessionRecovery();
    await requestWithDeadSessionToken(api);

    expect(signOutCalls(fetchMock)).toHaveLength(0);

    release();
  });

  it('recovers again once every suspension is released', async () => {
    const { default: api, suspendSessionRecovery } = await loadApi();

    const releaseFirst = suspendSessionRecovery();
    const releaseSecond = suspendSessionRecovery();

    releaseFirst();
    releaseFirst();
    await requestWithDeadSessionToken(api);
    expect(signOutCalls(fetchMock)).toHaveLength(0);

    releaseSecond();
    await requestWithDeadSessionToken(api);
    expect(signOutCalls(fetchMock)).toHaveLength(1);
  });
});
