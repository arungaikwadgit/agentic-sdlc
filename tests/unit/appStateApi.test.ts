import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthHeaderMock = vi.fn();
const getProxyTokenMock = vi.fn();

vi.mock('../../frontend/src/services/api', () => ({
  getAuthHeader: (...args: unknown[]) => getAuthHeaderMock(...args),
  getProxyToken: (...args: unknown[]) => getProxyTokenMock(...args),
}));

import { getAppConfigValue, setAppConfigValue } from '../../frontend/src/services/appStateApi';

describe('appStateApi auth behavior', () => {
  beforeEach(() => {
    getAuthHeaderMock.mockReset();
    getProxyTokenMock.mockReset();
    getAuthHeaderMock.mockResolvedValue({});
    getProxyTokenMock.mockReturnValue('local-dev-proxy-token');
    global.fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      text: async () => JSON.stringify({ value: 'dark', ok: true }),
    })) as unknown as typeof fetch;
  });

  it('uses X-API-Token for app-state reads when Authorization is unavailable (TS-auth-4)', async () => {
    await getAppConfigValue('app:theme', 'fallback-theme');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/app-state/config/app%3Atheme'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-API-Token': 'local-dev-proxy-token',
        }),
      }),
    );
  });

  it('prefers Authorization and skips X-API-Token when a session header exists (TS-auth-5)', async () => {
    getAuthHeaderMock.mockResolvedValue({ Authorization: 'Bearer jwt-123' });

    await setAppConfigValue('app:theme', 'light');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/app-state/config/app%3Atheme'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-123',
          'Content-Type': 'application/json',
        }),
      }),
    );

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-API-Token']).toBeUndefined();
  });
});