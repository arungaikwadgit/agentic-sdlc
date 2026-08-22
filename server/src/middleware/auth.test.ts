/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Unit tests for the app-admin allowlist check (isAppAdmin/requireAppAdmin).
 * This is the first test in server/ (Wave 1 remediation item 3 -- see
 * docs/architecture/step4-specs-wave1-draft.md). Deliberately scoped to the
 * one piece of auth.ts that's pure logic with no network calls: ADMIN_EMAIL_ALLOWLIST
 * is read from process.env at module-load time (see auth.ts), so each test
 * resets the module registry and re-requires it after setting the env var,
 * rather than mocking Supabase to exercise requireAuth/requireProjectRole's
 * DB-backed paths -- that's real integration-test territory (needs a test
 * database), tracked separately, not faked here with a mock that could drift
 * from the real team_members-based RBAC logic.
 */

describe('isAppAdmin', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
  });

  it('returns false when ADMIN_EMAIL_ALLOWLIST is unset', () => {
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
    const { isAppAdmin } = require('./auth') as typeof import('./auth');
    expect(isAppAdmin('anyone@example.com')).toBe(false);
  });

  it('returns true for an email in the allowlist, case-insensitively', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com, second@example.com';
    const { isAppAdmin } = require('./auth') as typeof import('./auth');
    expect(isAppAdmin('Admin@Example.com')).toBe(true);
    expect(isAppAdmin('second@example.com')).toBe(true);
  });

  it('returns false for an email not in the allowlist', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com';
    const { isAppAdmin } = require('./auth') as typeof import('./auth');
    expect(isAppAdmin('not-admin@example.com')).toBe(false);
  });

  it('returns false for null/undefined email', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com';
    const { isAppAdmin } = require('./auth') as typeof import('./auth');
    expect(isAppAdmin(null)).toBe(false);
    expect(isAppAdmin(undefined)).toBe(false);
  });
});

describe('requireAppAdmin', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
  });

  function mockRes() {
    const res: { statusCode?: number; body?: unknown; status: jest.Mock; json: jest.Mock } = {
      status: jest.fn(function (this: unknown, code: number) {
        res.statusCode = code;
        return res as unknown;
      }) as unknown as jest.Mock,
      json: jest.fn(function (this: unknown, body: unknown) {
        res.body = body;
        return res as unknown;
      }) as unknown as jest.Mock,
    };
    return res;
  }

  it('calls next() when the requester is an app admin', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com';
    const { requireAppAdmin } = require('./auth') as typeof import('./auth');
    const req = { user: { id: 'u1', email: 'admin@example.com' } } as unknown as Parameters<typeof requireAppAdmin>[0];
    const res = mockRes() as unknown as Parameters<typeof requireAppAdmin>[1];
    const next = jest.fn();

    requireAppAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 and does not call next() when the requester is not an app admin', () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com';
    const { requireAppAdmin } = require('./auth') as typeof import('./auth');
    const req = { user: { id: 'u2', email: 'nobody@example.com' } } as unknown as Parameters<typeof requireAppAdmin>[0];
    const res = mockRes() as unknown as Parameters<typeof requireAppAdmin>[1];
    const next = jest.fn();

    requireAppAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
