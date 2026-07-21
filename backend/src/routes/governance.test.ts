export {};

const express = require('express');
const { createGovernanceRouter } = require('./governance');

function authAdminBypass(req: any, _res: any, next: any) {
  req.authUser = { adminBypass: true };
  next();
}

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());
  const checkToken = overrides.checkToken ?? authAdminBypass;
  const getDb = overrides.getDb ?? (() => (overrides.db !== undefined ? overrides.db : null));
  const isConfiguredAdminEmail = overrides.isConfiguredAdminEmail ?? (() => false);
  const getCallerAppRoleForProject = overrides.getCallerAppRoleForProject ?? (async () => null);
  const router = createGovernanceRouter({ getDb, checkToken, isConfiguredAdminEmail, getCallerAppRoleForProject });
  app.use('/api/governance', router);
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

// Minimal fake pg Pool: dispatches by matching a keyword in the SQL text,
// in the order this route file actually issues queries. Deliberately
// simple (not a real query planner) -- this is enough to exercise every
// branch in governance.js without a real Postgres instance.
function fakeDb(handlers: Record<string, (params: any[]) => any>) {
  return {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      for (const [keyword, handler] of Object.entries(handlers)) {
        if (sql.includes(keyword)) return handler(params);
      }
      throw new Error(`fakeDb: no handler matched for SQL containing none of [${Object.keys(handlers).join(', ')}]: ${sql.slice(0, 80)}`);
    }),
  };
}

describe('createGovernanceRouter', () => {
  it('returns 503 on every route when the database is unavailable', async () => {
    const { app } = buildApp({ getDb: () => null });
    await withServer(app, async (baseUrl) => {
      const get = await fetch(`${baseUrl}/api/governance/proj-1`);
      expect(get.status).toBe(503);
      const post = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      expect(post.status).toBe(503);
    });
  });

  describe('GET /:projectId', () => {
    it('returns null decision/empty findings/null override when nothing exists yet', async () => {
      const db = fakeDb({
        'FROM governance_decision': () => ({ rows: [] }),
        'FROM governance_finding': () => ({ rows: [] }),
      });
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ decision: null, findings: [], openFindingsCount: 0, override: null });
      });
    });

    it('includes the latest override when one exists for the latest decision', async () => {
      const decisionRow = { id: 'dec-1', project_id: 'proj-1', decision: 'blocked', risk_tier: 'high' };
      const db = fakeDb({
        'FROM governance_decision': () => ({ rows: [decisionRow] }),
        'FROM governance_finding': () => ({ rows: [{ id: 'f1', severity: 'high' }] }),
        'FROM governance_override': () => ({ rows: [{ id: 'ov-1', actor_email: 'owner@example.com', actor_role: 'project_owner', reason: 'ship it' }] }),
      });
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1`);
        const body: any = await res.json();
        expect(body.decision).toEqual(decisionRow);
        expect(body.openFindingsCount).toBe(1);
        expect(body.override.actor_email).toBe('owner@example.com');
      });
    });
  });

  describe('POST /:projectId/decision', () => {
    function insertingDb(inserted: { decision?: any[]; findings: any[][]; backlog: any[][] }) {
      return fakeDb({
        'INSERT INTO governance_decision': (params: any[]) => { inserted.decision = params; return { rows: [] }; },
        'INSERT INTO governance_finding': (params: any[]) => {
          inserted.findings.push(params);
          // Echo back a row shaped like what the real upsert RETURNING would give.
          return { rows: [{ id: `finding-${inserted.findings.length}`, control_id: params[2], severity: params[3] }] };
        },
        "SET status = 'resolved'": () => ({ rows: [] }),
        'UPDATE governance_finding SET backlog_item_id': () => ({ rows: [] }),
        'INSERT INTO admin_backlog_items': (params: any[]) => { inserted.backlog.push(params); return { rows: [] }; },
      });
    }

    it('rejects an invalid decision value', async () => {
      const { app } = buildApp({ db: fakeDb({}), getDb: () => fakeDb({}) });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'maybe', riskTier: 'high' }),
        });
        expect(res.status).toBe(400);
        const body: any = await res.json();
        expect(body.error).toMatch(/decision must be one of/i);
      });
    });

    it('rejects an invalid riskTier value', async () => {
      const { app } = buildApp({ db: fakeDb({}), getDb: () => fakeDb({}) });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approved', riskTier: 'extreme' }),
        });
        expect(res.status).toBe(400);
      });
    });

    it('rejects a finding missing controlId or with a bad severity', async () => {
      const { app } = buildApp({ db: fakeDb({}), getDb: () => fakeDb({}) });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approved', riskTier: 'low', findings: [{ severity: 'high' }] }),
        });
        expect(res.status).toBe(400);
      });
    });

    it('inserts the decision, upserts findings, and auto-creates a backlog item for Medium+ severity only', async () => {
      const inserted = { findings: [] as any[][], backlog: [] as any[][] };
      const db = insertingDb(inserted);
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: 'blocked',
            riskTier: 'high',
            confidence: 80,
            findings: [
              { controlId: 'a', severity: 'medium' },
              { controlId: 'b', severity: 'low' },
            ],
          }),
        });
        expect(res.status).toBe(200);
        expect(inserted.findings).toHaveLength(2);
        // Only the medium-severity finding spawns a backlog item (decision 7).
        expect(inserted.backlog).toHaveLength(1);
        expect(inserted.backlog[0][0]).toBe('gov-proj-1-a');
      });
    });

    it('ignores an agentRunId that is not a valid UUID rather than erroring', async () => {
      const inserted = { findings: [] as any[][], backlog: [] as any[][] };
      const db = insertingDb(inserted);
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approved', riskTier: 'low', agentRunId: 'not-a-uuid', findings: [] }),
        });
        expect(res.status).toBe(200);
        expect(inserted.decision![2]).toBeNull();
      });
    });
  });

  describe('POST /:projectId/override', () => {
    function blockedDecisionDb() {
      return fakeDb({
        'FROM governance_decision': () => ({ rows: [{ id: 'dec-1', decision: 'blocked' }] }),
        'INSERT INTO governance_override': () => ({ rows: [] }),
      });
    }

    it('returns 401 when there is no authenticated caller', async () => {
      const { app } = buildApp({
        checkToken: (_req: any, _res: any, next: any) => next(), // never sets req.authUser
        db: blockedDecisionDb(),
        getDb: () => blockedDecisionDb(),
      });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/override`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'x' }),
        });
        expect(res.status).toBe(401);
      });
    });

    it('returns 403 when the caller is neither app admin nor project owner', async () => {
      const { app } = buildApp({
        checkToken: (req: any, _res: any, next: any) => { req.authUser = { email: 'random@example.com' }; next(); },
        isConfiguredAdminEmail: () => false,
        getCallerAppRoleForProject: async () => 'viewer',
        db: blockedDecisionDb(),
        getDb: () => blockedDecisionDb(),
      });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/override`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'x' }),
        });
        expect(res.status).toBe(403);
      });
    });

    it('returns 400 when reason is empty', async () => {
      const db = blockedDecisionDb();
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/override`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '   ' }),
        });
        expect(res.status).toBe(400);
      });
    });

    it('returns 404 when no decision exists for the project', async () => {
      const db = fakeDb({ 'FROM governance_decision': () => ({ rows: [] }) });
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/override`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'x' }),
        });
        expect(res.status).toBe(404);
      });
    });

    it('returns 409 when the latest decision is not Blocked', async () => {
      const db = fakeDb({ 'FROM governance_decision': () => ({ rows: [{ id: 'dec-1', decision: 'approved' }] }) });
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/override`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'x' }),
        });
        expect(res.status).toBe(409);
      });
    });

    it('succeeds for an admin-bypass caller (dev mode) with a reason', async () => {
      const db = blockedDecisionDb();
      const { app } = buildApp({ db, getDb: () => db }); // default checkToken = admin bypass
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/override`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'accepted risk' }),
        });
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.ok).toBe(true);
      });
    });

    it('succeeds for a project owner with a reason', async () => {
      const db = blockedDecisionDb();
      const { app } = buildApp({
        checkToken: (req: any, _res: any, next: any) => { req.authUser = { email: 'owner@example.com' }; next(); },
        isConfiguredAdminEmail: () => false,
        getCallerAppRoleForProject: async () => 'project_owner',
        db, getDb: () => db,
      });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/proj-1/override`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'accepted risk' }),
        });
        expect(res.status).toBe(200);
      });
    });
  });
});
