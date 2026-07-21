export {};
// Tests for backend/src/routes/promptGovernance.js
// Boots a real express() app around createPromptGovernanceRouter with fully
// mocked DI dependencies, then exercises it over real HTTP via global fetch.
//
// promptGovernance.js's internal helpers (nextPromptVersion,
// getActivePromptVersion, insertPromptVersion, activatePromptVersion) all
// call `getDb().query(...)` directly with NO null-pool guard, so getDb()
// must always return a truthy mock pool in these tests -- see the report
// for why a real getDb()-null path here is untestable without hanging the
// request (no try/catch anywhere in this file, see below).

const express = require('express');
const { createPromptGovernanceRouter } = require('./promptGovernance');

function normalizeSql(sql: any) {
  return sql.replace(/\s+/g, ' ').trim();
}

// Flexible query mock: custom handlers (checked in order) can override the
// default responses used to satisfy the many sequential queries inside
// insertPromptVersion/activatePromptVersion/dbAuditPrompt.
function queryMock(customHandlers: any[] = []) {
  return jest.fn(async (sql, params = []) => {
    const s = normalizeSql(sql);
    for (const { test, handler } of customHandlers) {
      if (test.test(s)) return handler(params, s);
    }
    if (/AS next_version/.test(s)) {
      return { rows: [{ next_version: 1 }] };
    }
    if (/active = TRUE AND/.test(s)) {
      // getActivePromptVersion default: nothing active found
      return { rows: [] };
    }
    if (/SELECT id FROM agent_prompt_versions/.test(s)) {
      return { rows: [] };
    }
    if (/INSERT INTO agent_prompt_versions/.test(s)) {
      return { rows: [] };
    }
    if (/INSERT INTO agent_prompt_audit_log/.test(s)) {
      return { rows: [] };
    }
    if (/SET active = FALSE/.test(s)) {
      return { rows: [] };
    }
    if (/SET status = 'activated'/.test(s)) {
      return { rows: [{ id: params[0], project_id: null, agent_id: 'agent-default', status: 'activated' }] };
    }
    if (/SET rollback_reference_id/.test(s)) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

function activeVersionHandler({ project, global }: any = {}) {
  return {
    test: /active = TRUE AND/,
    handler: (params: any) => {
      const scope = params[0];
      if (scope === 'project') return { rows: project ? [project] : [] };
      return { rows: global ? [global] : [] };
    },
  };
}

function buildDeps(overrides: any = {}) {
  const db = overrides.db !== undefined ? overrides.db : { query: queryMock(overrides.queryHandlers || []) };
  const getDb = overrides.getDb || (() => db);
  const checkToken = overrides.checkToken || ((req: any, res: any, next: any) => {
    req.authUser = { email: 'owner@example.com', user: { id: 'u1' } };
    next();
  });
  const requireAdmin = overrides.requireAdmin || ((req: any, res: any, next: any) => next());
  const requireAppStateDb = overrides.requireAppStateDb || (async () => true);
  const dbGetAppConfigMap = overrides.dbGetAppConfigMap || jest.fn(async () => ({}));
  const isConfiguredAdminEmail = overrides.isConfiguredAdminEmail || jest.fn(() => false);
  const getCallerAppRoleForProject = overrides.getCallerAppRoleForProject || jest.fn(async () => 'project_owner');
  const enqueueRuntimeLifecycleEvent = overrides.enqueueRuntimeLifecycleEvent || jest.fn(async () => {});
  const fanOutRuntimeLifecycleEvent = overrides.fanOutRuntimeLifecycleEvent || jest.fn(async () => {});

  return {
    getDb,
    checkToken,
    requireAdmin,
    requireAppStateDb,
    dbGetAppConfigMap,
    isConfiguredAdminEmail,
    getCallerAppRoleForProject,
    enqueueRuntimeLifecycleEvent,
    fanOutRuntimeLifecycleEvent,
    db,
  };
}

async function startServer(overrides: any = {}) {
  const deps = buildDeps(overrides);
  const app = express();
  app.use(express.json());
  app.use('/api/prompt-governance', createPromptGovernanceRouter(deps));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/prompt-governance`;
  return { server, baseUrl, deps };
}

async function withServer(overrides: any, fn: (ctx: any) => Promise<void>) {
  const ctx = await startServer(overrides);
  try {
    await fn(ctx);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

describe('promptGovernance routes', () => {
  describe('GET /effective', () => {
    it('returns 400 when agentId is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/effective`);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'agentId is required.' });
      });
    });

    it('returns the active global prompt when no projectId is given', async () => {
      const global = { content: 'global content', version: 3, resolved_effective_prompt: null };
      const db = { query: queryMock([activeVersionHandler({ global })]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/effective?agentId=agentA`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ prompt: 'global content', source: 'global', version: 3, record: global });
      });
    });

    it('returns the active project prompt when projectId matches', async () => {
      const project = { content: 'proj content', resolved_effective_prompt: 'resolved proj', version: 2 };
      const db = { query: queryMock([activeVersionHandler({ project })]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/effective?agentId=agentA&projectId=proj-1`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ prompt: 'resolved proj', source: 'project', version: 2, record: project });
      });
    });

    it('falls back to global when the project prompt is not found', async () => {
      const global = { content: 'global content', version: 1, resolved_effective_prompt: null };
      const db = { query: queryMock([activeVersionHandler({ global })]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/effective?agentId=agentA&projectId=proj-1`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body.source).toBe('global');
      });
    });

    it('falls back to legacy app-state prompt defaults when nothing is active', async () => {
      const dbGetAppConfigMap = jest.fn(async () => ({ 'app:promptDefaults': { agentA: 'legacy prompt' } }));
      await withServer({ dbGetAppConfigMap }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/effective?agentId=agentA`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ prompt: 'legacy prompt', source: 'legacy-app-state', version: null, record: null });
      });
    });

    it('returns fallback with null prompt when nothing is found anywhere', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/effective?agentId=agentA`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ prompt: null, source: 'fallback', version: null, record: null });
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/effective?agentId=agentA`);
        expect(res.status).toBe(503);
      });
    });
  });

  describe('GET /versions', () => {
    it('returns 400 when agentId is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/versions`);
        expect(res.status).toBe(400);
      });
    });

    it('returns the version list for the agent', async () => {
      const rows = [{ id: 'v1', agent_id: 'agentA', version: 1 }];
      const db = { query: queryMock([{ test: /ORDER BY scope, version DESC/, handler: () => ({ rows }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/versions?agentId=agentA`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ items: rows });
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/versions?agentId=agentA`);
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /global/:agentId', () => {
    it('creates and activates a global prompt version', async () => {
      const fanOutRuntimeLifecycleEvent = jest.fn(async () => {});
      await withServer({ fanOutRuntimeLifecycleEvent }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/global/agentA`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'new global prompt' }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.status).toBe('activated');
        expect(body.version).toBe(1);
        expect(typeof body.id).toBe('string');
        expect(fanOutRuntimeLifecycleEvent).toHaveBeenCalledWith('prompt_changed', body.id, 'agent-default');
      });
    });

    it('swallows a rejected global-scope lifecycle notification via the internal .catch', async () => {
      const fanOutRuntimeLifecycleEvent = jest.fn(async () => { throw new Error('global lifecycle boom'); });
      await withServer({ fanOutRuntimeLifecycleEvent }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/global/agentA`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(200);
        await new Promise((resolve) => setImmediate(resolve));
      });
    });

    it('returns 400 when content is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/global/agentA`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'agentId and content are required.' });
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/global/agentA`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/global/agentA`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /project/:projectId/:agentId/draft', () => {
    it('creates a draft prompt version', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'draft content' }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ ok: true, id: expect.any(String), version: 1, status: 'draft' });
      });
    });

    it('returns 400 when content is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'content is required.' });
      });
    });

    it('returns 401 when the caller has no email', async () => {
      const checkToken = (req: any, res: any, next: any) => { req.authUser = {}; next(); };
      await withServer({ checkToken }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Please sign in to manage project prompt overrides.' });
      });
    });

    it('returns 403 when the caller is not the project owner or an admin', async () => {
      const getCallerAppRoleForProject = jest.fn(async () => 'contributor');
      await withServer({ getCallerAppRoleForProject }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Only the Project Owner or an app admin can approve project prompt overrides.' });
      });
    });

    it('allows a configured admin email without checking project role', async () => {
      const isConfiguredAdminEmail = jest.fn(() => true);
      const getCallerAppRoleForProject = jest.fn(async () => 'contributor');
      await withServer({ isConfiguredAdminEmail, getCallerAppRoleForProject }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(200);
        expect(getCallerAppRoleForProject).not.toHaveBeenCalled();
      });
    });

    it('allows an admin-bypass auth user (non-production) without an email', async () => {
      const checkToken = (req: any, res: any, next: any) => { req.authUser = { adminBypass: true }; next(); };
      await withServer({ checkToken }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(200);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /project/:projectId/:agentId/activate', () => {
    it('creates and activates a project prompt version, notifying via enqueueRuntimeLifecycleEvent', async () => {
      const projectId = 'proj-1';
      const enqueueRuntimeLifecycleEvent = jest.fn(async () => {});
      const db = {
        query: queryMock([
          { test: /SET status = 'activated'/, handler: (params: any) => ({ rows: [{ id: params[0], project_id: projectId, agent_id: 'agentA' }] }) },
        ]),
      };
      await withServer({ db, enqueueRuntimeLifecycleEvent }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/${projectId}/agentA/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'approved content' }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ ok: true, id: expect.any(String), version: 1, status: 'activated' });
        expect(enqueueRuntimeLifecycleEvent).toHaveBeenCalledWith(expect.objectContaining({
          event_type: 'prompt_changed',
          agent_key: 'agentA',
          project_id: projectId,
        }));
      });
    });

    it('swallows a rejected project-scope lifecycle notification via the internal .catch', async () => {
      const projectId = 'proj-1';
      const enqueueRuntimeLifecycleEvent = jest.fn(async () => { throw new Error('project lifecycle boom'); });
      const db = {
        query: queryMock([
          { test: /SET status = 'activated'/, handler: (params: any) => ({ rows: [{ id: params[0], project_id: projectId, agent_id: 'agentA' }] }) },
        ]),
      };
      await withServer({ db, enqueueRuntimeLifecycleEvent }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/${projectId}/agentA/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'approved content' }),
        });
        expect(res.status).toBe(200);
        await new Promise((resolve) => setImmediate(resolve));
      });
    });

    it('returns 400 when content is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /project/:projectId/:agentId/:versionId/submit', () => {
    it('transitions a draft version to submitted', async () => {
      const db = {
        query: queryMock([
          { test: /SELECT status FROM agent_prompt_versions/, handler: () => ({ rows: [{ status: 'draft' }] }) },
          { test: /SET status = 'submitted'/, handler: (params: any) => ({ rows: [{ id: params[0], status: 'submitted' }] }) },
        ]),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ ok: true, item: { id: 'v1', status: 'submitted' } });
      });
    });

    it('returns 404 when the prompt version does not exist', async () => {
      const db = { query: queryMock([{ test: /SELECT status FROM agent_prompt_versions/, handler: () => ({ rows: [] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Prompt version not found.' });
      });
    });

    it('returns 409 for an invalid status transition', async () => {
      const db = { query: queryMock([{ test: /SELECT status FROM agent_prompt_versions/, handler: () => ({ rows: [{ status: 'activated' }] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(409);
        const body: any = await res.json();
        expect(body.error).toMatch(/Invalid prompt status transition/);
      });
    });

    it('returns 403 when the caller is not authorized', async () => {
      const getCallerAppRoleForProject = jest.fn(async () => 'contributor');
      await withServer({ getCallerAppRoleForProject }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /project/:projectId/:agentId/:versionId/approve', () => {
    it('transitions a submitted version to approved', async () => {
      const db = {
        query: queryMock([
          { test: /SELECT status FROM agent_prompt_versions/, handler: () => ({ rows: [{ status: 'submitted' }] }) },
          { test: /SET status = 'approved'/, handler: (params: any) => ({ rows: [{ id: params[0], status: 'approved' }] }) },
        ]),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approvalComments: 'looks good' }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ ok: true, item: { id: 'v1', status: 'approved' } });
      });
    });

    it('returns 404 when the prompt version does not exist', async () => {
      const db = { query: queryMock([{ test: /SELECT status FROM agent_prompt_versions/, handler: () => ({ rows: [] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
      });
    });

    it('returns 409 for an invalid status transition', async () => {
      const db = { query: queryMock([{ test: /SELECT status FROM agent_prompt_versions/, handler: () => ({ rows: [{ status: 'draft' }] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(409);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /project/:projectId/:agentId/:versionId/activate', () => {
    it('activates an approved prompt version', async () => {
      const db = {
        query: queryMock([
          { test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [{ id: 'v1', status: 'approved' }] }) },
        ]),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.item).toBeTruthy();
      });
    });

    it('returns 404 when the prompt version does not exist', async () => {
      const db = { query: queryMock([{ test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
      });
    });

    it('returns 409 when the version is not approved', async () => {
      const db = { query: queryMock([{ test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [{ id: 'v1', status: 'draft' }] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'Prompt version must be approved before activation.' });
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /project/:projectId/:agentId/:versionId/reject', () => {
    it('rejects a submitted version', async () => {
      const db = {
        query: queryMock([
          { test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [{ id: 'v1', status: 'submitted' }] }) },
          { test: /SET status = \$2/, handler: (params: any) => ({ rows: [{ id: params[0], status: 'rejected' }] }) },
        ]),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approvalComments: 'no' }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ ok: true, item: { id: 'v1', status: 'rejected' } });
      });
    });

    it('returns 404 when the prompt version does not exist', async () => {
      const db = { query: queryMock([{ test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
      });
    });

    it('returns 409 for an invalid transition', async () => {
      const db = { query: queryMock([{ test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [{ id: 'v1', status: 'draft' }] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(409);
      });
    });
  });

  describe('POST /project/:projectId/:agentId/:versionId/changes-requested', () => {
    it('moves a submitted version to changes_requested', async () => {
      const db = {
        query: queryMock([
          { test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [{ id: 'v1', status: 'submitted' }] }) },
          { test: /SET status = \$2/, handler: (params: any) => ({ rows: [{ id: params[0], status: 'changes_requested' }] }) },
        ]),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/changes-requested`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approvalComments: 'please revise' }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ ok: true, item: { id: 'v1', status: 'changes_requested' } });
      });
    });

    it('returns 404 when the prompt version does not exist', async () => {
      const db = { query: queryMock([{ test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v1/changes-requested`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
      });
    });
  });

  describe('POST /project/:projectId/:agentId/:versionId/rollback', () => {
    it('creates and activates a rollback version from a previously-superseded target', async () => {
      const target = {
        id: 'v-old', status: 'superseded', active: false, activated_at: '2024-01-01T00:00:00Z',
        content: 'old content', resolved_effective_prompt: null, agent_name: 'AgentA', version: 2,
      };
      const db = {
        query: queryMock([
          { test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [target] }) },
        ]),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v-old/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'reverting a bad change' }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.item).toBeTruthy();
      });
    });

    it('returns 404 when the target version does not exist', async () => {
      const db = { query: queryMock([{ test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v-old/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
      });
    });

    it('returns 409 when the target version cannot be rolled back (still active)', async () => {
      const target = { id: 'v-old', status: 'activated', active: true, activated_at: '2024-01-01T00:00:00Z' };
      const db = { query: queryMock([{ test: /SELECT \* FROM agent_prompt_versions WHERE id = \$1 AND project_id = \$2 AND agent_id = \$3/, handler: () => ({ rows: [target] }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v-old/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'Only a previously activated, inactive prompt version can be rolled back.' });
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/project/proj-1/agentA/v-old/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /seed/global', () => {
    it('creates new global prompts and skips agents that already have an active one', async () => {
      const db = {
        query: queryMock([
          {
            test: /active = TRUE AND/,
            handler: (params: any) => (params[1] === 'existing-agent' ? { rows: [{ id: 'existing-version' }] } : { rows: [] }),
          },
        ]),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/seed/global`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompts: [
              { agentId: 'existing-agent', agentName: 'Existing', content: 'x' },
              { agentId: 'new-agent', agentName: 'New', content: 'y' },
            ],
          }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ ok: true, created: 1, skipped: 1 });
      });
    });

    it('returns 400 when prompts is empty', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/seed/global`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompts: [] }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'prompts must contain between 1 and 100 entries.' });
      });
    });

    it('returns 400 when prompts has more than 100 entries', async () => {
      const prompts = Array.from({ length: 101 }, () => ({}));
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/seed/global`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompts }),
        });
        expect(res.status).toBe(400);
      });
    });

    it('returns 400 when an entry is missing agentId or content', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/seed/global`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompts: [{ agentId: '', content: 'x' }] }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Every seed entry requires agentId and content.' });
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/seed/global`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompts: [{ agentId: 'a', content: 'x' }] }),
        });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/seed/global`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompts: [{ agentId: 'a', content: 'x' }] }),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('GET /audit', () => {
    it('returns 400 when agentId is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/audit`);
        expect(res.status).toBe(400);
      });
    });

    it('returns audit log rows for the agent', async () => {
      const rows = [{ id: 'a1', agent_id: 'agentA', action: 'created:draft' }];
      const db = { query: queryMock([{ test: /ORDER BY created_at DESC LIMIT 200/, handler: () => ({ rows }) }]) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/audit?agentId=agentA`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ items: rows });
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/audit?agentId=agentA`);
        expect(res.status).toBe(503);
      });
    });
  });
});
