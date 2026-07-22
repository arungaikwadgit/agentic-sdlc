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
//
// .connect() returns a "client" backed by the same dispatch table, plus a
// no-op release() and pass-through handling for BEGIN/COMMIT/ROLLBACK --
// needed since POST /:projectId/decision (2026-07-22 code-review fix)
// wraps its writes in a transaction on a dedicated client rather than
// issuing queries straight against the pool.
function fakeDb(handlers: Record<string, (params: any[]) => any>) {
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    for (const [keyword, handler] of Object.entries(handlers)) {
      if (sql.includes(keyword)) return handler(params);
    }
    throw new Error(`fakeDb: no handler matched for SQL containing none of [${Object.keys(handlers).join(', ')}]: ${sql.slice(0, 80)}`);
  });
  return {
    query,
    connect: jest.fn(async () => ({ query, release: jest.fn() })),
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

  // Code-review finding (2026-07-22, Suggestion #7): replaces GovernanceTab.tsx's
  // old N+1 fetch pattern (one GET /:projectId per project) with a single
  // admin-only aggregate call.
  describe('GET /aggregate', () => {
    it('returns 403 when the caller is not an app admin', async () => {
      const db = fakeDb({});
      const { app } = buildApp({
        checkToken: (req: any, _res: any, next: any) => { req.authUser = { email: 'stranger@example.com' }; next(); },
        isConfiguredAdminEmail: () => false,
        db, getDb: () => db,
      });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/aggregate?projectIds=proj-1`);
        expect(res.status).toBe(403);
      });
    });

    it('returns an empty items object when no valid projectIds are given', async () => {
      const db = fakeDb({});
      const { app } = buildApp({ db, getDb: () => db }); // default = admin bypass
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/aggregate`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ items: {} });
      });
    });

    it('silently drops malformed (non-UUID) ids rather than erroring', async () => {
      const db = fakeDb({
        'FROM governance_decision': () => ({ rows: [] }),
        'FROM governance_finding': () => ({ rows: [] }),
      });
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/aggregate?projectIds=not-a-uuid,also-bad`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ items: {} });
      });
    });

    it('assembles decision + findings + openFindingsCount + override per project in one pass', async () => {
      const projA = '11111111-1111-1111-1111-111111111111';
      const projB = '22222222-2222-2222-2222-222222222222';
      const decisionA = { id: 'dec-a', project_id: projA, decision: 'blocked', risk_tier: 'high' };
      const decisionB = { id: 'dec-b', project_id: projB, decision: 'approved', risk_tier: 'low' };
      const db = fakeDb({
        'FROM governance_decision': () => ({ rows: [decisionA, decisionB] }),
        'FROM governance_finding': () => ({ rows: [
          { id: 'f1', project_id: projA, severity: 'high' },
          { id: 'f2', project_id: projA, severity: 'medium' },
        ] }),
        'FROM governance_override': () => ({ rows: [
          { id: 'ov-1', governance_decision_id: 'dec-a', actor_email: 'admin@example.com', actor_role: 'app_admin', reason: 'accepted risk' },
        ] }),
      });
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/aggregate?projectIds=${projA},${projB}`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body.items[projA].decision).toEqual(decisionA);
        expect(body.items[projA].openFindingsCount).toBe(2);
        expect(body.items[projA].override.actor_email).toBe('admin@example.com');
        expect(body.items[projB].decision).toEqual(decisionB);
        expect(body.items[projB].openFindingsCount).toBe(0);
        expect(body.items[projB].override).toBeNull();
      });
    });

    it('returns null decision/empty findings/null override for a project with no governance run yet', async () => {
      const projC = '33333333-3333-3333-3333-333333333333';
      const db = fakeDb({
        'FROM governance_decision': () => ({ rows: [] }),
        'FROM governance_finding': () => ({ rows: [] }),
      });
      const { app } = buildApp({ db, getDb: () => db });
      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/governance/aggregate?projectIds=${projC}`);
        const body: any = await res.json();
        expect(body.items[projC]).toEqual({ decision: null, findings: [], openFindingsCount: 0, override: null });
      });
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

    // Code-review finding (2026-07-22, Critical #2): GET /:projectId and
    // /history used to have no project-scoping check at all beyond
    // checkToken -- any authenticated user could read any project's
    // governance data. These cover the fix.
    describe('project-scoped access control (code-review fix)', () => {
      const emptyDb = () => fakeDb({
        'FROM governance_decision': () => ({ rows: [] }),
        'FROM governance_finding': () => ({ rows: [] }),
      });

      it('returns 401 when there is no authenticated caller', async () => {
        const db = emptyDb();
        const { app } = buildApp({
          checkToken: (_req: any, _res: any, next: any) => next(),
          db, getDb: () => db,
        });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1`);
          expect(res.status).toBe(401);
        });
      });

      it('returns 403 when the caller has no role on this project', async () => {
        const db = emptyDb();
        const { app } = buildApp({
          checkToken: (req: any, _res: any, next: any) => { req.authUser = { email: 'stranger@example.com' }; next(); },
          isConfiguredAdminEmail: () => false,
          getCallerAppRoleForProject: async () => null,
          db, getDb: () => db,
        });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1`);
          expect(res.status).toBe(403);
        });
      });

      it('allows a caller with ANY project role (not just owner) to read', async () => {
        const db = emptyDb();
        const { app } = buildApp({
          checkToken: (req: any, _res: any, next: any) => { req.authUser = { email: 'viewer@example.com' }; next(); },
          isConfiguredAdminEmail: () => false,
          getCallerAppRoleForProject: async () => 'viewer',
          db, getDb: () => db,
        });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1`);
          expect(res.status).toBe(200);
        });
      });

      it('allows an app admin regardless of project membership', async () => {
        const db = emptyDb();
        const { app } = buildApp({
          checkToken: (req: any, _res: any, next: any) => { req.authUser = { email: 'admin@example.com' }; next(); },
          isConfiguredAdminEmail: () => true,
          getCallerAppRoleForProject: async () => null,
          db, getDb: () => db,
        });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1`);
          expect(res.status).toBe(200);
        });
      });

      it('applies the same check to GET /:projectId/history', async () => {
        const db = fakeDb({ 'FROM governance_decision': () => ({ rows: [] }) });
        const { app } = buildApp({
          checkToken: (req: any, _res: any, next: any) => { req.authUser = { email: 'stranger@example.com' }; next(); },
          isConfiguredAdminEmail: () => false,
          getCallerAppRoleForProject: async () => null,
          db, getDb: () => db,
        });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/history`);
          expect(res.status).toBe(403);
        });
      });
    });
  });

  describe('POST /:projectId/decision', () => {
    // Code-review finding (2026-07-22, Suggestion #5): governance_finding is
    // now upserted via a single batched UNNEST query instead of one query
    // per finding, so params is [projectId, controlIds[], severities[],
    // gaps[], recommendations[], ownerRoles[]] rather than one row's worth
    // of scalars. inserted.findings is flattened back to one entry per
    // finding so existing "N findings processed" assertions still read the
    // same way regardless of how many DB round-trips that took.
    function insertingDb(inserted: { decision?: any[]; findings: any[][]; backlog: any[][] }) {
      return fakeDb({
        'INSERT INTO governance_decision': (params: any[]) => { inserted.decision = params; return { rows: [] }; },
        'INSERT INTO governance_finding': (params: any[]) => {
          const [, controlIds, severities] = params;
          return {
            rows: (controlIds as string[]).map((controlId, i) => {
              inserted.findings.push([controlId, severities[i]]);
              return { id: `finding-${inserted.findings.length}`, control_id: controlId, severity: severities[i] };
            }),
          };
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
      const inserted: { decision?: any[]; findings: any[][]; backlog: any[][] } = { findings: [], backlog: [] };
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
      const inserted: { decision?: any[]; findings: any[][]; backlog: any[][] } = { findings: [], backlog: [] };
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

    // Code-review finding (2026-07-22, Critical #1): this route used to
    // have no project-scoping check at all -- any authenticated user
    // could POST an arbitrary decision for any project.
    describe('project-scoped access control (code-review fix)', () => {
      it('returns 401 when there is no authenticated caller', async () => {
        const db = fakeDb({});
        const { app } = buildApp({
          checkToken: (_req: any, _res: any, next: any) => next(),
          db, getDb: () => db,
        });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved', riskTier: 'low' }),
          });
          expect(res.status).toBe(401);
        });
      });

      it('returns 403 when the caller has no role on this project', async () => {
        const db = fakeDb({});
        const { app } = buildApp({
          checkToken: (req: any, _res: any, next: any) => { req.authUser = { email: 'stranger@example.com' }; next(); },
          isConfiguredAdminEmail: () => false,
          getCallerAppRoleForProject: async () => null,
          db, getDb: () => db,
        });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved', riskTier: 'low' }),
          });
          expect(res.status).toBe(403);
        });
      });

      // The important distinction from POST /override: any project role
      // is enough here, not just project_owner -- a regular Editor
      // running the pipeline is the one whose action normally triggers
      // this write, so restricting it to owners would break that flow.
      it('allows a non-owner project member (e.g. editor) to persist a decision', async () => {
        const inserted: { decision?: any[]; findings: any[][]; backlog: any[][] } = { findings: [], backlog: [] };
        const db = insertingDb(inserted);
        const { app } = buildApp({
          checkToken: (req: any, _res: any, next: any) => { req.authUser = { email: 'editor@example.com' }; next(); },
          isConfiguredAdminEmail: () => false,
          getCallerAppRoleForProject: async () => 'editor',
          db, getDb: () => db,
        });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved', riskTier: 'low', findings: [] }),
          });
          expect(res.status).toBe(200);
        });
      });
    });

    describe('confidence bounds validation (code-review fix)', () => {
      it('rejects a non-numeric confidence', async () => {
        const { app } = buildApp({ db: fakeDb({}), getDb: () => fakeDb({}) });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved', riskTier: 'low', confidence: 'high-ish', findings: [] }),
          });
          expect(res.status).toBe(400);
          const body: any = await res.json();
          expect(body.error).toMatch(/confidence must be a finite number/i);
        });
      });

      it('rejects a confidence above 100', async () => {
        const { app } = buildApp({ db: fakeDb({}), getDb: () => fakeDb({}) });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved', riskTier: 'low', confidence: 150, findings: [] }),
          });
          expect(res.status).toBe(400);
        });
      });

      it('rejects a negative confidence', async () => {
        const { app } = buildApp({ db: fakeDb({}), getDb: () => fakeDb({}) });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved', riskTier: 'low', confidence: -1, findings: [] }),
          });
          expect(res.status).toBe(400);
        });
      });

      it('accepts a valid confidence within range', async () => {
        const inserted: { decision?: any[]; findings: any[][]; backlog: any[][] } = { findings: [], backlog: [] };
        const db = insertingDb(inserted);
        const { app } = buildApp({ db, getDb: () => db });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved', riskTier: 'low', confidence: 92.5, findings: [] }),
          });
          expect(res.status).toBe(200);
          expect(inserted.decision![5]).toBe(92.5);
        });
      });
    });

    describe('batched finding upsert (code-review fix)', () => {
      it('issues a single INSERT INTO governance_finding call for multiple findings, not one per finding', async () => {
        let findingInsertCallCount = 0;
        const inserted: { decision?: any[]; findings: any[][]; backlog: any[][] } = { findings: [], backlog: [] };
        const baseDb = insertingDb(inserted);
        const countingQuery = jest.fn(async (sql: string, params: any[] = []) => {
          if (sql.includes('INSERT INTO governance_finding')) findingInsertCallCount++;
          return baseDb.query(sql, params);
        });
        const db = { query: countingQuery, connect: jest.fn(async () => ({ query: countingQuery, release: jest.fn() })) };
        const { app } = buildApp({ db, getDb: () => db });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decision: 'blocked', riskTier: 'high',
              findings: [
                { controlId: 'a', severity: 'high' },
                { controlId: 'b', severity: 'medium' },
                { controlId: 'c', severity: 'critical' },
              ],
            }),
          });
          expect(res.status).toBe(200);
          expect(findingInsertCallCount).toBe(1);
          expect(inserted.findings).toHaveLength(3);
        });
      });

      it('de-duplicates findings with the same controlId, keeping the last occurrence', async () => {
        const inserted: { decision?: any[]; findings: any[][]; backlog: any[][] } = { findings: [], backlog: [] };
        const db = insertingDb(inserted);
        const { app } = buildApp({ db, getDb: () => db });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decision: 'blocked', riskTier: 'high',
              findings: [
                { controlId: 'dup', severity: 'low' },
                { controlId: 'dup', severity: 'critical' },
              ],
            }),
          });
          expect(res.status).toBe(200);
          expect(inserted.findings).toHaveLength(1);
          expect(inserted.findings[0]).toEqual(['dup', 'critical']);
        });
      });
    });

    describe('transaction rollback on mid-sequence failure (code-review fix)', () => {
      it('rolls back and returns 500 if the findings upsert fails after the decision insert succeeds', async () => {
        let decisionInserted = false;
        let rolledBack = false;
        let committed = false;
        const query = jest.fn(async (sql: string) => {
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'ROLLBACK') { rolledBack = true; return { rows: [] }; }
          if (sql === 'COMMIT') { committed = true; return { rows: [] }; }
          if (sql.includes('INSERT INTO governance_decision')) { decisionInserted = true; return { rows: [] }; }
          if (sql.includes('INSERT INTO governance_finding')) { throw new Error('simulated DB failure mid-transaction'); }
          throw new Error(`unexpected query in rollback test: ${sql.slice(0, 60)}`);
        });
        const db = { query, connect: jest.fn(async () => ({ query, release: jest.fn() })) };
        const { app } = buildApp({ db, getDb: () => db });
        await withServer(app, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/governance/proj-1/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decision: 'blocked', riskTier: 'high',
              findings: [{ controlId: 'a', severity: 'high' }],
            }),
          });
          expect(res.status).toBe(500);
          expect(decisionInserted).toBe(true);
          expect(rolledBack).toBe(true);
          expect(committed).toBe(false);
        });
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
