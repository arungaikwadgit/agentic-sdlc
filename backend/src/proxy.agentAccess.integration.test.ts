// backend/src/proxy.agentAccess.integration.test.ts
//
// Integration tests for the per-agent access-scoping feature added 2026-07-11
// (mandatory-agent-assignment invites — see InviteModal in
// frontend/src/components/settings/ProjectSettings.tsx for the UI half, and
// frontend/src/lib/projectAccess.ts's getAgentRunPermission for the frontend
// mirror of this same rule).
//
// authorizeAgentRun()/getCallerAgentAccess() read projects.data JSONB
// directly via a real pg.Pool (there is no in-memory fallback for this
// check — see the "fail-open when dbPool is unavailable" branch, tested
// separately below without a DB). Like proxy.inviteFlow.integration.test.ts,
// this suite requires a real Postgres and is skipped (not failed) when one
// isn't configured, so `npm test` still passes for contributors without a
// local database.
//
// authorizeAgentRun()/getCallerAgentAccess() are called directly (not via
// HTTP) with a hand-built req/res, the same workaround
// proxy.inviteFlow.integration.test.ts documents for exercising email-based
// authorization branches without a real Supabase JWT (checkToken() only
// recognizes the admin-bypass token or a verified Supabase session, and
// SUPABASE_URL is intentionally unset in this suite).

// Forces TS to treat this file as a module (its own scope) instead of a
// global script. Without this, top-level `const`s here collide with the
// same names in proxy.inviteAccept.integration.test.ts and
// proxy.inviteFlow.integration.test.ts (TS2451: Cannot redeclare
// block-scoped variable), since none of the three files have any other
// import/export statement.
export {};

const TEST_DB_URL = process.env.POSTGRES_URL_TEST || process.env.POSTGRES_URL_LOCAL || process.env.POSTGRES_URL || '';

const describeOrSkip = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[proxy.agentAccess.integration.test.ts] Skipped — no POSTGRES_URL_TEST/POSTGRES_URL_LOCAL/POSTGRES_URL ' +
    'configured. Run with a real Postgres (e.g. `docker compose up -d db` then ' +
    'POSTGRES_URL_TEST=postgres://... npm test) to exercise these tests.'
  );
}

describeOrSkip('per-agent access scoping (authorizeAgentRun, integration, real Postgres)', () => {
  const ORIGINAL_ENV = { ...process.env };
  let authorizeAgentRun: any;
  let dbAdmin: any; // raw pg.Pool used only by the test to set up/tear down fixtures

  const OWNER_EMAIL = 'owner-agentaccess@example.com';
  const SCOPED_EDITOR_EMAIL = 'scoped-editor-agentaccess@example.com';
  const LEGACY_EDITOR_EMAIL = 'legacy-editor-agentaccess@example.com';
  const REVIEWER_EMAIL = 'reviewer-agentaccess@example.com';
  const ADMIN_EMAIL = 'admin-agentaccess@example.com';

  const ARCH_AGENT = 'architecture';
  const API_DESIGN_AGENT = 'apiDesign';

  beforeAll(async () => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      PORT: '0',
      NODE_ENV: 'test',
      POSTGRES_URL: TEST_DB_URL,
      POSTGRES_URL_LOCAL: TEST_DB_URL,
      ADMIN_EMAIL_ALLOWLIST: ADMIN_EMAIL,
      RESEND_API_KEY: '',
      RESEND_FROM_EMAIL: '',
      GMAIL_USER: '',
      GMAIL_APP_PASSWORD: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const proxyModule = require('./proxy');
    authorizeAgentRun = proxyModule.authorizeAgentRun;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg');
    dbAdmin = new Pool({ connectionString: TEST_DB_URL });

    // Give proxy.js's own async dbPool connection a moment to settle.
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    process.env = ORIGINAL_ENV;
    await dbAdmin?.end();
  });

  let projectId: string;

  beforeEach(async () => {
    const teamMembers = [
      { id: 'owner-1', email: OWNER_EMAIL, appRole: 'project_owner', agentAccessScoped: true },
      { id: 'scoped-editor-1', email: SCOPED_EDITOR_EMAIL, appRole: 'editor', agentAccessScoped: true },
      { id: 'legacy-editor-1', email: LEGACY_EDITOR_EMAIL, appRole: 'editor' }, // agentAccessScoped omitted — grandfathered
      { id: 'reviewer-1', email: REVIEWER_EMAIL, appRole: 'reviewer', agentAccessScoped: true },
    ];
    const agentAssignments = [
      { agentId: ARCH_AGENT, memberIds: ['scoped-editor-1'] },
      // API_DESIGN_AGENT intentionally has no assignment entry at all.
    ];
    const projectRes = await dbAdmin.query(
      `INSERT INTO projects (name, data) VALUES ($1, $2::jsonb) RETURNING id`,
      ['Agent Access Test Project', JSON.stringify({ teamMembers, agentAssignments })],
    );
    projectId = projectRes.rows[0].id;
  });

  afterEach(async () => {
    await dbAdmin.query(`DELETE FROM projects WHERE id = $1`, [projectId]).catch(() => {});
  });

  function fakeReqRes(email: string | null, opts: { adminBypass?: boolean } = {}) {
    const req: any = { authUser: opts.adminBypass ? { adminBypass: true } : { email } };
    const res: any = {
      _status: null as number | null,
      _body: null as any,
      status(code: number) { this._status = code; return this; },
      json(body: any) { this._body = body; return this; },
    };
    return { req, res };
  }

  it('skips entirely (allows) when projectId or agentId is missing — meta/utility calls are out of scope', async () => {
    const { req, res } = fakeReqRes(SCOPED_EDITOR_EMAIL);
    const noProject = await authorizeAgentRun(req, res, { projectId: null, agentId: ARCH_AGENT });
    expect(noProject).toEqual({ ok: true, skipped: true });
    const noAgent = await authorizeAgentRun(req, res, { projectId, agentId: null });
    expect(noAgent).toEqual({ ok: true, skipped: true });
  });

  it('allows the admin-bypass identity regardless of assignment', async () => {
    const { req, res } = fakeReqRes(null, { adminBypass: true });
    const result = await authorizeAgentRun(req, res, { projectId, agentId: API_DESIGN_AGENT });
    expect(result.ok).toBe(true);
  });

  it('allows a configured app-admin email regardless of assignment', async () => {
    const { req, res } = fakeReqRes(ADMIN_EMAIL);
    const result = await authorizeAgentRun(req, res, { projectId, agentId: API_DESIGN_AGENT });
    expect(result.ok).toBe(true);
  });

  it('allows Project Owner to run an agent with no assignment entry at all', async () => {
    const { req, res } = fakeReqRes(OWNER_EMAIL);
    const result = await authorizeAgentRun(req, res, { projectId, agentId: API_DESIGN_AGENT });
    expect(result.ok).toBe(true);
  });

  it('allows a scoped Editor to run an agent explicitly assigned to them', async () => {
    const { req, res } = fakeReqRes(SCOPED_EDITOR_EMAIL);
    const result = await authorizeAgentRun(req, res, { projectId, agentId: ARCH_AGENT });
    expect(result.ok).toBe(true);
  });

  it('denies (403) a scoped Editor for an agent NOT in their assignment', async () => {
    const { req, res } = fakeReqRes(SCOPED_EDITOR_EMAIL);
    const result = await authorizeAgentRun(req, res, { projectId, agentId: API_DESIGN_AGENT });
    expect(result.ok).toBe(false);
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/not assigned to run this agent/i);
  });

  it('allows a legacy (agentAccessScoped falsy) Editor for any agent — grandfathering', async () => {
    const { req, res } = fakeReqRes(LEGACY_EDITOR_EMAIL);
    const result = await authorizeAgentRun(req, res, { projectId, agentId: API_DESIGN_AGENT });
    expect(result.ok).toBe(true);
  });

  it('skips (does not 403) a caller with no roster entry for this project — leaves it to other project-level auth', async () => {
    const { req, res } = fakeReqRes('not-a-member-at-all@example.com');
    const result = await authorizeAgentRun(req, res, { projectId, agentId: API_DESIGN_AGENT });
    expect(result).toEqual({ ok: true, skipped: true });
  });

  it('skips (allows) when there is no resolvable caller identity at all', async () => {
    const { req, res } = fakeReqRes(null);
    const result = await authorizeAgentRun(req, res, { projectId, agentId: API_DESIGN_AGENT });
    expect(result).toEqual({ ok: true, skipped: true });
  });

  it('a Reviewer with agentAccessScoped is still evaluated by this function the same as an Editor would be (denied when unassigned)', async () => {
    // authorizeAgentRun itself doesn't special-case appRole beyond
    // project_owner — Reviewer/Viewer's inability to run ANY agent is
    // enforced earlier, at the appRole/canRunAgents level (see
    // ROLE_PERMISSIONS in frontend/src/types/project.types.ts and the
    // client-side canRunProjectAgents gate). This test just documents that
    // this function alone would deny an unassigned agent for a scoped
    // non-owner regardless of which non-owner role it is.
    const { req, res } = fakeReqRes(REVIEWER_EMAIL);
    const result = await authorizeAgentRun(req, res, { projectId, agentId: API_DESIGN_AGENT });
    expect(result.ok).toBe(false);
    expect(res._status).toBe(403);
  });

  // AI Governance MVP-0 (2026-07-21) — kill-switch ordering
  // (backend/src/routes/agentControls.js's resolveAgentKillSwitch(), called
  // from authorizeAgentRun() before the admin-bypass/admin-email checks
  // below it — see that function's own comment for why). Uses a dedicated,
  // never-reused agentId so a leftover row can never affect any other test
  // in this file (agent_global_settings/project_agent_overrides are not
  // deleted by this file's own afterEach, which only clears `projects`) —
  // each test cleans up its own row explicitly in a try/finally.
  describe('kill switch (resolveAgentKillSwitch integration via authorizeAgentRun)', () => {
    const KILL_SWITCH_AGENT = 'killSwitchTestAgent';

    it('blocks even an admin-bypass caller when the agent is globally disabled — a kill switch an admin can silently bypass is not a real kill switch', async () => {
      await dbAdmin.query(
        `INSERT INTO agent_global_settings (agent_id, disabled) VALUES ($1, TRUE)
         ON CONFLICT (agent_id) DO UPDATE SET disabled = TRUE`,
        [KILL_SWITCH_AGENT],
      );
      try {
        const { req, res } = fakeReqRes(null, { adminBypass: true });
        const result = await authorizeAgentRun(req, res, { projectId, agentId: KILL_SWITCH_AGENT });
        expect(result.ok).toBe(false);
        expect(res._status).toBe(403);
        expect(res._body.error).toMatch(/disabled/i);
      } finally {
        await dbAdmin.query(`DELETE FROM agent_global_settings WHERE agent_id = $1`, [KILL_SWITCH_AGENT]);
      }
    });

    it('a per-project override (explicitly enabled) wins over a global disable', async () => {
      await dbAdmin.query(
        `INSERT INTO agent_global_settings (agent_id, disabled) VALUES ($1, TRUE)
         ON CONFLICT (agent_id) DO UPDATE SET disabled = TRUE`,
        [KILL_SWITCH_AGENT],
      );
      await dbAdmin.query(
        `INSERT INTO project_agent_overrides (project_id, agent_id, disabled) VALUES ($1, $2, FALSE)
         ON CONFLICT (project_id, agent_id) DO UPDATE SET disabled = FALSE`,
        [projectId, KILL_SWITCH_AGENT],
      );
      try {
        const { req, res } = fakeReqRes(OWNER_EMAIL);
        const result = await authorizeAgentRun(req, res, { projectId, agentId: KILL_SWITCH_AGENT });
        expect(result.ok).toBe(true);
      } finally {
        await dbAdmin.query(`DELETE FROM agent_global_settings WHERE agent_id = $1`, [KILL_SWITCH_AGENT]);
        await dbAdmin.query(`DELETE FROM project_agent_overrides WHERE project_id = $1 AND agent_id = $2`, [projectId, KILL_SWITCH_AGENT]);
      }
    });

    it('is a no-op (not disabled) when no row exists for the agent at all — matches every other enabled-by-default flag in this codebase', async () => {
      const { req, res } = fakeReqRes(OWNER_EMAIL);
      const result = await authorizeAgentRun(req, res, { projectId, agentId: KILL_SWITCH_AGENT });
      expect(result.ok).toBe(true);
    });
  });
});
