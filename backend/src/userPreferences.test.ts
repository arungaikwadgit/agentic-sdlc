/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
const { createUserPreferenceHandlers, actorKeyForRequest } = require('./userPreferences');

function recorder() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

describe('user preference persistence', () => {
  it('derives a stable non-PII actor key', () => {
    expect(actorKeyForRequest({ authUser: { user: { id: '11111111-1111-4111-8111-111111111111' } } }))
      .toBe('auth:11111111-1111-4111-8111-111111111111');
    const emailKey = actorKeyForRequest({ authUser: { email: 'Owner@Example.com' } });
    expect(emailKey).toMatch(/^email:[a-f0-9]{64}$/);
    expect(emailKey).not.toContain('owner@example.com');
  });

  it('loads tiles as the default and persists table with parameterized SQL', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ preferences: { dashboardView: 'table' } }] })
    };
    const handlers = createUserPreferenceHandlers({ getDb: () => db });
    const req = { authUser: { user: { id: '11111111-1111-4111-8111-111111111111' } }, body: { dashboardView: 'table' } };

    const getRes = recorder();
    await handlers.getDashboardView(req, getRes);
    expect(getRes.body).toEqual({ dashboardView: 'tiles' });

    const putRes = recorder();
    await handlers.putDashboardView(req, putRes);
    expect(putRes.body).toEqual({ dashboardView: 'table' });
    const writeCall = db.query.mock.calls[1];
    expect(writeCall[0]).toContain('$1');
    expect(writeCall[0]).toContain('$2');
    expect(writeCall[1]).toEqual(['auth:11111111-1111-4111-8111-111111111111', 'table']);
  });

  it('rejects invalid values and unavailable Postgres', async () => {
    const invalid = createUserPreferenceHandlers({ getDb: () => ({ query: jest.fn() }) });
    const invalidRes = recorder();
    await invalid.putDashboardView({ authUser: { adminBypass: true }, body: { dashboardView: 'cards' } }, invalidRes);
    expect(invalidRes.statusCode).toBe(400);

    const unavailable = createUserPreferenceHandlers({ getDb: () => null });
    const unavailableRes = recorder();
    await unavailable.getDashboardView({ authUser: { adminBypass: true } }, unavailableRes);
    expect(unavailableRes.statusCode).toBe(503);
  });
});

export {};
