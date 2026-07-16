/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getAuthHeader: vi.fn().mockResolvedValue({ Authorization: 'Bearer session' }),
  getProxyToken: vi.fn().mockReturnValue(''),
}));
vi.mock('@/services/api', () => auth);

import { getDashboardViewPreference, setDashboardViewPreference } from '@/services/userPreferencesApi';

describe('user preferences API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads and saves dashboard view through authenticated backend APIs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ dashboardView: 'table' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ dashboardView: 'tiles' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDashboardViewPreference()).resolves.toBe('table');
    await expect(setDashboardViewPreference('tiles')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/user-preferences/dashboard-view');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT' });
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ dashboardView: 'tiles' }));
  });
});
