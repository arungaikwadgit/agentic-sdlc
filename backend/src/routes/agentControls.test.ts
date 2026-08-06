export {};

const express = require('express');
const { createAgentControlsRouter, resolveAgentKillSwitch } = require('./agentControls');

function adminOk(_req: any, _res: any, next: any) {
  next();
}

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());
  const checkToken = overrides.checkToken ?? ((req: any, _res: any, next: any) => { req.authUser = { email: 'admin@example.com' }; next(); });
  const requireAdmin = overrides.requireAdmin ?? adminOk;
  const getDb = overrides.getDb ?? (() => (overrides.db !== undefined ? overrides.db : null));
  const router = createAgentControlsRouter({ getDb, checkToken, requireAdmin });
  app.use('/api/agent-controls', router);
  return { app };
}

async function withServer(app: any, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to allocate test server port');
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('createAgentControlsRouter', () => {
  it('returns 503 on every route when the database is unavailable', async () => {
    const { app } = buildApp({ getDb: () => null });
    await withServer(app, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/agent-controls/global`)).status).toBe(503);
      expect((await fetch(`${baseUrl}/api/agent-controls/project/p1`)).status).toBe(503);
      expect((await fetch(`${baseUrl}/api/agent-controls/global/aiGovernance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })).status).toBe(503);
    });
  });

  it('returns 403 when requireAdmin denies the caller (every route is admin-only)', async () => {
    const requireAdmin = (_req: any, res: any) => res.status(403).json({ error: 'Admins only.' });
    const db = { query: jest.fn() };
    const { app } = buildApp({ db, getDb: () => db, requireAdmin });
    await withServer(app, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/agent-controls/global`)).status).toBe(403);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('upserts a global disable flag', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const { app } = buildApp({ db, getDb: () => db });
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/agent-controls/global/aiGovernance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: true }),
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body).toEqual({ ok: true, agentId: 'aiGovernance', disabled: true });
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO agent_global_settings'), ['aiGovernance', true, 'admin@example.com']);
    });
  });

  it('rejects an empty agentId on the global route', async () => {
    const db = { query: jest.fn() };
    const { app } = buildApp({ db, getDb: () => db });
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/agent-controls/global/%20`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: true }),
      });
      expect(res.status).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('upserts a per-project override', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const { app } = buildApp({ db, getDb: () => db });
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/agent-controls/project/proj-1/aiGovernance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: false }),
      });
      expect(res.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO project_agent_overrides'),
        ['proj-1', 'aiGovernance', false, 'admin@example.com'],
      );
    });
  });

  it('clears a per-project override via DELETE', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const { app } = buildApp({ db, getDb: () => db });
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/agent-controls/project/proj-1/aiGovernance`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM project_agent_overrides'),
        ['proj-1', 'aiGovernance'],
      );
    });
  });

  it('lists global settings and project overrides', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ agent_id: 'aiGovernance', disabled: true }] }) };
    const { app } = buildApp({ db, getDb: () => db });
    await withServer(app, async (baseUrl) => {
      const globalRes = await fetch(`${baseUrl}/api/agent-controls/global`);
      const globalBody: any = await globalRes.json();
      expect(globalBody.items).toEqual([{ agent_id: 'aiGovernance', disabled: true }]);

      const projectRes = await fetch(`${baseUrl}/api/agent-controls/project/proj-1`);
      const projectBody: any = await projectRes.json();
      expect(projectBody.items).toEqual([{ agent_id: 'aiGovernance', disabled: true }]);
    });
  });
});

describe('resolveAgentKillSwitch', () => {
  it('returns disabled:false with source no-db when the database is unavailable', async () => {
    const result = await resolveAgentKillSwitch({ getDb: () => null, projectId: 'p1', agentId: 'aiGovernance' });
    expect(result).toEqual({ disabled: false, source: 'no-db' });
  });

  it('returns disabled:false with source default when neither a project nor a global row exists', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const result = await resolveAgentKillSwitch({ getDb: () => db, projectId: 'p1', agentId: 'aiGovernance' });
    expect(result).toEqual({ disabled: false, source: 'default' });
  });

  it('falls back to the global flag when no project-specific row exists', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // project_agent_overrides: none
        .mockResolvedValueOnce({ rows: [{ disabled: true }] }), // agent_global_settings: disabled
    };
    const result = await resolveAgentKillSwitch({ getDb: () => db, projectId: 'p1', agentId: 'aiGovernance' });
    expect(result).toEqual({ disabled: true, source: 'global' });
  });

  it('a per-project override wins over an opposite global setting (decision 2)', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ disabled: false }] }), // project_agent_overrides: explicit enable
    };
    const result = await resolveAgentKillSwitch({ getDb: () => db, projectId: 'p1', agentId: 'aiGovernance' });
    expect(result).toEqual({ disabled: false, source: 'project' });
    // Only one query issued -- the global table is never even consulted
    // once a project-level row exists, per the doc's resolution order.
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('a per-project disable wins over an absent/enabled global setting', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ disabled: true }] }), // project override: disabled
    };
    const result = await resolveAgentKillSwitch({ getDb: () => db, projectId: 'p1', agentId: 'aiGovernance' });
    expect(result).toEqual({ disabled: true, source: 'project' });
  });
});
