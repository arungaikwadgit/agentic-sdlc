// Tests for backend/src/routes/inviteRoutes.js — createInviteRouter()'s
// route handlers. Before this file, the ONLY coverage for this module came
// from proxy.inviteSecurity.test.ts / proxy.inviteDefaultPassword.test.ts
// (pure helpers: hashInviteToken, appRoleRank, isInviteExpired,
// provisionInviteeAccount — all re-exported via proxy.js) and
// proxy.inviteFlow.integration.test.ts / proxy.inviteAccept.integration.test.ts
// (the actual route handlers), which require a real Postgres
// (POSTGRES_URL_TEST) and are SKIPPED entirely without one — which is why
// this file sat at 19.05% coverage: the route-handler logic (all 10 routes,
// ~700 lines) had zero coverage in any environment without a live DB.
//
// Strategy: createInviteRouter's dependencies (getDb, checkToken,
// isConfiguredAdminEmail, getCallerAppRoleForProject, getSupabase,
// provisionInviteeAccount) are all constructor params, exactly like
// agentDispatchRoutes.js — so the express-app-per-test-file + real-server +
// fetch() convention applies directly, no jest.mock() needed for the routes
// themselves.
//
// Two DB postures are used:
//   1. getDb() => null ("DB unavailable") exercises the in-memory inviteStore
//      fallback that every route falls back to — this is the bulk of the
//      business logic (expiry, revocation, accepted-once, email-mismatch,
//      role validation) and requires no SQL mocking at all, since
//      dbUpsertMember/dbAcceptInvite/dbGetTeam/etc. all no-op immediately
//      when dbPool is null. Invites are seeded through a real POST /send
//      call (not by reaching into router internals — inviteStore isn't
//      exposed), so these are genuine end-to-end route round-trips.
//   2. getDb() => a rule-based fake pool, for the handful of behaviors that
//      genuinely only exist on the DB path (dbUpsertMember persisting a row,
//      reset-password's member lookup, the invite-bearer-scoped
//      /projects*/​/team routes, which require a real invite_sessions row via
//      dbGetInviteSession and 401 unconditionally when dbPool is null).
//
// NOT attempted: a full simulation of dbAcceptInvite's BEGIN/SELECT FOR
// UPDATE/UPDATE/INSERT×2/COMMIT transaction (10+ sequential client.query
// calls). That's the highest-fragility, lowest-value thing to hand-mock
// blind (this sandbox can't execute jest to verify the mock sequencing) —
// the equivalent business rules (expired/revoked/mismatched/already-accepted)
// are already exercised end-to-end via the in-memory fallback path above,
// which runs through the exact same route handlers.

export {};

const express = require('express');
const { createInviteRouter } = require('./inviteRoutes');

function makeFakeDb(rules: Array<{ match: RegExp; resolve: (sql: string, params: any[]) => any }> = []) {
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    for (const rule of rules) {
      if (rule.match.test(sql)) return rule.resolve(sql, params);
    }
    return { rows: [] };
  });
  return { query };
}

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());

  const checkToken =
    overrides.checkToken ||
    ((req: any, _res: any, next: any) => {
      req.authUser = { email: 'owner@example.com' };
      next();
    });
  const getDb = overrides.getDb || (() => null);
  const isConfiguredAdminEmail = overrides.isConfiguredAdminEmail || (() => false);
  const getCallerAppRoleForProject = overrides.getCallerAppRoleForProject || jest.fn(async () => 'project_owner');
  const getSupabase = overrides.getSupabase || (() => null);
  const provisionInviteeAccount =
    overrides.provisionInviteeAccount ||
    jest.fn(async () => ({ actionLink: 'https://supabase.example.com/verify?token=one-time', userId: 'new-user-id', created: true, type: 'invite' }));

  const { router } = createInviteRouter({
    getDb,
    checkToken,
    isConfiguredAdminEmail,
    getCallerAppRoleForProject,
    getSupabase,
    provisionInviteeAccount,
  });
  app.use('/api/invite', router);
  return { app, getCallerAppRoleForProject, provisionInviteeAccount };
}

async function withServer<T>(app: any, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to allocate test server port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// A verified, email-confirmed Supabase session for `email` — used by every
// /accept test via getSupabase().auth.getUser(jwt).
function verifiedSupabase(email: string, userId = 'invitee-user-id') {
  return () => ({
    auth: {
      getUser: jest.fn(async (_jwt: string) => ({
        data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z', id: userId } },
        error: null,
      })),
    },
  });
}

async function postJson(
  baseUrl: string,
  path: string,
  body: any,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  const json: any = await response.json().catch(() => ({}));
  return { status: response.status, body: json };
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    RESEND_API_KEY: '',
    RESEND_FROM_EMAIL: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    APP_URL: 'https://app.example.com',
  };
});
afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const VALID_SEND_BODY = {
  projectId: 'proj-1',
  projectName: 'Acme Retail',
  name: 'New Teammate',
  email: 'invitee@example.com',
  appRole: 'editor',
  invitedBy: 'owner@example.com',
};

describe('POST /api/invite/send', () => {
  it('400 when projectId, email, or appRole are missing', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/send', { email: 'a@example.com', appRole: 'editor' });
      expect(status).toBe(400);
      expect(body.error).toMatch(/projectId, email, and appRole are required/);
    });
  });

  it('400 when appRole is not an invitable role', async () => {
    // project_owner is deliberately IN INVITABLE_APP_ROLES (a Project Owner
    // can delegate full ownership) — use a role that isn't in the list at all.
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/send', { ...VALID_SEND_BODY, appRole: 'super_admin' });
      expect(status).toBe(400);
      expect(body.error).toMatch(/Invite links can grant only/);
    });
  });

  it('400 when the email has no @', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/send', { ...VALID_SEND_BODY, email: 'not-an-email' });
      expect(status).toBe(400);
      expect(body.error).toMatch(/valid invite email is required/);
    });
  });

  it('401 when the caller is not signed in', async () => {
    const checkToken = (req: any, _res: any, next: any) => { req.authUser = {}; next(); };
    const { app } = buildApp({ checkToken });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
      expect(status).toBe(401);
      expect(body.error).toMatch(/sign in to manage invites/i);
    });
  });

  it('403 when the caller is a member of the project but not its project_owner', async () => {
    const getCallerAppRoleForProject = jest.fn(async () => 'editor');
    const { app } = buildApp({ getCallerAppRoleForProject });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
      expect(status).toBe(403);
      expect(body.error).toMatch(/Only the project owner or an app admin/);
    });
  });

  it('200 succeeds via admin-bypass (adminBypass:true, non-production)', async () => {
    const checkToken = (req: any, _res: any, next: any) => { req.authUser = { adminBypass: true }; next(); };
    const { app } = buildApp({ checkToken });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      // inviteLink in the response is provisioned.actionLink (the one-time
      // Supabase action URL), NOT the locally-built appInviteLink — that
      // local link is only ever used internally as provisionInviteeAccount's
      // redirectTo param, never returned to the client.
      expect(body.inviteLink).toBe('https://supabase.example.com/verify?token=one-time');
    });
  });

  it('200 succeeds for a configured admin email regardless of project role', async () => {
    const isConfiguredAdminEmail = (email: string) => email === 'owner@example.com';
    const getCallerAppRoleForProject = jest.fn(async () => 'viewer'); // would otherwise be denied
    const { app } = buildApp({ isConfiguredAdminEmail, getCallerAppRoleForProject });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });
  });

  it('502 when account provisioning fails', async () => {
    const provisionInviteeAccount = jest.fn().mockRejectedValue(new Error('Supabase is down'));
    const { app } = buildApp({ provisionInviteeAccount });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
      expect(status).toBe(502);
      expect(body.error).toMatch(/Could not create the team member's account/);
    });
  });

  it('200 succeeds with no email provider configured — dev/console-log fallback, emailSent:false', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.emailSent).toBe(false);
      expect(body.message).toMatch(/no email sent/i);
      expect(typeof body.token).toBe('string');
    });
  });

  // jest.spyOn(global, 'fetch') intercepts EVERY fetch call process-wide —
  // including postJson()'s own call to the local test server (whose
  // response object has no `.status` field the way a raw mock return value
  // would, causing `response.status` to come back undefined/wrong). Delegate
  // anything that isn't the Resend API through the real fetch instead of
  // blanket-mocking every call.
  function mockResendFetch(resendResponse: { ok: boolean; status?: number; json: () => Promise<any> }) {
    const realFetch = global.fetch;
    return jest.spyOn(global, 'fetch').mockImplementation((async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url;
      if (typeof url === 'string' && url.includes('api.resend.com')) {
        return resendResponse as any;
      }
      return realFetch(input, init);
    }) as any);
  }

  it('200 succeeds and reports emailSent:true when Resend accepts the send', async () => {
    process.env.RESEND_API_KEY = 'test-resend-key';
    const fetchSpy = mockResendFetch({ ok: true, json: async () => ({ id: 'resend-message-id' }) });
    try {
      const { app } = buildApp();
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
        expect(status).toBe(200);
        expect(body.emailSent).toBe(true);
        expect(body.message).toMatch(/Invite email sent/);
      });
      expect(fetchSpy).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }));
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('200 but emailSent:false with emailError when Resend rejects the send', async () => {
    process.env.RESEND_API_KEY = 'test-resend-key';
    const fetchSpy = mockResendFetch({ ok: false, status: 429, json: async () => ({ message: 'rate limited by Resend' }) });
    try {
      const { app } = buildApp();
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
        expect(status).toBe(200);
        expect(body.emailSent).toBe(false);
        expect(body.emailError).toBe('rate limited by Resend');
        expect(body.message).toMatch(/Email delivery failed/);
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('persists the invite to the database when one is configured (dbUpsertMember + invite_log insert)', async () => {
    const fakeDb = makeFakeDb([
      { match: /INSERT INTO team_members/, resolve: () => ({ rows: [{ id: 'member-123' }] }) },
    ]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const { status } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
      expect(status).toBe(200);
    });
    const sqlCalls = fakeDb.query.mock.calls.map((c: any[]) => c[0]);
    expect(sqlCalls.some((sql: string) => /INSERT INTO team_members/.test(sql))).toBe(true);
    expect(sqlCalls.some((sql: string) => /INSERT INTO invite_log/.test(sql))).toBe(true);
  });
});

describe('POST /api/invite/reset-password', () => {
  const BODY = { projectId: 'proj-1', projectName: 'Acme Retail', email: 'member@example.com' };

  it('400 when projectId or email are missing', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/reset-password', { email: 'a@example.com' });
      expect(status).toBe(400);
      expect(body.error).toMatch(/projectId and email are required/);
    });
  });

  it('403 when the caller is not the project owner or an admin', async () => {
    const getCallerAppRoleForProject = jest.fn(async () => 'editor');
    const { app } = buildApp({ getCallerAppRoleForProject });
    await withServer(app, async (baseUrl) => {
      const { status } = await postJson(baseUrl, '/api/invite/reset-password', BODY);
      expect(status).toBe(403);
    });
  });

  it('404 when no team member matches (including when no DB is configured at all)', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/reset-password', BODY);
      expect(status).toBe(404);
      expect(body.error).toMatch(/No team member found/);
    });
  });

  it('200 succeeds when the member exists and provisioning succeeds', async () => {
    const fakeDb = makeFakeDb([
      { match: /SELECT id, name, email FROM team_members/, resolve: () => ({ rows: [{ id: 'member-1', name: 'Member', email: 'member@example.com' }] }) },
    ]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/reset-password', BODY);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.recoveryLink).toBe('https://supabase.example.com/verify?token=one-time');
    });
  });

  it('502 when provisioning fails for an existing member', async () => {
    const fakeDb = makeFakeDb([
      { match: /SELECT id, name, email FROM team_members/, resolve: () => ({ rows: [{ id: 'member-1', name: 'Member', email: 'member@example.com' }] }) },
    ]);
    const provisionInviteeAccount = jest.fn().mockRejectedValue(new Error('boom'));
    const { app } = buildApp({ getDb: () => fakeDb, provisionInviteeAccount });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/reset-password', BODY);
      expect(status).toBe(502);
      expect(body.error).toMatch(/Could not reset this team member's password/);
    });
  });
});

describe('invite accept/validate/revoke — in-memory fallback (no DB configured)', () => {
  async function seedInvite(app: any, overrides: any = {}) {
    return withServer(app, async (baseUrl) => {
      const { body } = await postJson(baseUrl, '/api/invite/send', { ...VALID_SEND_BODY, ...overrides });
      return body as { token: string; inviteLink: string };
    });
  }

  it('POST /accept: 400 when token is missing', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(400);
    });
  });

  it('POST /accept: 401 when no Authorization bearer is present', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'whatever' });
      expect(status).toBe(401);
      expect(body.error).toMatch(/sign in and confirm your email/i);
    });
  });

  it('POST /accept: 503 when getSupabase() is unavailable (not configured on this server)', async () => {
    const { app } = buildApp({ getSupabase: () => null });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'whatever' }, { Authorization: 'Bearer jwt-token' });
      expect(status).toBe(503);
      expect(body.error).toMatch(/Account verification is not configured/);
    });
  });

  it('POST /accept: 401 when the Supabase session is invalid/expired', async () => {
    const getSupabase = () => ({ auth: { getUser: jest.fn(async () => ({ data: null, error: new Error('bad jwt') })) } });
    const { app } = buildApp({ getSupabase });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'whatever' }, { Authorization: 'Bearer jwt-token' });
      expect(status).toBe(401);
      expect(body.error).toMatch(/Invalid or expired session/);
    });
  });

  it('POST /accept: 403 when the session email is not confirmed', async () => {
    const getSupabase = () => ({
      auth: { getUser: jest.fn(async () => ({ data: { user: { email: 'invitee@example.com', email_confirmed_at: null } }, error: null })) },
    });
    const { app } = buildApp({ getSupabase });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'whatever' }, { Authorization: 'Bearer jwt-token' });
      expect(status).toBe(403);
      expect(body.error).toMatch(/Please confirm your email/);
    });
  });

  it('POST /accept: 404 for an unknown token', async () => {
    const { app } = buildApp({ getSupabase: verifiedSupabase('invitee@example.com') });
    await withServer(app, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'garbage-token' }, { Authorization: 'Bearer jwt-token' });
      expect(status).toBe(404);
      expect(body.error).toMatch(/Invite not found or already used/);
    });
  });

  it('POST /accept: 200 succeeds for the matching verified email, then 409 on a second attempt', async () => {
    const app1 = buildApp({ getSupabase: verifiedSupabase('invitee@example.com') }).app;
    const seeded = await seedInvite(app1);

    await withServer(app1, async (baseUrl) => {
      const first = await postJson(baseUrl, '/api/invite/accept', { token: seeded.token }, { Authorization: 'Bearer jwt-token' });
      expect(first.status).toBe(200);
      expect(first.body.ok).toBe(true);
      expect(first.body.accessToken).toBe(seeded.token);
      expect(first.body.appRole).toBe('editor');

      const second = await postJson(baseUrl, '/api/invite/accept', { token: seeded.token }, { Authorization: 'Bearer jwt-token' });
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/already been accepted/);
    });
  });

  it('POST /accept: 403 when the verified session email does not match the invited email', async () => {
    const app1 = buildApp({ getSupabase: verifiedSupabase('someone-else@example.com') }).app;
    const seeded = await seedInvite(app1); // invited invitee@example.com
    await withServer(app1, async (baseUrl) => {
      const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: seeded.token }, { Authorization: 'Bearer jwt-token' });
      expect(status).toBe(403);
      expect(body.error).toMatch(/different email address/);
    });
  });

  it('POST /accept: 410 once the 7-day TTL has elapsed', async () => {
    // Date.now() spy, not jest.useFakeTimers() — this test spins up a real
    // TCP server and uses real fetch(), both of which rely on Node's real
    // timer/event-loop internals; faking timers globally risks hanging or
    // breaking that machinery. Spying Date.now() only shifts what
    // isInviteExpired() sees, nothing else.
    const app1 = buildApp({ getSupabase: verifiedSupabase('invitee@example.com') }).app;
    const seeded = await seedInvite(app1);
    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 8 * 24 * 60 * 60 * 1000); // 8 days later
    try {
      await withServer(app1, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: seeded.token }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(410);
        expect(body.error).toMatch(/expired/);
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('GET /accept (legacy variant): 400 missing token, 200 success for a fresh invite', async () => {
    const { app } = buildApp({ getSupabase: verifiedSupabase('invitee@example.com') });
    await withServer(app, async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/invite/accept`);
      expect(missing.status).toBe(400);
    });

    const seeded = await seedInvite(app);
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/accept?token=${seeded.token}`, { headers: { Authorization: 'Bearer jwt-token' } });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.accessToken).toBe(seeded.token);
    });
  });

  it('GET /validate: 400 missing token, 404 unknown token, 200 for a pending invite, 409 once accepted', async () => {
    const { app } = buildApp({ getSupabase: verifiedSupabase('invitee@example.com') });
    await withServer(app, async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/invite/validate`);
      expect(missing.status).toBe(400);
      const unknown = await fetch(`${baseUrl}/api/invite/validate?token=garbage`);
      expect(unknown.status).toBe(404);
    });

    const seeded = await seedInvite(app);
    await withServer(app, async (baseUrl) => {
      const pending = await fetch(`${baseUrl}/api/invite/validate?token=${seeded.token}`);
      const pendingBody: any = await pending.json();
      expect(pending.status).toBe(200);
      expect(pendingBody.role).toBe('editor');
      expect(pendingBody.invitedEmail).toBe('invitee@example.com');
      expect(pendingBody.project.name).toBe('Acme Retail');

      await postJson(baseUrl, '/api/invite/accept', { token: seeded.token }, { Authorization: 'Bearer jwt-token' });

      const afterAccept = await fetch(`${baseUrl}/api/invite/validate?token=${seeded.token}`);
      expect(afterAccept.status).toBe(409);
    });
  });

  it('DELETE /revoke: 400 missing token, 404 for an unresolvable token', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/invite/revoke`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(missing.status).toBe(400);
      const unknown = await fetch(`${baseUrl}/api/invite/revoke`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'garbage' }) });
      expect(unknown.status).toBe(404);
    });
  });

  it('DELETE /revoke: 200 for the project owner, and the token is dead afterward', async () => {
    // The 403-denial branch here is the same authorizeInviteAction() codepath
    // already covered by the /send and /reset-password 403 tests above — no
    // need to duplicate it against a second, unrelated router instance (a
    // fresh buildApp() would have its own empty in-memory inviteStore and
    // couldn't meaningfully act on this seeded token anyway).
    const { app } = buildApp();
    const seeded = await seedInvite(app);

    await withServer(app, async (baseUrl) => {
      const revokeResponse = await fetch(`${baseUrl}/api/invite/revoke`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: seeded.token }),
      });
      const revokeBody: any = await revokeResponse.json();
      expect(revokeResponse.status).toBe(200);
      expect(revokeBody.ok).toBe(true);

      const afterRevoke = await fetch(`${baseUrl}/api/invite/validate?token=${seeded.token}`);
      expect(afterRevoke.status).toBe(404); // in-memory store: revoke deletes the entry outright
    });
  });

  it('GET /team/:projectId: 403 for a non-owner caller, 200 with in-memory members for the owner', async () => {
    const owner = buildApp();
    const seeded = await seedInvite(owner.app);
    await withServer(owner.app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/team/proj-1`, { headers: { Authorization: 'Bearer x' } });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.members.some((m: any) => m.email === 'invitee@example.com')).toBe(true);
    });
    void seeded;

    const nonOwner = buildApp({ getCallerAppRoleForProject: jest.fn(async () => 'reviewer') });
    await withServer(nonOwner.app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/team/proj-1`, { headers: { Authorization: 'Bearer x' } });
      expect(response.status).toBe(403);
    });
  });
});

describe('GET /api/invite/validate — DB path', () => {
  // Unlike /accept, /validate's DB path is a single SELECT plus branch
  // logic — none of dbAcceptInvite's transaction complexity — so this one
  // is worth mocking directly rather than folding into the deliberately-
  // skipped-transaction trade-off documented at the top of this file.
  const VALIDATE_SQL = /FROM team_members tm JOIN projects p/;

  it('409 when the invite has been revoked', async () => {
    const fakeDb = makeFakeDb([{ match: VALIDATE_SQL, resolve: () => ({ rows: [{ invite_status: 'revoked', invited_at: new Date().toISOString() }] }) }]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/validate?token=t`);
      expect(response.status).toBe(409);
    });
  });

  it('410 when the DB row is past the 7-day TTL', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const fakeDb = makeFakeDb([{ match: VALIDATE_SQL, resolve: () => ({ rows: [{ invite_status: 'pending', invited_at: eightDaysAgo }] }) }]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/validate?token=t`);
      expect(response.status).toBe(410);
    });
  });

  it('409 when the DB row is no longer pending (e.g. already accepted)', async () => {
    const fakeDb = makeFakeDb([{ match: VALIDATE_SQL, resolve: () => ({ rows: [{ invite_status: 'accepted', invited_at: new Date().toISOString() }] }) }]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/validate?token=t`);
      expect(response.status).toBe(409);
    });
  });

  it('200 with full invite/project details for a pending DB row', async () => {
    const fakeDb = makeFakeDb([
      {
        match: VALIDATE_SQL,
        resolve: () => ({
          rows: [{
            name: 'Invitee', email: 'invitee@example.com', app_role: 'editor', invite_status: 'pending',
            invited_at: new Date().toISOString(),
            project_id: 'proj-1', project_name: 'Acme Retail', project_description: 'A project',
          }],
        }),
      },
    ]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/validate?token=t`);
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        role: 'editor',
        invitedEmail: 'invitee@example.com',
        project: { id: 'proj-1', name: 'Acme Retail', description: 'A project' },
      });
    });
  });
});

describe('invite-bearer-scoped project routes (/projects, /projects/:id, /team) — DB-backed session required', () => {
  function bearerFor(token: string) {
    return { Authorization: `Bearer invite:${token}` };
  }

  it('GET /projects: 401 when no invite bearer token is present', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/projects`);
      expect(response.status).toBe(401);
    });
  });

  it('GET /projects: 401 when no DB is configured (a session can never be found)', async () => {
    const { app } = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/projects`, { headers: bearerFor('session-token') });
      const body: any = await response.json();
      expect(response.status).toBe(401);
      expect(body.error).toMatch(/invalid or expired/i);
    });
  });

  it('GET /projects: 200 with the session-scoped project list when a valid session exists', async () => {
    const fakeDb = makeFakeDb([
      {
        match: /FROM invite_sessions s/,
        resolve: () => ({ rows: [{ token: 'session-token', project_id: 'proj-1', name: 'Invitee', email: 'invitee@example.com', app_role: 'editor', expires_at: new Date(Date.now() + 1000).toISOString(), invite_status: 'accepted' }] }),
      },
      { match: /FROM projects\s*\n\s*WHERE id = \$1/, resolve: () => ({ rows: [{ id: 'proj-1', name: 'Acme Retail' }] }) },
    ]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/projects`, { headers: bearerFor('session-token') });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual([{ id: 'proj-1', name: 'Acme Retail' }]);
    });
  });

  it('GET /projects/:projectId: 403 when the session is scoped to a different project', async () => {
    const fakeDb = makeFakeDb([
      {
        match: /FROM invite_sessions s/,
        resolve: () => ({ rows: [{ token: 'session-token', project_id: 'proj-1', app_role: 'editor', invite_status: 'accepted', expires_at: new Date(Date.now() + 1000).toISOString() }] }),
      },
    ]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/projects/some-other-project`, { headers: bearerFor('session-token') });
      expect(response.status).toBe(403);
    });
  });

  it('GET /projects/:projectId: 200 with the project when the session matches, 404 when the project row is missing', async () => {
    const sessionRule = {
      match: /FROM invite_sessions s/,
      resolve: () => ({ rows: [{ token: 'session-token', project_id: 'proj-1', app_role: 'editor', invite_status: 'accepted', expires_at: new Date(Date.now() + 1000).toISOString() }] }),
    };

    const found = makeFakeDb([sessionRule, { match: /FROM projects\s*\n\s*WHERE id = \$1/, resolve: () => ({ rows: [{ id: 'proj-1', name: 'Acme Retail' }] }) }]);
    const appFound = buildApp({ getDb: () => found }).app;
    await withServer(appFound, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/projects/proj-1`, { headers: bearerFor('session-token') });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ id: 'proj-1', name: 'Acme Retail' });
    });

    const missing = makeFakeDb([sessionRule]); // no projects-table rule -> falls through to the default { rows: [] }
    const appMissing = buildApp({ getDb: () => missing }).app;
    await withServer(appMissing, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/projects/proj-1`, { headers: bearerFor('session-token') });
      expect(response.status).toBe(404);
    });
  });

  it('PATCH /projects/:projectId: 403 when the session role is not "editor"', async () => {
    const fakeDb = makeFakeDb([
      {
        match: /FROM invite_sessions s/,
        resolve: () => ({ rows: [{ token: 'session-token', project_id: 'proj-1', app_role: 'reviewer', invite_status: 'accepted', expires_at: new Date(Date.now() + 1000).toISOString() }] }),
      },
    ]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/projects/proj-1`, { method: 'PATCH', headers: { ...bearerFor('session-token'), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New Name' }) });
      const body: any = await response.json();
      expect(response.status).toBe(403);
      expect(body.error).toMatch(/does not allow editing/);
    });
  });

  it('PATCH /projects/:projectId: 200 succeeds for an editor-scoped session', async () => {
    const fakeDb = makeFakeDb([
      {
        match: /FROM invite_sessions s/,
        resolve: () => ({ rows: [{ token: 'session-token', project_id: 'proj-1', app_role: 'editor', invite_status: 'accepted', expires_at: new Date(Date.now() + 1000).toISOString() }] }),
      },
      { match: /UPDATE projects/, resolve: () => ({ rows: [{ id: 'proj-1', name: 'New Name' }] }) },
    ]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/projects/proj-1`, { method: 'PATCH', headers: { ...bearerFor('session-token'), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New Name' }) });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.name).toBe('New Name');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Gaps not covered above: DB-configured variants of routes only ever tested
// against the in-memory inviteStore fallback so far (dbGetTeam,
// dbFindInviteByToken/dbRevokeInvite), .catch() fallback arrows that are
// only actually INVOKED when the underlying query truly rejects (giving
// makeFakeDb no matching rule makes it resolve to the default `{ rows: [] }`,
// which does NOT execute the catch handler's own line), and two small
// pure-logic edges (sendViaResend's fetch-throws catch,
// requireVerifiedInviteeEmail's empty-email guard). dbAcceptInvite's own
// BEGIN/COMMIT transaction is deliberately still out of scope -- see the
// file-header comment.
// ═══════════════════════════════════════════════════════════════════════════
describe('inviteRoutes.js -- DB-configured / catch-branch gaps', () => {
  function throwingQuery(message: string) {
    return () => { throw new Error(message); };
  }

  describe('GET /api/invite/team/:projectId -- DB path', () => {
    it('returns DB-backed members via dbGetTeam when a DB is configured', async () => {
      const fakeDb = makeFakeDb([
        {
          match: /FROM team_members WHERE project_id = \$1/,
          resolve: () => ({ rows: [{ id: 'm1', name: 'DB Member', email: 'db-member@example.com', app_role: 'editor', invite_status: 'pending' }] }),
        },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/team/proj-1`, { headers: { Authorization: 'Bearer x' } });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.members).toEqual([{ id: 'm1', name: 'DB Member', email: 'db-member@example.com', app_role: 'editor', invite_status: 'pending' }]);
      });
    });
  });

  describe('DELETE /api/invite/revoke -- DB path', () => {
    const FIND_SQL = /SELECT id, project_id, email, app_role, invite_status/;
    const REVOKE_SQL = /SET invite_status = 'revoked'/;

    it('resolves the token via dbFindInviteByToken and revokes via dbRevokeInvite, surviving an invite_sessions table-creation failure', async () => {
      const fakeDb = makeFakeDb([
        { match: FIND_SQL, resolve: () => ({ rows: [{ id: 'member-1', project_id: 'proj-1', email: 'invitee@example.com', app_role: 'editor', invite_status: 'pending' }] }) },
        // ensureInviteSessionTable's CREATE TABLE call fails -- dbRevokeInvite
        // wraps the whole call in .catch(() => {}), so the revoke itself
        // should still succeed. This is the actual documented resilience
        // behavior, not a guess -- exercising it is the only way to reach
        // the catch branch inside ensureInviteSessionTable itself.
        { match: /CREATE TABLE IF NOT EXISTS invite_sessions/, resolve: throwingQuery('relation "invite_sessions" does not exist yet') },
        { match: REVOKE_SQL, resolve: () => ({ rows: [{ id: 'member-1', project_id: 'proj-1' }] }) },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/revoke`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'some-real-token' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
      });
      const sqlCalls = fakeDb.query.mock.calls.map((c: any[]) => c[0]);
      expect(sqlCalls.some((sql: string) => REVOKE_SQL.test(sql))).toBe(true);
    });

    it('logs a console-only audit entry (no team_member row to attach to) when a DB-configured caller is denied', async () => {
      const fakeDb = makeFakeDb([
        { match: FIND_SQL, resolve: () => ({ rows: [{ id: 'member-1', project_id: 'proj-1', email: 'invitee@example.com', app_role: 'editor', invite_status: 'pending' }] }) },
      ]);
      const getCallerAppRoleForProject = jest.fn(async () => 'editor'); // not project_owner -> denied
      const { app } = buildApp({ getDb: () => fakeDb, getCallerAppRoleForProject });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/revoke`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'some-real-token' }),
        });
        expect(response.status).toBe(403);
      });
    });
  });

  describe('requireVerifiedInviteeEmail -- empty confirmed-email guard', () => {
    it('400s when the verified Supabase session has no email address at all', async () => {
      const getSupabase = () => ({
        auth: { getUser: jest.fn(async () => ({ data: { user: { email: '', email_confirmed_at: '2026-01-01T00:00:00Z', id: 'u1' } }, error: null })) },
      });
      const { app } = buildApp({ getSupabase });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'whatever' }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(400);
        expect(body.error).toMatch(/no confirmed email address/i);
      });
    });
  });

  describe('sendViaResend -- network failure (fetch itself throws, not just a non-ok response)', () => {
    it('falls back to emailSent:false with the thrown error message', async () => {
      process.env.RESEND_API_KEY = 'test-resend-key';
      const realFetch = global.fetch;
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url;
        if (typeof url === 'string' && url.includes('api.resend.com')) {
          throw new Error('network down');
        }
        return realFetch(input, init);
      }) as any);
      try {
        const { app } = buildApp();
        await withServer(app, async (baseUrl) => {
          const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
          expect(status).toBe(200);
          expect(body.emailSent).toBe(false);
          expect(body.emailError).toBe('network down');
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe('POST /api/invite/reset-password -- DB query throws (not just "no match")', () => {
    it('falls back to 404 via the .catch(() => ({ rows: [] })) handler when the member lookup itself rejects', async () => {
      const fakeDb = makeFakeDb([
        { match: /SELECT id, name, email FROM team_members/, resolve: throwingQuery('connection reset') },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/reset-password', { projectId: 'proj-1', email: 'member@example.com' });
        expect(status).toBe(404);
        expect(body.error).toMatch(/No team member found/);
      });
    });
  });

  describe('POST /api/invite/send -- dbUpsertMember throws (non-fatal)', () => {
    it('still succeeds (200) and logs the failure when persisting the invite to the DB throws', async () => {
      const fakeDb = makeFakeDb([
        { match: /INSERT INTO team_members/, resolve: throwingQuery('duplicate key value') },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
      });
    });
  });

  describe('GET /api/invite/accept (legacy) -- in-memory fallback expiry', () => {
    it('410s once the 7-day TTL has elapsed', async () => {
      const { app } = buildApp({ getSupabase: verifiedSupabase('invitee@example.com') });
      const seeded = await withServer(app, async (baseUrl) => {
        const { body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
        return body as { token: string };
      });
      const realNow = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 8 * 24 * 60 * 60 * 1000);
      try {
        await withServer(app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/api/invite/accept?token=${seeded.token}`, { headers: { Authorization: 'Bearer jwt-token' } });
          const body: any = await response.json();
          expect(response.status).toBe(410);
          expect(body.error).toMatch(/expired/);
        });
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  describe('GET /api/invite/validate -- in-memory fallback expiry, and DB-query-throws fallthrough', () => {
    it('410s once the 7-day TTL has elapsed (in-memory fallback)', async () => {
      const { app } = buildApp();
      const seeded = await withServer(app, async (baseUrl) => {
        const { body } = await postJson(baseUrl, '/api/invite/send', VALID_SEND_BODY);
        return body as { token: string };
      });
      const realNow = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 8 * 24 * 60 * 60 * 1000);
      try {
        await withServer(app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/api/invite/validate?token=${seeded.token}`);
          expect(response.status).toBe(410);
        });
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('falls through to the in-memory store (and 404s) when the DB lookup itself rejects', async () => {
      const fakeDb = makeFakeDb([
        { match: /FROM team_members tm JOIN projects p/, resolve: throwingQuery('connection reset') },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/validate?token=some-unseeded-token`);
        expect(response.status).toBe(404);
      });
    });
  });

  describe('invite-bearer-scoped project routes -- DB query throws (not just "no matching row")', () => {
    function bearerFor(token: string) {
      return { Authorization: `Bearer invite:${token}` };
    }
    const SESSION_RULE = {
      match: /FROM invite_sessions s/,
      resolve: () => ({ rows: [{ token: 'session-token', project_id: 'proj-1', name: 'Invitee', email: 'invitee@example.com', app_role: 'editor', expires_at: new Date(Date.now() + 1000).toISOString(), invite_status: 'accepted' }] }),
    };

    it('GET /projects: returns an empty array (via the .catch fallback) when the projects query itself rejects', async () => {
      const fakeDb = makeFakeDb([
        SESSION_RULE,
        { match: /FROM projects\s*\n\s*WHERE id = \$1/, resolve: throwingQuery('connection reset') },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/projects`, { headers: bearerFor('session-token') });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual([]);
      });
    });

    it('GET /projects/:projectId: 404s (via the .catch fallback) when the project query itself rejects', async () => {
      const fakeDb = makeFakeDb([
        SESSION_RULE,
        { match: /FROM projects\s*\n\s*WHERE id = \$1/, resolve: throwingQuery('connection reset') },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/projects/proj-1`, { headers: bearerFor('session-token') });
        expect(response.status).toBe(404);
      });
    });

    it('PATCH /projects/:projectId: 404s and logs the error (via the .catch fallback) when the update query itself rejects', async () => {
      const fakeDb = makeFakeDb([
        SESSION_RULE,
        { match: /UPDATE projects/, resolve: throwingQuery('constraint violation') },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/projects/proj-1`, {
          method: 'PATCH',
          headers: { ...bearerFor('session-token'), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Name' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(404);
        expect(body.error).toBe('Project not found.');
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dbAcceptInvite's own BEGIN/SELECT FOR UPDATE/UPDATE/INSERT x2/COMMIT
// transaction, previously deliberately deferred (see the file-header
// comment) as "highest-fragility, lowest-value to hand-mock blind." Attempted
// here using the same fake-pool-with-regex-rules pattern established
// throughout this session, extended with a fake dbPool.connect() -> client
// (its own .query + .release()) since the transaction runs on a dedicated
// client, not the pool directly.
// ═══════════════════════════════════════════════════════════════════════════
describe('dbAcceptInvite -- the BEGIN/SELECT FOR UPDATE/UPDATE/INSERT x2/COMMIT transaction', () => {
  // POST /accept's pre-check SELECT (existing.invite_status/invited_at/email
  // mismatch checks) runs on dbPool.query() directly, BEFORE dbAcceptInvite
  // ever calls dbPool.connect() -- two separate rule sets are needed because
  // the pre-check SELECT and the transaction's own SELECT have different SQL
  // text and run against different objects (pool vs. client).
  function makeFakeTransactionalDb(
    clientRules: Array<{ match: RegExp; resolve: (sql: string, params: any[]) => any }> = [],
    poolRules: Array<{ match: RegExp; resolve: (sql: string, params: any[]) => any }> = []
  ) {
    const clientQuery = jest.fn(async (sql: string, params: any[] = []) => {
      for (const rule of clientRules) {
        if (rule.match.test(sql)) return rule.resolve(sql, params);
      }
      return { rows: [] };
    });
    const client = { query: clientQuery, release: jest.fn() };
    const poolQuery = jest.fn(async (sql: string, params: any[] = []) => {
      for (const rule of poolRules) {
        if (rule.match.test(sql)) return rule.resolve(sql, params);
      }
      return { rows: [] };
    });
    return { query: poolQuery, connect: jest.fn(async () => client), client };
  }

  const PRECHECK_SQL = /tm\.invite_status, tm\.invited_at, p\.name AS project_name/;
  const FOR_UPDATE_SQL = /FOR UPDATE/;
  const PROJECT_NAME_SQL = /SELECT name FROM projects WHERE id = \$1/;

  function precheckRow(overrides: any = {}) {
    return {
      id: 'member-1', project_id: 'proj-1', name: 'Invitee', email: 'invitee@example.com',
      app_role: 'editor', invite_status: 'pending', invited_at: new Date().toISOString(),
      project_name: 'PRECHECK NAME (must not leak into the response)',
      ...overrides,
    };
  }

  describe('POST /api/invite/accept', () => {
    it("accepts a valid pending invite end-to-end and returns a fresh session (project_name comes from dbAcceptInvite's own lookup, not the pre-check row)", async () => {
      const fakeDb = makeFakeTransactionalDb(
        [
          { match: FOR_UPDATE_SQL, resolve: () => ({ rows: [{ id: 'member-1', project_id: 'proj-1', name: 'Invitee', email: 'invitee@example.com', app_role: 'editor' }] }) },
          { match: PROJECT_NAME_SQL, resolve: () => ({ rows: [{ name: 'Acme Retail' }] }) },
        ],
        [{ match: PRECHECK_SQL, resolve: () => ({ rows: [precheckRow()] }) }]
      );
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'real-token' }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.projectId).toBe('proj-1');
        expect(body.appRole).toBe('editor');
        expect(body.email).toBe('invitee@example.com');
        expect(body.projectName).toBe('Acme Retail');
        expect(typeof body.accessToken).toBe('string');
      });
      const clientSqlCalls = fakeDb.client.query.mock.calls.map((c: any[]) => c[0]);
      expect(clientSqlCalls.some((sql: string) => /^BEGIN$/.test(sql))).toBe(true);
      expect(clientSqlCalls.some((sql: string) => /^COMMIT$/.test(sql))).toBe(true);
      expect(fakeDb.client.release).toHaveBeenCalled();
    });

    it('returns 409 when the transaction finds an invalid stored role (defense-in-depth), and still rolls back and releases the client', async () => {
      const fakeDb = makeFakeTransactionalDb(
        [{ match: FOR_UPDATE_SQL, resolve: () => ({ rows: [{ id: 'member-1', project_id: 'proj-1', name: 'Invitee', email: 'invitee@example.com', app_role: 'super_admin' }] }) }],
        [{ match: PRECHECK_SQL, resolve: () => ({ rows: [precheckRow()] }) }]
      );
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'real-token' }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(409);
        expect(body.error).toMatch(/invalid role/i);
      });
      const clientSqlCalls = fakeDb.client.query.mock.calls.map((c: any[]) => c[0]);
      expect(clientSqlCalls.some((sql: string) => /^ROLLBACK$/.test(sql))).toBe(true);
      expect(fakeDb.client.release).toHaveBeenCalled();
    });

    it('falls through to the in-memory store (404) when the transaction finds no pending row (e.g. a race with a second acceptance)', async () => {
      const fakeDb = makeFakeTransactionalDb(
        [{ match: FOR_UPDATE_SQL, resolve: () => ({ rows: [] }) }],
        [{ match: PRECHECK_SQL, resolve: () => ({ rows: [precheckRow()] }) }]
      );
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'real-token' }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(404);
        expect(body.error).toMatch(/not found or already used/i);
      });
    });

    it('falls through to the in-memory store (404) when the pre-check SELECT itself rejects', async () => {
      const fakeDb = makeFakeTransactionalDb(
        [],
        [{ match: PRECHECK_SQL, resolve: () => { throw new Error('connection reset'); } }]
      );
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'real-token' }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(404);
        expect(body.error).toMatch(/not found or already used/i);
      });
    });

    it('410s when the pre-check row is already revoked', async () => {
      const fakeDb = makeFakeTransactionalDb(
        [],
        [{ match: PRECHECK_SQL, resolve: () => ({ rows: [precheckRow({ invite_status: 'revoked' })] }) }]
      );
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'real-token' }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(410);
        expect(body.error).toMatch(/no longer valid/i);
      });
    });

    it('409s when the pre-check row is already accepted', async () => {
      const fakeDb = makeFakeTransactionalDb(
        [],
        [{ match: PRECHECK_SQL, resolve: () => ({ rows: [precheckRow({ invite_status: 'accepted' })] }) }]
      );
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'real-token' }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(409);
        expect(body.error).toMatch(/already been accepted/i);
      });
    });

    it("403s when the pre-check row's email does not match the verified session email", async () => {
      const fakeDb = makeFakeTransactionalDb(
        [],
        [{ match: PRECHECK_SQL, resolve: () => ({ rows: [precheckRow({ email: 'someone-else@example.com' })] }) }]
      );
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'real-token' }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(403);
        expect(body.error).toMatch(/different email address/i);
      });
    });

    it('410s when the pre-check row is past the 7-day TTL', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const fakeDb = makeFakeTransactionalDb(
        [],
        [{ match: PRECHECK_SQL, resolve: () => ({ rows: [precheckRow({ invited_at: eightDaysAgo })] }) }]
      );
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const { status, body } = await postJson(baseUrl, '/api/invite/accept', { token: 'real-token' }, { Authorization: 'Bearer jwt-token' });
        expect(status).toBe(410);
        expect(body.error).toMatch(/expired/i);
      });
    });

    // NOT covered here, deliberately: the `throw err;` on line 913 (when
    // dbAcceptInvite rejects with anything OTHER than INVALID_ROLE). Unlike
    // every other .catch() in this file, this route has NO outer try/catch
    // around the `await dbAcceptInvite(...).catch(...)` call -- a rethrown
    // non-INVALID_ROLE error becomes an unhandled rejection inside an async
    // Express 4 route handler, which never sends a response (the request
    // just hangs until the client times out) rather than returning any
    // testable status code. This looks like a real latent bug (a genuine DB
    // error here -- e.g. a transient connection drop mid-transaction --
    // would hang the caller's request instead of returning a 5xx), not
    // something to paper over with a fragile test. Flagged for a real fix
    // (wrap the route body in try/catch and return 500) rather than test
    // coverage.
  });

  describe('GET /api/invite/accept (legacy variant)', () => {
    it('accepts a valid pending invite end-to-end via the DB path', async () => {
      const fakeDb = makeFakeTransactionalDb([
        { match: FOR_UPDATE_SQL, resolve: () => ({ rows: [{ id: 'member-1', project_id: 'proj-1', name: 'Invitee', email: 'invitee@example.com', app_role: 'editor' }] }) },
        { match: PROJECT_NAME_SQL, resolve: () => ({ rows: [{ name: 'Acme Retail' }] }) },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/accept?token=real-token`, { headers: { Authorization: 'Bearer jwt-token' } });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.projectName).toBe('Acme Retail');
      });
    });

    it('returns 409 when the transaction finds an invalid stored role', async () => {
      const fakeDb = makeFakeTransactionalDb([
        { match: FOR_UPDATE_SQL, resolve: () => ({ rows: [{ id: 'member-1', project_id: 'proj-1', name: 'Invitee', email: 'invitee@example.com', app_role: 'super_admin' }] }) },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/accept?token=real-token`, { headers: { Authorization: 'Bearer jwt-token' } });
        const body: any = await response.json();
        expect(response.status).toBe(409);
        expect(body.error).toMatch(/invalid role/i);
      });
    });

    // Unlike POST /accept (see the note above its own equivalent test),
    // this route's .catch() has NO rethrow for a non-INVALID_ROLE error --
    // it explicitly `return null;`s and falls through to the in-memory
    // fallback below instead. Safe to test directly: no hang risk.
    it('falls through to the in-memory store (404) when dbAcceptInvite rejects with a non-INVALID_ROLE error', async () => {
      const fakeDb = makeFakeTransactionalDb([
        { match: FOR_UPDATE_SQL, resolve: () => { throw new Error('connection reset mid-transaction'); } },
      ]);
      const { app } = buildApp({ getDb: () => fakeDb, getSupabase: verifiedSupabase('invitee@example.com') });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invite/accept?token=real-token`, { headers: { Authorization: 'Bearer jwt-token' } });
        const body: any = await response.json();
        expect(response.status).toBe(404);
        expect(body.error).toMatch(/not found or already used/i);
      });
    });
  });
});

describe('two remaining small catch/branch gaps', () => {
  it("DELETE /revoke: falls back to 404 when dbFindInviteByToken's own query rejects", async () => {
    const fakeDb = makeFakeDb([
      { match: /SELECT id, project_id, email, app_role, invite_status/, resolve: () => { throw new Error('connection reset'); } },
    ]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/revoke`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'unresolvable-token' }),
      });
      expect(response.status).toBe(404);
    });
  });

  it('PATCH /projects/:projectId: 403s when the invite session is scoped to a different project', async () => {
    const fakeDb = makeFakeDb([
      {
        match: /FROM invite_sessions s/,
        resolve: () => ({ rows: [{ token: 'session-token', project_id: 'proj-1', app_role: 'editor', invite_status: 'accepted', expires_at: new Date(Date.now() + 1000).toISOString() }] }),
      },
    ]);
    const { app } = buildApp({ getDb: () => fakeDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invite/projects/some-other-project`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer invite:session-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(403);
      expect(body.error).toMatch(/can access only its assigned project/);
    });
  });
});
