// backend/src/proxy.inviteAccept.integration.test.ts
//
// Regression test for a real production bug: POST /api/invite/accept's SQL
// query never selected tm.invited_at, so `existing.invited_at` was always
// undefined, and isInviteExpired(undefined) unconditionally returns true
// (see proxy.js's `if (!invitedAtMsOrDate) return true;`). Every single
// accept attempt failed with "This invite link has expired." regardless of
// how fresh the invite actually was -- sign-in with the default password
// worked fine (that's a separate Supabase call), only the accept step was
// broken.
//
// proxy.inviteFlow.integration.test.ts deliberately runs with SUPABASE_URL
// unset (to exercise the admin-bypass/open-mode paths), so it never actually
// calls POST /api/invite/accept's success path -- requireVerifiedInviteeEmail
// 503s immediately without a configured Supabase client. This suite fills
// that gap: it configures a (mocked) Supabase client so the real
// query-shape bug above is reachable and caught.
//
// Requires a real Postgres, same as proxy.inviteFlow.integration.test.ts --
// skipped (not failed) when no test database connection string is available.

// Forces TS to treat this file as a module (its own scope) instead of a
// global script — see proxy.agentAccess.integration.test.ts for the full
// explanation of the TS2451 collision this prevents.
export {};

const TEST_DB_URL = process.env.POSTGRES_URL_TEST || process.env.POSTGRES_URL_LOCAL || process.env.POSTGRES_URL || '';

const describeOrSkip = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[proxy.inviteAccept.integration.test.ts] Skipped -- no POSTGRES_URL_TEST/POSTGRES_URL_LOCAL/POSTGRES_URL ' +
    'configured. Run with a real Postgres (e.g. `docker compose up -d db` then ' +
    'POSTGRES_URL_TEST=postgres://... npm test) to exercise these tests.'
  );
}

describeOrSkip('POST /api/invite/accept (integration, real Postgres + mocked Supabase)', () => {
  const ORIGINAL_ENV = { ...process.env };
  let app: any;
  let dbAdmin: any;
  let server: any;
  let baseUrl: string;

  const ADMIN_EMAIL = 'admin@example.com';
  const INVITEE_EMAIL = 'invitee@example.com';

  // The mocked Supabase client's getUser() always "verifies" this email,
  // regardless of the JWT passed in -- we're testing our own endpoint logic,
  // not Supabase's token verification.
  const getUserMock = jest.fn(async () => ({
    data: { user: { email: INVITEE_EMAIL, email_confirmed_at: new Date().toISOString() } },
    error: null,
  }));

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ auth: { getUser: (...args: unknown[]) => getUserMock(...(args as [])) } }),
    }));

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
      // Configured (dummy) on purpose -- this is what makes getSupabase()
      // return the mocked client above instead of null, which is what lets
      // requireVerifiedInviteeEmail() actually reach the accept logic.
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_KEY: '',
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const proxyModule = require('./proxy');
    app = proxyModule.app;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg');
    dbAdmin = new Pool({ connectionString: TEST_DB_URL });

    server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to allocate test server port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    process.env = ORIGINAL_ENV;
    jest.dontMock('@supabase/supabase-js');
    await new Promise((resolve) => server?.close(resolve));
    await dbAdmin?.end();
  });

  function adminBypassHeaders() {
    return { Authorization: 'Bearer admin-local-bypass-token', 'Content-Type': 'application/json' };
  }

  let projectId: string;

  beforeEach(async () => {
    getUserMock.mockClear();
    const projectRes = await dbAdmin.query(
      `INSERT INTO projects (name, data) VALUES ($1, $2::jsonb) RETURNING id`,
      ['Test Project', JSON.stringify({ teamMembers: [] })],
    );
    projectId = projectRes.rows[0].id;
  });

  afterEach(async () => {
    await dbAdmin.query(`DELETE FROM invite_log WHERE project_id = $1`, [projectId]).catch(() => {});
    await dbAdmin.query(`DELETE FROM invite_sessions WHERE project_id = $1`, [projectId]).catch(() => {});
    await dbAdmin.query(`DELETE FROM team_members WHERE project_id = $1`, [projectId]).catch(() => {});
    await dbAdmin.query(`DELETE FROM projects WHERE id = $1`, [projectId]).catch(() => {});
  });

  async function createInvite(email: string) {
    const res = await fetch(`${baseUrl}/api/invite/send`, {
      method: 'POST',
      headers: adminBypassHeaders(),
      body: JSON.stringify({ projectId, projectName: 'Test Project', name: 'Invitee', email, appRole: 'editor', invitedBy: 'Admin' }),
    });
    const body: any = await res.json();
    expect(res.status).toBe(200);
    const tokenMatch = /token=([^&]+)/.exec(body.inviteLink);
    return decodeURIComponent(tokenMatch![1]);
  }

  it('accepts a freshly-created (seconds-old) invite -- must NOT report it as expired', async () => {
    const token = await createInvite(INVITEE_EMAIL);

    const res = await fetch(`${baseUrl}/api/invite/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-invitee-jwt' },
      body: JSON.stringify({ token }),
    });
    const body: any = await res.json();

    // This is the exact regression: a missing `tm.invited_at` column in the
    // accept endpoint's SELECT made isInviteExpired(undefined) always return
    // true, so this used to be a 410 "This invite link has expired." for
    // every single invite, no matter how fresh.
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe(projectId);
    expect(body.email).toBe(INVITEE_EMAIL);

    const row = await dbAdmin.query(
      `SELECT invite_status, invite_token, invite_token_hash FROM team_members WHERE project_id = $1 AND email = $2`,
      [projectId, INVITEE_EMAIL],
    );
    expect(row.rows[0].invite_status).toBe('accepted');
    expect(row.rows[0].invite_token).toBeNull();
    expect(row.rows[0].invite_token_hash).toBeNull();
  });

  it('a genuinely expired invite (>7 days old) IS still correctly rejected', async () => {
    const token = await createInvite(INVITEE_EMAIL);
    await dbAdmin.query(
      `UPDATE team_members SET invited_at = NOW() - INTERVAL '8 days' WHERE project_id = $1 AND email = $2`,
      [projectId, INVITEE_EMAIL],
    );

    const res = await fetch(`${baseUrl}/api/invite/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-invitee-jwt' },
      body: JSON.stringify({ token }),
    });
    const body: any = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toMatch(/expired/i);
  });

  it('rejects accept when the signed-in email does not match the invited email', async () => {
    const token = await createInvite(INVITEE_EMAIL);
    getUserMock.mockResolvedValueOnce({
      data: { user: { email: 'someone-else@example.com', email_confirmed_at: new Date().toISOString() } },
      error: null,
    });

    const res = await fetch(`${baseUrl}/api/invite/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-jwt' },
      body: JSON.stringify({ token }),
    });
    const body: any = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/different email/i);

    const row = await dbAdmin.query(`SELECT invite_status FROM team_members WHERE project_id = $1 AND email = $2`, [projectId, INVITEE_EMAIL]);
    expect(row.rows[0].invite_status).toBe('pending');
  });

  it('rejects accept with no token (400)', async () => {
    const res = await fetch(`${baseUrl}/api/invite/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-jwt' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/token is required/i);
  });
});
