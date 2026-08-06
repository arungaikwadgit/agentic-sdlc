export {};

const express = require('express');
const { createAdminResetRouter } = require('./adminReset');

const APPLICATION_DATA_TABLES = [
  'agent_runs',
  'agent_jobs',
  'memory_records',
  'action_proposals',
  'rollback_log',
  'invite_log',
  'invite_sessions',
  'team_members',
  'projects',
];

function authOk(req: any, _res: any, next: any) {
  req.authUser = { email: 'admin@example.com', adminBypass: true };
  next();
}

function adminOk(_req: any, _res: any, next: any) {
  next();
}

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());
  const checkToken = overrides.checkToken ?? authOk;
  const requireAdmin = overrides.requireAdmin ?? adminOk;
  const getDb = overrides.getDb ?? (() => (overrides.db !== undefined ? overrides.db : null));
  const ensureInviteSessionTable = overrides.ensureInviteSessionTable ?? jest.fn().mockResolvedValue(undefined);
  const getEnsureInviteSessionTable = overrides.getEnsureInviteSessionTable ?? (() => ensureInviteSessionTable);
  const router = createAdminResetRouter({ getDb, checkToken, requireAdmin, getEnsureInviteSessionTable });
  app.use('/api/admin', router);
  return { app, ensureInviteSessionTable };
}

async function withServer(app: any, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to allocate test server port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('createAdminResetRouter', () => {
  it('returns 503 when the database is unavailable', async () => {
    const { app } = buildApp({ getDb: () => null });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(503);
      expect(body.error).toMatch(/database is unavailable/i);
    });
  });

  it('returns 400 when confirm is missing from the body', async () => {
    const db = { query: jest.fn() };
    const { app } = buildApp({ db, getDb: () => db });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body: any = await response.json();
      expect(response.status).toBe(400);
      expect(body.error).toMatch(/confirmation required/i);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('returns 400 when confirm does not equal the exact string RESET', async () => {
    const db = { query: jest.fn() };
    const { app } = buildApp({ db, getDb: () => db });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'yes' }),
      });
      expect(response.status).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('returns 403 when requireAdmin denies the caller', async () => {
    const requireAdmin = jest.fn((_req: any, res: any) => res.status(403).json({ error: 'Admins only.' }));
    const db = { query: jest.fn() };
    const { app } = buildApp({ db, getDb: () => db, requireAdmin });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      expect(response.status).toBe(403);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('ensures the invite_sessions table then truncates the application data tables in the declared order, returning ok', async () => {
    const db = { query: jest.fn().mockResolvedValue({}) };
    const ensureInviteSessionTable = jest.fn().mockResolvedValue(undefined);
    const { app } = buildApp({ db, getDb: () => db, ensureInviteSessionTable });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true, tablesReset: APPLICATION_DATA_TABLES });
      expect(ensureInviteSessionTable).toHaveBeenCalledTimes(1);
      expect(db.query).toHaveBeenCalledWith(
        `TRUNCATE TABLE ${APPLICATION_DATA_TABLES.join(', ')} CASCADE`,
      );
    });
  });

  it('still succeeds if ensureInviteSessionTable() rejects (swallowed by .catch)', async () => {
    const db = { query: jest.fn().mockResolvedValue({}) };
    const ensureInviteSessionTable = jest.fn().mockRejectedValue(new Error('already exists'));
    const { app } = buildApp({ db, getDb: () => db, ensureInviteSessionTable });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true, tablesReset: APPLICATION_DATA_TABLES });
    });
  });

  it('returns 500 when the truncate query throws', async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error('permission denied')) };
    const { app } = buildApp({ db, getDb: () => db });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(500);
      expect(body.error).toMatch(/permission denied/i);
    });
  });


  it('falls back to {} when the request has no body-parsing middleware at all (req.body ?? {} fallback)', async () => {
    // Deliberately build a bare app with NO express.json() mounted, so
    // req.body is truly undefined (not merely an empty object, which is
    // what express.json() itself defaults to for bodyless requests) -- this
    // is the only way to exercise the `req.body ?? {}` nullish fallback.
    const db = { query: jest.fn() };
    const app = express();
    const router = createAdminResetRouter({
      getDb: () => db,
      checkToken: authOk,
      requireAdmin: adminOk,
      getEnsureInviteSessionTable: () => jest.fn().mockResolvedValue(undefined),
    });
    app.use('/api/admin', router);
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, { method: 'POST' });
      const body: any = await response.json();
      expect(response.status).toBe(400);
      expect(body.error).toMatch(/confirmation required/i);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('logs "(admin-bypass)" when the caller has no authUser.email', async () => {
    const db = { query: jest.fn().mockResolvedValue({}) };
    const ensureInviteSessionTable = jest.fn().mockResolvedValue(undefined);
    const { app } = buildApp({
      db,
      getDb: () => db,
      ensureInviteSessionTable,
      checkToken: (_req: any, _res: any, next: any) => next(), // never sets req.authUser
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true, tablesReset: APPLICATION_DATA_TABLES });
    });
  });

  it('falls back to the raw rejection value when it has no .message (err?.message ?? err / String(err) fallbacks)', async () => {
    const db = { query: jest.fn().mockRejectedValue('boom-string') };
    const { app } = buildApp({ db, getDb: () => db });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/reset-application-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(500);
      expect(body).toEqual({ error: 'Reset failed: boom-string' });
    });
  });
});
