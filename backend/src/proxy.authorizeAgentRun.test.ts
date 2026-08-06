// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// authorizeAgentRun() is the per-agent RBAC gate every /api/agent and
// /api/agents/call request goes through (see agentDispatchRoutes.js's
// authorizeAgentRun param). Before this file, only 1 of its ~10 branches had
// any coverage (proxy.authFailClosed.test.ts's "dbPool unavailable" 503
// case) — the kill-switch check, review-gate check, every bypass path
// (admin-bypass, configured-admin, service-account), and the actual
// membership/scoping decision were all untested outside
// proxy.agentAccess.integration.test.ts, which requires a real Postgres and
// is skipped without one.
//
// Strategy: jest.mock('pg') so dbPool is a fully-controlled fake pool
// (no real Postgres needed, unlike the skipped integration suite — this
// gives real coverage in every environment), and jest.mock() the two
// modules authorizeAgentRun calls directly (resolveAgentKillSwitch,
// resolveAgentGateAuthorization) so their results are set explicitly per
// test instead of depending on more SQL mocking.
//
// Every identifier referenced inside a jest.mock() factory below is
// prefixed with "mock" — Jest's out-of-scope-variable hoisting check
// requires that naming convention, or the factory can't reference it at all.
//
// export {}; -- this file has no other top-level import/export, so without
// this line TypeScript treats it as a global "script" whose top-level
// declarations (mockPoolQuery, makeMockPoolQuery) merge into one shared
// scope with every other script-mode file in the same tsc run. That caused
// real tsc --noEmit collisions against proxy.getCallerAppRoleForProject.test.ts
// and proxy.masterData.test.ts, which declare the same names the same way.
export {};

const mockResolveAgentKillSwitch = jest.fn();
jest.mock('./routes/agentControls', () => ({
  createAgentControlsRouter: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  resolveAgentKillSwitch: (...args: any[]) => mockResolveAgentKillSwitch(...args),
}));

const mockResolveAgentGateAuthorization = jest.fn();
jest.mock('./agentGatePolicy', () => ({
  resolveAgentGateAuthorization: (...args: any[]) => mockResolveAgentGateAuthorization(...args),
}));

let mockPoolQuery: jest.Mock;
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: (...args: any[]) => mockPoolQuery(...args) })),
}));

function makeMockPoolQuery(rules: Array<{ match: RegExp; resolve: (sql: string, params: any[]) => any }> = []) {
  return jest.fn(async (sql: any, params: any[] = []) => {
    const text = typeof sql === 'string' ? sql : sql?.text ?? '';
    for (const rule of rules) {
      if (rule.match.test(text)) return rule.resolve(text, params);
    }
    return { rows: [] }; // handles the startup 'SELECT 1' probe + every CREATE TABLE/INDEX DDL call harmlessly
  });
}

describe('authorizeAgentRun', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    mockResolveAgentKillSwitch.mockReset().mockResolvedValue({ disabled: false, source: 'no-db' });
    mockResolveAgentGateAuthorization.mockReset().mockResolvedValue({ allowed: true });
    mockPoolQuery = makeMockPoolQuery();
    process.env = {
      ...ORIGINAL_ENV,
      PORT: '0',
      NODE_ENV: 'test',
      OPENAI_API_KEY: '',
      PROXY_TOKEN: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_KEY: '',
      // Non-empty so resolveDbConnectionString() returns truthy and proxy.js
      // constructs a (mocked) Pool -- authorizeAgentRun's very first check is
      // `if (!dbPool)`, so every other branch is unreachable without this.
      POSTGRES_URL_LOCAL: 'postgres://fake:fake@localhost:5432/fake_test_db',
      POSTGRES_URL: '',
      POSTGRES_URL_PRODUCTION: '',
      DATABASE_URL: '',
      ADMIN_EMAIL_ALLOWLIST: 'admin@example.com',
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function fakeResponse() {
    return {
      statusCode: 200,
      body: null as unknown,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
    };
  }

  it('skips (out of scope) when projectId or agentId is missing', async () => {
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    expect(await authorizeAgentRun({ authUser: { email: 'x@example.com' } }, res, { projectId: null, agentId: 'architecture' })).toEqual({ ok: true, skipped: true });
    expect(await authorizeAgentRun({ authUser: { email: 'x@example.com' } }, res, { projectId: 'proj-1', agentId: null })).toEqual({ ok: true, skipped: true });
    expect(mockResolveAgentKillSwitch).not.toHaveBeenCalled();
  });

  it('503s when the kill-switch check itself throws', async () => {
    mockResolveAgentKillSwitch.mockRejectedValue(new Error('db exploded'));
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'x@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect(res.statusCode).toBe(503);
  });

  it('403s when the agent kill-switch is disabled (project-level)', async () => {
    mockResolveAgentKillSwitch.mockResolvedValue({ disabled: true, source: 'project' });
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'x@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect(res.statusCode).toBe(403);
    expect((res.body as any).error).toMatch(/disabled for this project/);
  });

  it('403s when the agent kill-switch is disabled (global-level, no "for this project" suffix)', async () => {
    mockResolveAgentKillSwitch.mockResolvedValue({ disabled: true, source: 'global' });
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'x@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect((res.body as any).error).not.toMatch(/for this project/);
  });

  it('503s when the review-gate check itself throws', async () => {
    mockResolveAgentGateAuthorization.mockRejectedValue(new Error('gate db exploded'));
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'x@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect(res.statusCode).toBe(503);
  });

  it('blocks when a required review gate has not been approved', async () => {
    mockResolveAgentGateAuthorization.mockResolvedValue({ allowed: false, status: 409, error: 'Gate 2 must be approved first.', blockingGate: 'gate2' });
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'x@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Gate 2 must be approved first.', blockingGate: 'gate2' });
  });

  it('defaults to 403 when a blocked gate result omits an explicit status/error', async () => {
    mockResolveAgentGateAuthorization.mockResolvedValue({ allowed: false });
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    await authorizeAgentRun({ authUser: { email: 'x@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(res.statusCode).toBe(403);
    expect((res.body as any).error).toMatch(/required review gate has not been approved/);
  });

  it('allows admin-bypass callers through unconditionally (skipped, not evaluated)', async () => {
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { adminBypass: true } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: true, skipped: true });
  });

  it('allows a configured admin email through unconditionally, regardless of project membership', async () => {
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'admin@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: true, skipped: true });
    // Never even queried project membership -- the admin allowlist check
    // short-circuits before getCallerAgentAccess's DB query.
    expect(mockPoolQuery.mock.calls.some((c) => /jsonb_array_elements/.test(String(c[0])))).toBe(false);
  });

  it('allows a trusted service-account caller through unconditionally', async () => {
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { serviceAccount: true } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: true, skipped: true });
  });

  it('401s when there is no verified caller identity at all', async () => {
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: {} }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect(res.statusCode).toBe(401);
  });

  it('503s when the project-access lookup itself throws', async () => {
    mockPoolQuery = makeMockPoolQuery([
      { match: /jsonb_array_elements/, resolve: () => { throw new Error('access lookup exploded'); } },
    ]);
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'member@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect(res.statusCode).toBe(503);
  });

  it('403s when the caller has no project-access row at all (not a member)', async () => {
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'stranger@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect(res.statusCode).toBe(403);
    expect((res.body as any).error).toMatch(/not a member of this project/);
  });

  it('allows a project_owner through regardless of agentAccessScoped/assignments', async () => {
    mockPoolQuery = makeMockPoolQuery([
      { match: /jsonb_array_elements/, resolve: () => ({ rows: [{ member_id: 'm-1', app_role: 'project_owner', agent_access_scoped: true, agent_assignments: [] }] }) },
    ]);
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'owner@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: true });
  });

  it('allows a legacy/grandfathered member (agentAccessScoped falsy) full access', async () => {
    mockPoolQuery = makeMockPoolQuery([
      { match: /jsonb_array_elements/, resolve: () => ({ rows: [{ member_id: 'm-1', app_role: 'editor', agent_access_scoped: false, agent_assignments: [] }] }) },
    ]);
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'legacy-editor@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: true });
  });

  it('allows a scoped member assigned to this specific agent', async () => {
    mockPoolQuery = makeMockPoolQuery([
      {
        match: /jsonb_array_elements/,
        resolve: () => ({
          rows: [{
            member_id: 'm-1', app_role: 'editor', agent_access_scoped: true,
            agent_assignments: [{ agentId: 'architecture', memberIds: ['m-1'] }],
          }],
        }),
      },
    ]);
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'scoped-editor@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: true });
  });

  it('denies a scoped member NOT assigned to this agent, with the "ask your Project Owner" message', async () => {
    mockPoolQuery = makeMockPoolQuery([
      {
        match: /jsonb_array_elements/,
        resolve: () => ({
          rows: [{
            member_id: 'm-1', app_role: 'editor', agent_access_scoped: true,
            agent_assignments: [{ agentId: 'apiDesign', memberIds: ['m-1'] }], // assigned to a different agent
          }],
        }),
      },
    ]);
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'scoped-editor@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect(res.statusCode).toBe(403);
    expect((res.body as any).error).toMatch(/not assigned to run this agent/);
  });

  it('denies a scoped member when agent_assignments is missing/malformed (defensive default to empty)', async () => {
    mockPoolQuery = makeMockPoolQuery([
      { match: /jsonb_array_elements/, resolve: () => ({ rows: [{ member_id: 'm-1', app_role: 'editor', agent_access_scoped: true, agent_assignments: null }] }) },
    ]);
    const { authorizeAgentRun } = require('./proxy');
    const res = fakeResponse();
    const result = await authorizeAgentRun({ authUser: { email: 'scoped-editor@example.com' } }, res, { projectId: 'proj-1', agentId: 'architecture' });
    expect(result).toEqual({ ok: false });
    expect(res.statusCode).toBe(403);
  });
});
