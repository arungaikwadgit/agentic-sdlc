export {};

const express = require('express');
const { createUserPreferenceRouter } = require('./userPreferenceRoutes');

function authOk(req: any, _res: any, next: any) {
  req.authUser = { email: 'test@example.com', user: { id: 'u1' } };
  next();
}

function authReject(_req: any, res: any) {
  return res.status(401).json({ error: 'unauthorized' });
}

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());
  const checkToken = overrides.checkToken ?? authOk;
  const requireAppStateDb = overrides.requireAppStateDb ?? (async () => true);
  const getDb = overrides.getDb ?? (() => (overrides.db !== undefined ? overrides.db : null));
  const router = createUserPreferenceRouter({ getDb, checkToken, requireAppStateDb });
  app.use('/api/user-preferences', router);
  return app;
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

describe('createUserPreferenceRouter', () => {
  describe('GET /dashboard-view', () => {
    it('returns the saved dashboardView preference', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [{ preferences: { dashboardView: 'table' } }] }) };
      const app = buildApp({ db });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`);
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({ dashboardView: 'table' });
        expect(db.query).toHaveBeenCalledWith(
          'SELECT preferences FROM user_preferences WHERE user_key = $1',
          ['auth:u1'],
        );
      });
    });

    it('defaults to tiles when no row is saved for this user', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      const app = buildApp({ db });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`);
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({ dashboardView: 'tiles' });
      });
    });

    it('defaults to tiles when the saved value is not a recognized view', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [{ preferences: { dashboardView: 'bogus' } }] }) };
      const app = buildApp({ db });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`);
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({ dashboardView: 'tiles' });
      });
    });

    it('returns 401 when checkToken rejects the request (auth-failure path)', async () => {
      const app = buildApp({ checkToken: authReject });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`);
        expect(response.status).toBe(401);
      });
    });

    it('returns the requireAppStateDb rejection (pass-through gate: reject branch)', async () => {
      const db = { query: jest.fn() };
      const requireAppStateDb = jest.fn(async (res: any) => {
        res.status(500).json({ error: 'App state database is unavailable.' });
        return false;
      });
      const app = buildApp({ db, requireAppStateDb });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`);
        const body: any = await response.json();
        expect(response.status).toBe(500);
        expect(body.error).toMatch(/unavailable/i);
        expect(db.query).not.toHaveBeenCalled();
      });
    });

    it('returns 503 when getDb() resolves to no pool', async () => {
      const app = buildApp({ getDb: () => null });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`);
        expect(response.status).toBe(503);
      });
    });

    it('returns 500 when the query throws', async () => {
      const db = { query: jest.fn().mockRejectedValue(new Error('connection reset')) };
      const app = buildApp({ db });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`);
        const body: any = await response.json();
        expect(response.status).toBe(500);
        expect(body.error).toMatch(/could not load/i);
      });
    });
  });

  describe('PUT /dashboard-view', () => {
    it('saves and returns the new dashboardView value', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [{ preferences: { dashboardView: 'table' } }] }) };
      const app = buildApp({ db });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dashboardView: 'table' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({ dashboardView: 'table' });
        expect(db.query).toHaveBeenCalled();
      });
    });

    it('rejects an invalid dashboardView value with 400 and never touches the db', async () => {
      const db = { query: jest.fn() };
      const app = buildApp({ db });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dashboardView: 'bogus' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/tiles or table/i);
        expect(db.query).not.toHaveBeenCalled();
      });
    });

    it('returns 401 when checkToken rejects the request', async () => {
      const app = buildApp({ checkToken: authReject });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dashboardView: 'table' }),
        });
        expect(response.status).toBe(401);
      });
    });

    it('returns the requireAppStateDb rejection (pass-through gate: reject branch)', async () => {
      const db = { query: jest.fn() };
      const requireAppStateDb = jest.fn(async (res: any) => {
        res.status(500).json({ error: 'App state database is unavailable.' });
        return false;
      });
      const app = buildApp({ db, requireAppStateDb });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dashboardView: 'table' }),
        });
        expect(response.status).toBe(500);
        expect(db.query).not.toHaveBeenCalled();
      });
    });

    it('returns 503 when getDb() resolves to no pool (checked after validation)', async () => {
      const app = buildApp({ getDb: () => null });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dashboardView: 'table' }),
        });
        expect(response.status).toBe(503);
      });
    });

    it('returns 500 when the write query throws', async () => {
      const db = { query: jest.fn().mockRejectedValue(new Error('write failed')) };
      const app = buildApp({ db });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/user-preferences/dashboard-view`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dashboardView: 'table' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(500);
        expect(body.error).toMatch(/could not save/i);
      });
    });
  });
});
