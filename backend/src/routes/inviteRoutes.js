// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Extracted from backend/src/proxy.js (2026-07-19, architecture upgrade
// Phase 1a — see docs/architecture/architecture-upgrade-execution-plan.md).
// This is Phase 1a only: the account-provisioning helpers used by the
// invite/send and invite/reset-password routes. The route handlers
// themselves and the rest of the invite subsystem (inviteStore, token
// hashing, session management, etc.) move in Phase 1b, as a separate,
// separately-verified commit — see the plan doc for why this was split
// from the original single-step Phase 1.
//
// Extraction discipline (plan Section 0.1): every function body below is a
// byte-for-byte verbatim copy from proxy.js. Do not "clean up while in
// here" — if something looks odd, it was already odd in proxy.js.

/**
 * Creates (or, if the email is already registered, updates) a Supabase Auth
 * user with a fresh generated password and must_change_password: true.
 * Used by both invite/send (new accounts) and invite/reset-password
 * (existing accounts getting a new default password).
 *
 * SUPABASE_URL/SUPABASE_SERVICE_KEY are passed in rather than read from
 * process.env directly here, matching proxy.js's own module-scope constants
 * exactly (verbatim-move discipline) -- they are read-only after proxy.js's
 * initial load, so passing them by value (not a getter) is safe, unlike
 * dbPool in Phase 1b which is reassigned asynchronously after startup.
 */
function createInviteAccountProvisioning({ SUPABASE_URL, SUPABASE_SERVICE_KEY }) {
  // ── Default-password account provisioning (invite send + admin reset) ──────
  // A team member's Supabase Auth account is created directly here (Admin API)
  // rather than via the client-side signUp()+email-confirmation flow, so the
  // invitee can sign in immediately with a generated password instead of
  // waiting on a confirmation email. must_change_password in user_metadata
  // forces a password change on first sign-in (enforced in the frontend's
  // AuthGuard) — chosen over a new DB column so this needs no migration and
  // no dependency on a redeploy before it takes effect.
  let _supabaseAdminClient = null;
  function getSupabaseAdmin() {
    if (_supabaseAdminClient) return _supabaseAdminClient;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
    try {
      const { createClient } = require('@supabase/supabase-js');
      _supabaseAdminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      return _supabaseAdminClient;
    } catch (err) {
      console.error(`getSupabaseAdmin(): createClient() threw — name=${err?.name ?? 'Unknown'} message=${err?.message ?? String(err)}`);
      return null;
    }
  }

  // Format: firstname_ddmmyyyy (4-digit year), e.g. "jane_09072026". Kept
  // simple with no random suffix on purpose — easier to read out loud or hand
  // over directly when email delivery isn't available. NOTE: this makes the
  // password fully guessable by anyone who knows the invitee's first name and
  // the invite date — invitees are forced to change it on first sign-in
  // (must_change_password), which is the real control here.
  function generateDefaultPassword(name, date = new Date()) {
    const firstName = String(name ?? 'user').trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `${firstName}_${dd}${mm}${yyyy}`;
  }

  // supabase-js@^2.45.0 (pinned in backend/package.json) has no getUserByEmail()
  // — paginate listUsers() instead. Capped at 25 pages (5,000 users at 200/page).
  async function findSupabaseUserByEmail(admin, email) {
    const target = String(email).trim().toLowerCase();
    const perPage = 200;
    for (let page = 1; page <= 25; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error || !data?.users?.length) return null;
      const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
      if (match) return match;
      if (data.users.length < perPage) return null;
    }
    return null;
  }

  // Creates (or, if the email is already registered, updates) a Supabase Auth
  // user with a fresh generated password and must_change_password: true.
  // Used by both invite/send (new accounts) and invite/reset-password
  // (existing accounts getting a new default password).
  async function provisionInviteeAccount({ email, name, actionDate }) {
    const admin = getSupabaseAdmin();
    if (!admin) {
      throw Object.assign(new Error('Account provisioning is not configured on this server (missing SUPABASE_URL/SUPABASE_SERVICE_KEY).'), { code: 'ADMIN_CLIENT_UNAVAILABLE' });
    }
    const password = generateDefaultPassword(name, actionDate);
    const metadata = { must_change_password: true, name: name ?? undefined };

    // is_invited_user is only set on the CREATE path below (a brand-new
    // account that exists purely because of this invite) -- it is deliberately
    // NOT merged into an existing user's metadata on the update-existing-user
    // path further down, so an admin resetting an already-registered organic
    // user's password can never accidentally get them mislabeled as
    // "invited-only" and lose visibility into their own projects. Read by the
    // frontend (AuthContext / Dashboard) to scope the invited-only experience:
    // no "+ New Project" button, dashboard limited to projects they're a
    // member of.
    const { data: createData, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { ...metadata, is_invited_user: true },
    });
    if (!createError) {
      return { password, userId: createData?.user?.id ?? null, created: true };
    }
    const alreadyExists = createError.status === 422 || /already.?(registered|exists)/i.test(createError.message ?? '');
    if (!alreadyExists) throw createError;

    const existingUser = await findSupabaseUserByEmail(admin, email);
    if (!existingUser) throw createError;

    const { error: updateError } = await admin.auth.admin.updateUserById(existingUser.id, {
      password, email_confirm: true, user_metadata: { ...(existingUser.user_metadata ?? {}), ...metadata },
    });
    if (updateError) throw updateError;
    return { password, userId: existingUser.id, created: false };
  }

  return { getSupabaseAdmin, generateDefaultPassword, findSupabaseUserByEmail, provisionInviteeAccount };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1b (2026-07-19) — the rest of the invite subsystem: inviteStore,
// token hashing/session management, the db*Invite* functions, email sending,
// and all 10 route handlers. Extraction discipline note specific to this
// piece: the source region in proxy.js (originally under its "INVITE
// SYSTEM" header) turned out to be deeply interleaved with unrelated
// application-bootstrap code (dbPool construction, app-state tables,
// prompt-governance tables) -- NOT one clean contiguous block. Every
// function below was individually verified (by its actual call sites, not
// just its physical position in the file) to be invite-specific before
// being moved here; anything used outside invite code (dbPool itself,
// checkToken, isConfiguredAdminEmail, getCallerAppRoleForProject,
// getSupabase) stays in proxy.js and is passed in below instead.
//
// dbPool specifically is passed as a GETTER (getDb: () => dbPool), not a
// plain value -- proxy.js reassigns its module-scope `dbPool` to null
// asynchronously after startup if the initial DB connection check fails, so
// a one-time snapshot would go stale. This exact getter pattern already
// exists elsewhere in proxy.js for the same reason (see
// `createUserPreferenceHandlers({ getDb: () => dbPool })` immediately after
// the invite routes) -- matched here for consistency, not invented fresh.
// ═══════════════════════════════════════════════════════════════════════════
function createInviteRouter({
  getDb,               // () => dbPool -- see doc comment above
  checkToken,           // Express middleware, defined in proxy.js, used app-wide
  isConfiguredAdminEmail,
  getCallerAppRoleForProject,
  getSupabase,
  provisionInviteeAccount, // from createInviteAccountProvisioning (Phase 1a)
}) {
  const { Router } = require('express');
  const { randomUUID, createHash } = require('crypto');
  const rateLimit = require('express-rate-limit');
  const router = Router();

  // Stricter rate limit for invite sends specifically — the general /api 120/min
  // limiter (defined in proxy.js) is far too loose for an action that triggers
  // an outbound email and could otherwise be used to spam arbitrary addresses
  // or enumerate emails. 5 invites per 15 minutes per IP.
  //
  // NODE_ENV=test gets a much higher ceiling: the integration test suite
  // (proxy.inviteFlow.integration.test.ts) runs many /api/invite/send calls
  // against a single long-lived server instance in one Jest file, all from the
  // same loopback IP, so the production limit of 5 was being hit partway
  // through the suite and made unrelated later tests fail with a rate-limit
  // response instead of a real invite -- not a bug in those tests, just this
  // limiter not accounting for the test environment.
  //
  // Unlike inviteSendRateLimit's original home in proxy.js, this has no
  // dependency on anything else in that file (unlike checkToken,
  // getCallerAppRoleForProject, etc.) so it's defined directly here rather
  // than threaded through as a constructor param.
  const inviteSendRateLimit = rateLimit({
    windowMs: 15 * 60_000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many invite requests from this IP. Please try again in a few minutes.' },
  });

  // GMAIL_USER/GMAIL_APP_PASSWORD/APP_URL read directly from process.env
  // here (not passed in as constructor params) -- unlike SUPABASE_URL in
  // Phase 1a, these were never referenced by any non-invite code in
  // proxy.js, so there's no shared-constant reason to inject them; reading
  // them directly here is the more literal verbatim move of module-scope
  // consts that lived right next to the functions using them.
  const GMAIL_USER         = (process.env.GMAIL_USER ?? '').trim();
  const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '');

  let _gmailTransporter = null;
  function getGmailTransporter() {
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
    if (!_gmailTransporter) {
      const nodemailer = require('nodemailer');
      _gmailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      });
    }
    return _gmailTransporter;
  }
  const APP_URL          = process.env.APP_URL ?? 'http://localhost:5173';
  const INVITABLE_APP_ROLES = ['project_owner', 'editor', 'reviewer', 'viewer'];
  const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const INVITE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

  // Rank used to enforce "a Project Owner cannot assign a role higher than
  // their own permission" — project_owner is already excluded from
  // INVITABLE_APP_ROLES entirely, but this is kept as an explicit,
  // spec-literal guard (and future-proofs the check if that ever changes).
  const APP_ROLE_RANK = { viewer: 0, reviewer: 1, editor: 2, project_owner: 3 };
  function appRoleRank(role) {
    return Object.prototype.hasOwnProperty.call(APP_ROLE_RANK, role) ? APP_ROLE_RANK[role] : -1;
  }

  // Invite tokens are never stored in plaintext. The raw token is generated,
  // returned to the caller exactly once (API response / share link), and only
  // its SHA-256 hash is persisted (team_members.invite_token_hash, and the
  // in-memory fallback store's key). Lookups on accept/validate/revoke hash
  // the client-supplied token and compare against the stored hash — the raw
  // token itself is never round-tripped through the database.
  function hashInviteToken(token) {
    return createHash('sha256').update(String(token)).digest('hex');
  }

  // A pending invite is expired once its TTL has elapsed, derived from
  // invited_at rather than a separate stored expiry column (one less field to
  // keep in sync). Centralised here so every accept/validate/list call site
  // uses the exact same rule.
  function isInviteExpired(invitedAtMsOrDate) {
    if (!invitedAtMsOrDate) return true;
    const invitedAtMs = invitedAtMsOrDate instanceof Date ? invitedAtMsOrDate.getTime() : new Date(invitedAtMsOrDate).getTime();
    if (Number.isNaN(invitedAtMs)) return true;
    return Date.now() - invitedAtMs > INVITE_TOKEN_TTL_MS;
  }

  // In-memory fallback when Postgres is unavailable
  const inviteStore = new Map();

  // inviteSessionReady was a module-scope `let` alongside dbPool/
  // appStateReady in proxy.js; it's local closure state here instead since
  // ensureInviteSessionTable is the only thing that ever touches it (same
  // treatment as _supabaseAdminClient in Phase 1a).
  let inviteSessionReady = null;
  async function ensureInviteSessionTable() {
    const dbPool = getDb();
    if (!dbPool) return;
    if (!inviteSessionReady) {
      inviteSessionReady = (async () => {
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS invite_sessions (
            token TEXT PRIMARY KEY,
            member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
            project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            email TEXT NOT NULL,
            app_role app_role NOT NULL,
            name TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ
          )
        `);
        await dbPool.query(`
          CREATE INDEX IF NOT EXISTS idx_invite_sessions_member_id
          ON invite_sessions(member_id)
        `);
        await dbPool.query(`
          CREATE INDEX IF NOT EXISTS idx_invite_sessions_project_id
          ON invite_sessions(project_id)
        `);
        await dbPool.query(`
          CREATE INDEX IF NOT EXISTS idx_invite_sessions_expires_at
          ON invite_sessions(expires_at)
        `);
      })().catch((err) => {
        inviteSessionReady = null;
        throw err;
      });
    }
    await inviteSessionReady;
  }

  async function authorizeInviteAction(req, res, { projectId, action, requestedAppRole }) {
    if (req.authUser?.adminBypass && process.env.NODE_ENV !== 'production') {
      return { ok: true, callerEmail: null, callerRole: 'admin' };
    }

    const callerEmail = req.authUser?.email ?? null;
    if (!callerEmail) {
      res.status(401).json({ error: 'Please sign in to manage invites for this project.' });
      return { ok: false };
    }

    if (isConfiguredAdminEmail(callerEmail)) {
      return { ok: true, callerEmail, callerRole: 'admin' };
    }

    if (!projectId) {
      res.status(400).json({ error: 'projectId is required.' });
      return { ok: false };
    }

    const callerAppRole = await getCallerAppRoleForProject(projectId, callerEmail);
    if (callerAppRole !== 'project_owner') {
      await logInviteEvent({ projectId, teamMemberId: null, action: `${action}_denied`, performedBy: callerEmail }).catch(() => {});
      res.status(403).json({ error: 'Only the project owner or an app admin can manage invites for this project.' });
      return { ok: false };
    }

    // Historically this rejected requestedAppRole ranked >= the caller's own
    // rank (project_owner) -- since project_owner was the top rank, that made
    // it impossible for anyone to ever invite another project_owner, even
    // though a project owner is meant to be able to delegate full project
    // management to someone else. Only reject roles ranked STRICTLY HIGHER
    // than project_owner (impossible today, but keeps this future-proof if a
    // higher rank is ever added).
    if (requestedAppRole && appRoleRank(requestedAppRole) > appRoleRank('project_owner')) {
      res.status(403).json({ error: 'Project Owner cannot grant a role higher than their own.' });
      return { ok: false };
    }

    return { ok: true, callerEmail, callerRole: 'project_owner' };
  }

  // Best-effort audit trail — never blocks the actual invite operation if
  // logging fails (e.g. DB unavailable). teamMemberId may be null for
  // create-denied events (no team_members row exists yet to attach to) — those
  // are logged to the console instead since invite_log.team_member_id is NOT NULL.
  async function logInviteEvent({ projectId, teamMemberId, action, performedBy }) {
    const dbPool = getDb();
    if (!dbPool || !projectId) return;
    if (!teamMemberId) {
      console.log(`[invite audit] project=${projectId} action=${action} by=${performedBy ?? 'unknown'} (no team_member row — logged to console only)`);
      return;
    }
    await dbPool.query(`
      INSERT INTO invite_log (project_id, team_member_id, action, performed_by)
      VALUES ($1, $2, $3, $4)
    `, [projectId, teamMemberId, action, performedBy ?? null]);
  }

  async function dbUpsertMember({ projectId, name, email, appRole, inviteTokenHash }) {
    const dbPool = getDb();
    if (!dbPool) return null;
    // NOTE: `role` (legacy user_role enum: 'admin' | 'product_owner') and
    // `app_role` (fine-grained RBAC enum: 'project_owner' | 'editor' | 'reviewer' | 'viewer')
    // are two different columns with two different enum types. This used to bind
    // appRole (e.g. 'editor') into BOTH columns, which fails with
    // "invalid input value for enum user_role" for any appRole that isn't
    // 'admin'/'product_owner' -- i.e. almost every real invite. `role` is left
    // out of the INSERT entirely so it takes its schema default
    // ('product_owner') and is left untouched on conflict.
    const { rows } = await dbPool.query(`
      INSERT INTO team_members (project_id, name, email, app_role, invite_token, invite_token_hash, invite_status, invited_at)
      VALUES ($1, $2, $3, $4, NULL, $5, 'pending', NOW())
      ON CONFLICT (project_id, email) DO UPDATE
        SET app_role = $4, invite_token = NULL, invite_token_hash = $5, invite_status = 'pending', invited_at = NOW(), accepted_at = NULL
      RETURNING id
    `, [projectId, name, email, appRole, inviteTokenHash]);
    return rows[0]?.id ?? null;
  }

  async function dbAcceptInvite(token, email, userId) {
    const dbPool = getDb();
    if (!dbPool) return null;
    await ensureInviteSessionTable();
    const tokenHash = hashInviteToken(token);
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');

      // Look up by hash (current, secure path). The raw invite_token fallback
      // exists only for rows created before invite_token_hash existed — never
      // written for new invites (see dbUpsertMember).
      const pendingRes = await client.query(`
        SELECT tm.id, tm.project_id, tm.name, tm.email, tm.app_role
        FROM team_members tm
        WHERE (tm.invite_token_hash = $1 OR tm.invite_token = $2)
          AND lower(tm.email) = lower($3)
          AND tm.invite_status = 'pending'
        LIMIT 1
        FOR UPDATE
      `, [tokenHash, token, email]);

      const pending = pendingRes.rows[0];
      if (!pending) {
        await client.query('ROLLBACK');
        return null;
      }

      // Defense-in-depth: reject if the stored role somehow isn't one of the
      // roles invite links are allowed to grant (rule: "invite role is valid").
      if (!INVITABLE_APP_ROLES.includes(pending.app_role)) {
        await client.query('ROLLBACK');
        throw Object.assign(new Error('Invite has an invalid role and cannot be accepted.'), { code: 'INVALID_ROLE' });
      }

      // Setting user_id here (in the same UPDATE that flips invite_status to
      // 'accepted') is THE thing that grants actual API access -- team_members
      // is the one place project roles/access live (see
      // backend/migrations/006_consolidate_team_members.sql), and
      // requireProjectRole()/GET /api/projects in server/src/routes/projects.ts
      // both key off team_members.user_id = auth.uid()-equivalent. Without it,
      // the invitee would be marked 'accepted' but still have no user_id to be
      // found by, so the project would never appear on their dashboard.
      // COALESCE keeps any existing user_id if this is somehow re-run without
      // a fresh verified session (shouldn't happen, but avoids clobbering).
      if (!userId) {
        console.warn(`[invite/accept] No verified userId available -- accepting project=${pending.project_id} email=${pending.email} without a user_id. This invitee will not see the project until this is corrected.`);
      }
      await client.query(`
        UPDATE team_members
        SET invite_status = 'accepted',
            accepted_at = COALESCE(accepted_at, NOW()),
            invite_token = NULL,
            invite_token_hash = NULL,
            user_id = COALESCE($2, user_id)
        WHERE id = $1
      `, [pending.id, userId ?? null]);

      await client.query(`
        INSERT INTO invite_log (project_id, team_member_id, action, performed_by)
        VALUES ($1, $2, 'accepted', $3)
      `, [pending.project_id, pending.id, email]);

      await client.query(`
        UPDATE invite_sessions
        SET revoked_at = NOW()
        WHERE member_id = $1 AND revoked_at IS NULL
      `, [pending.id]);

      const sessionToken = randomUUID();
      const expiresAt = new Date(Date.now() + INVITE_SESSION_TTL_MS);
      await client.query(`
        INSERT INTO invite_sessions (token, member_id, project_id, email, app_role, name, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [sessionToken, pending.id, pending.project_id, pending.email, pending.app_role, pending.name ?? null, expiresAt.toISOString()]);

      const projectRow = await client.query(`SELECT name FROM projects WHERE id = $1`, [pending.project_id]);
      await client.query('COMMIT');
      return {
        ...pending,
        access_token: sessionToken,
        expires_at: expiresAt.toISOString(),
        project_name: projectRow.rows?.[0]?.name ?? null,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async function dbGetTeam(projectId) {
    const dbPool = getDb();
    if (!dbPool) return null;
    const { rows } = await dbPool.query(`
      SELECT id, name, email, role, app_role, invite_status, invited_at, accepted_at
      FROM team_members WHERE project_id = $1 ORDER BY invited_at ASC
    `, [projectId]);
    return rows;
  }

  // Resolves a raw client-supplied token to its team_members row (by hash,
  // falling back to legacy raw-token rows) without mutating anything — used to
  // authorize an action (revoke) against the invite's project before doing it.
  async function dbFindInviteByToken(token) {
    const dbPool = getDb();
    if (!dbPool) return null;
    const tokenHash = hashInviteToken(token);
    const { rows } = await dbPool.query(`
      SELECT id, project_id, email, app_role, invite_status
      FROM team_members
      WHERE invite_token_hash = $1 OR invite_token = $2
      LIMIT 1
    `, [tokenHash, token]).catch(() => ({ rows: [] }));
    return rows[0] ?? null;
  }

  async function dbRevokeInvite(token, performedBy) {
    const dbPool = getDb();
    if (!dbPool) return;
    await ensureInviteSessionTable().catch(() => {});
    const tokenHash = hashInviteToken(token);
    // NOTE: invite_token_hash is deliberately KEPT (not nulled) on revoke.
    // It's a one-way SHA-256 hash, not the secret itself, so retaining it isn't
    // a security risk -- and /api/invite/validate needs it to still find this
    // row so it can report a clean "this invite is no longer valid" (409)
    // instead of a bare "not found" (404) once invite_status = 'revoked'.
    // invite_token (the legacy raw-token column) is still cleared since new
    // invites never populate it in the first place.
    const { rows } = await dbPool.query(`
      UPDATE team_members
      SET invite_status = 'revoked', invite_token = NULL
      WHERE invite_token_hash = $1 OR invite_token = $2
      RETURNING id, project_id
    `, [tokenHash, token]);
    await dbPool.query(`
      UPDATE invite_sessions
      SET revoked_at = NOW()
      WHERE token = $1 AND revoked_at IS NULL
    `, [token]).catch(() => {});
    const revoked = rows[0];
    if (revoked) {
      await logInviteEvent({ projectId: revoked.project_id, teamMemberId: revoked.id, action: 'revoked', performedBy }).catch(() => {});
    }
    return revoked ?? null;
  }

  async function dbSyncAcceptedMemberInProjectData(projectId, email, acceptedAtMs) {
    const dbPool = getDb();
    if (!dbPool) return;
    await dbPool.query(`
      UPDATE projects
      SET data = jsonb_set(
        COALESCE(data, '{}'::jsonb),
        '{teamMembers}',
        COALESCE((
          SELECT jsonb_agg(
            CASE
              WHEN lower(COALESCE(member->>'email', '')) = lower($2)
                THEN jsonb_set(
                  jsonb_set(member, '{inviteStatus}', '"accepted"'::jsonb, true),
                  '{acceptedAt}',
                  to_jsonb($3::bigint),
                  true
                )
              ELSE member
            END
          )
          FROM jsonb_array_elements(COALESCE(data->'teamMembers', '[]'::jsonb)) AS member
        ), '[]'::jsonb),
        true
      ),
      updated_at = NOW()
      WHERE id = $1
    `, [projectId, email, acceptedAtMs]).catch(() => {});
  }

  async function dbGetInviteSession(token) {
    const dbPool = getDb();
    if (!dbPool) return null;
    await ensureInviteSessionTable();
    const { rows } = await dbPool.query(`
      SELECT s.token, s.project_id, s.name, s.email, s.app_role, s.expires_at, tm.invite_status
      FROM invite_sessions s
      JOIN team_members tm ON tm.id = s.member_id
      WHERE s.token = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
      LIMIT 1
    `, [token]);
    const row = rows[0];
    if (!row || row.invite_status !== 'accepted') return null;
    return row;
  }

  // ── Email sender (Gmail SMTP) ─────────────────────────────────────────────────
  // Resend (https://resend.com) — an HTTPS email API, not SMTP. Preferred over
  // Gmail because Railway blocks outbound SMTP (ports 465/587) on Free/Trial/
  // Hobby plans (only Pro+ has it unblocked), which is exactly what produced
  // the "Connection timeout" errors nodemailer/Gmail was hitting in production.
  // An HTTPS POST to api.resend.com goes out over normal outbound HTTP, which
  // Railway never blocks, so this works on any plan.
  // Returns null (not an error) when RESEND_API_KEY isn't set, so the caller
  // can fall through to the next option; returns {ok, error?} once it actually
  // attempts a send.
  async function sendViaResend({ to, subject, html }) {
    const apiKey = (process.env.RESEND_API_KEY ?? '').trim();
    if (!apiKey) return null;

    // resend.dev's shared sending domain works for any recipient without
    // verifying your own domain first — good enough until a custom domain is
    // verified in the Resend dashboard. Override with RESEND_FROM_EMAIL once
    // you've verified your own domain there.
    const from = (process.env.RESEND_FROM_EMAIL ?? '').trim() || 'Agentic SDLC <onboarding@resend.dev>';

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, data: null, error: body?.message || `Resend API returned ${res.status}` };
      }
      return { ok: true, data: { messageId: body?.id }, error: null };
    } catch (err) {
      return { ok: false, data: null, error: err?.message || 'Resend request failed.' };
    }
  }

  async function sendInviteEmail({ to, name, projectName, appRole, inviteLink, invitedBy, password, isReset = false }) {
    const roleLabel = {
      project_owner: 'Project Owner',
      editor: 'Editor',
      reviewer: 'Reviewer',
      viewer: 'Viewer',
    }[appRole] ?? appRole;

    const passwordBlock = password ? `
        <div style="margin:20px 0;padding:16px 20px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;">
          <p style="margin:0 0 6px;color:#3730a3;font-size:13px;font-weight:600;">Your temporary password</p>
          <p style="margin:0;font-family:'SF Mono',Consolas,monospace;font-size:16px;color:#1e1b4b;letter-spacing:0.02em;">${password}</p>
          <p style="margin:8px 0 0;color:#4338ca;font-size:12px;">You'll be asked to set a new password the first time you sign in.</p>
        </div>` : '';

    const html = isReset ? `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px;">
        <h2 style="color:#2E4057;margin-bottom:8px;">Your password has been reset</h2>
        <p style="color:#444;font-size:15px;">
          <strong>${invitedBy}</strong> reset your password for <strong>${projectName}</strong>
          on the Agentic SDLC Framework.
        </p>
        ${passwordBlock}
        <a href="${inviteLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
          Sign In
        </a>
        <p style="color:#999;font-size:12px;">If you were not expecting this, please contact your project owner.</p>
      </div>
    ` : `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px;">
        <h2 style="color:#2E4057;margin-bottom:8px;">You're invited to collaborate</h2>
        <p style="color:#444;font-size:15px;">
          <strong>${invitedBy}</strong> has invited you to join <strong>${projectName}</strong>
          on the Agentic SDLC Framework as a <strong>${roleLabel}</strong>.
        </p>
        <p style="color:#666;font-size:14px;">
          As a <strong>${roleLabel}</strong> you can:
          ${appRole === 'project_owner' ? 'run agents, edit settings, invite team members, and manage the project.' : ''}
          ${appRole === 'editor' ? 'run agents, upload documents, and edit project settings.' : ''}
          ${appRole === 'reviewer' ? 'view all agent outputs and approve review gates.' : ''}
          ${appRole === 'viewer' ? 'view all agent outputs (read-only).' : ''}
        </p>
        ${passwordBlock}
        <a href="${inviteLink}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
          Accept Invitation
        </a>
        <p style="color:#999;font-size:12px;">This link is valid for 7 days. If you were not expecting this invite, you can safely ignore this email.</p>
      </div>
    `;
    const subject = isReset ? `Your password has been reset — ${projectName}` : `You're invited to ${projectName}`;

    // 1. Resend (preferred — HTTPS API, works on any Railway plan)
    const resendResult = await sendViaResend({ to, subject, html });
    if (resendResult) {
      console.log(`[sendInviteEmail] sent via Resend ok=${resendResult.ok}${resendResult.error ? ` error=${resendResult.error}` : ''}`);
      return resendResult;
    }

    // 2. Gmail SMTP (fallback — only works if this Railway service is on a
    // Pro+ plan; Free/Trial/Hobby block outbound SMTP entirely)
    const transporter = getGmailTransporter();
    if (!transporter) {
      // Dev mode — log to console
      console.log(`\n[INVITE LINK - no RESEND_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD set]\nTo: ${to}\nLink: ${inviteLink}\n`);
      return { ok: true, dev: true };
    }

    try {
      const info = await transporter.sendMail({
        from: `"Agentic SDLC" <${GMAIL_USER}>`,
        to,
        subject,
        html,
      });
      return { ok: true, data: { messageId: info?.messageId }, error: null };
    } catch (err) {
      return {
        ok: false,
        data: null,
        error: err?.message || 'Gmail rejected the invite email.',
      };
    }
  }

  // Resolves the frontend's own base URL for building invite links. The
  // frontend and this API are deployed on separate domains (e.g. Vercel +
  // Railway), so the Origin header of the browser's own "send invite" request
  // is the only reliable signal for the frontend's real URL per environment —
  // req.headers.host would give this API's domain instead, which is wrong.
  // Falls back to the configured APP_URL only when no Origin header is present
  // (e.g. a non-browser/server-to-server caller).
  function resolveInviteBaseUrl(req) {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (origin) return origin.replace(/\/$/, '');
    return APP_URL.replace(/\/$/, '');
  }

  // Verifies the caller sent a valid, email-confirmed Supabase session and
  // returns the verified (lowercased) email — or sends an error response and
  // returns null. Invite acceptance requires this so a client can no longer
  // "accept" an invite by simply POSTing an email string it doesn't control;
  // the requester must actually own and have confirmed that mailbox first.
  async function requireVerifiedInviteeEmail(req, res) {
    const authHeader = req.headers['authorization'] ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Please sign in and confirm your email before accepting this invite.' });
      return null;
    }
    const supabaseClient = getSupabase();
    if (!supabaseClient) {
      res.status(503).json({ error: 'Account verification is not configured on this server.' });
      return null;
    }
    const jwt = authHeader.slice(7);
    const { data, error } = await supabaseClient.auth.getUser(jwt);
    if (error || !data?.user) {
      res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
      return null;
    }
    if (!data.user.email_confirmed_at) {
      res.status(403).json({ error: 'Please confirm your email before accepting this invite — check your inbox for the confirmation link.' });
      return null;
    }
    const email = (data.user.email ?? '').trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: 'Your account has no confirmed email address.' });
      return null;
    }
    return { email, userId: data.user.id };
  }

  // ── Invite-scoped project API ────────────────────────────────────────────────
  function getInviteBearer(req) {
    const auth = req.headers.authorization ?? '';
    return auth.startsWith('Bearer invite:') ? auth.slice('Bearer invite:'.length) : '';
  }

  // ── POST /api/invite/send ─────────────────────────────────────────────────────
  router.post('/send', checkToken, inviteSendRateLimit, async (req, res) => {
    const { projectId, projectName, name, email, appRole, invitedBy } = req.body ?? {};

    if (!projectId || !email || !appRole) {
      return res.status(400).json({ error: 'projectId, email, and appRole are required' });
    }
    if (!INVITABLE_APP_ROLES.includes(appRole)) {
      return res.status(400).json({ error: `Invite links can grant only: ${INVITABLE_APP_ROLES.join(', ')}` });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      return res.status(400).json({ error: 'A valid invite email is required' });
    }

    // Authorization: only an app Admin or this project's Project Owner may
    // create an invite, and a Project Owner cannot grant a role >= their own.
    const auth = await authorizeInviteAction(req, res, { projectId, action: 'create', requestedAppRole: appRole });
    if (!auth.ok) return; // response already sent

    // Provision the invitee's real Supabase Auth account up front, with a
    // generated default password, so they can sign in immediately instead of
    // waiting on a confirmation email. Must happen before any token/DB
    // bookkeeping below — if this fails there's no usable invite to hand out.
    let provisioned;
    try {
      provisioned = await provisionInviteeAccount({ email: normalizedEmail, name, actionDate: new Date() });
    } catch (err) {
      console.error(`[invite/send] provisionInviteeAccount failed: ${err?.message ?? err}`);
      return res.status(502).json({ error: "Could not create the team member's account. Please try again or contact support." });
    }

    const token = randomUUID();          // returned to the caller once — never persisted raw
    const tokenHash = hashInviteToken(token);
    const baseUrl = resolveInviteBaseUrl(req);
    const inviteLink = `${baseUrl}/invite?token=${token}&projectId=${encodeURIComponent(projectId)}&email=${encodeURIComponent(normalizedEmail)}`;

    console.log(
      `[invite/send] request received projectId=${projectId} appRole=${appRole} createdBy=${auth.callerEmail ?? '(admin-bypass)'} ` +
      `emailDomain=${normalizedEmail.split('@')[1] ?? '?'} gmailConfigured=${!!(GMAIL_USER && GMAIL_APP_PASSWORD)}`
    );

    // Store in memory (fallback path) — keyed by hash, matching the DB column,
    // so a tampered/guessed token never matches by construction.
    inviteStore.set(tokenHash, {
      projectId, projectName, email: normalizedEmail, name, appRole,
      invitedBy, invitedAt: Date.now(), acceptedAt: null,
    });

    // Persist to DB if available. Previously swallowed silently — now logged,
    // since a DB write failure here (e.g. no Postgres connection string
    // configured on this service) was indistinguishable from a healthy no-op
    // and made this flow much harder to debug from Railway logs alone.
    const teamMemberId = await dbUpsertMember({ projectId, name, email: normalizedEmail, appRole, inviteTokenHash: tokenHash }).catch((err) => {
      console.error(`[invite/send] dbUpsertMember failed (non-fatal, invite email still attempted): ${err?.message ?? err}`);
      return null;
    });
    await logInviteEvent({
      projectId,
      teamMemberId,
      action: 'sent',
      performedBy: auth.callerEmail ?? invitedBy ?? null,
    }).catch(() => {});

    // Send email (best-effort — this is now the fallback distribution channel,
    // not the only one: the inviteLink is always returned below so an
    // Admin/Project Owner can copy and share it manually regardless of
    // whether email sending is configured or succeeds).
    const emailResult = await sendInviteEmail({ to: normalizedEmail, name, projectName, appRole, inviteLink, invitedBy, password: provisioned.password });
    console.log(
      `[invite/send] sendInviteEmail result ok=${emailResult.ok} dev=${!!emailResult.dev}` +
      (emailResult.error ? ` error=${emailResult.error}` : '')
    );

    if (!emailResult.ok && !emailResult.dev) {
      return res.status(200).json({
        ok: true,
        inviteLink,
        token,
        password: provisioned.password,
        emailSent: false,
        emailError: emailResult.error ?? 'Invite email failed to send.',
        message: 'Invite link created. Email delivery failed — copy the link below and share it manually.',
      });
    }

    return res.json({
      ok: true,
      inviteLink,
      token,
      password: provisioned.password,
      emailSent: !emailResult.dev,
      message: emailResult.dev
        ? 'Invite link generated (no email sent — RESEND_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD not set). Copy the link to share manually.'
        : 'Invite email sent. You can also copy the link below to share it directly.',
    });
  });

  // ── POST /api/invite/reset-password ─────────────────────────────────────────
  // Admin/project-owner-triggered password reset for an existing team member.
  // Generates a fresh default-format password (dated to the reset action),
  // updates the member's Supabase Auth account, and re-sets
  // must_change_password so they're forced to pick their own on next sign-in.
  router.post('/reset-password', checkToken, async (req, res) => {
    const { projectId, projectName, email } = req.body ?? {};
    if (!projectId || !email) {
      return res.status(400).json({ error: 'projectId and email are required' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const auth = await authorizeInviteAction(req, res, { projectId, action: 'reset_password' });
    if (!auth.ok) return; // response already sent

    let member = null;
    const dbPool = getDb();
    if (dbPool) {
      const { rows } = await dbPool.query(
        `SELECT id, name, email FROM team_members WHERE project_id = $1 AND lower(email) = $2 LIMIT 1`,
        [projectId, normalizedEmail]
      ).catch(() => ({ rows: [] }));
      member = rows[0] ?? null;
    }
    if (!member) {
      return res.status(404).json({ error: 'No team member found with that email on this project.' });
    }

    let provisioned;
    try {
      provisioned = await provisionInviteeAccount({ email: normalizedEmail, name: member.name, actionDate: new Date() });
    } catch (err) {
      console.error(`[invite/reset-password] provisionInviteeAccount failed: ${err?.message ?? err}`);
      return res.status(502).json({ error: "Could not reset this team member's password. Please try again or contact support." });
    }

    await logInviteEvent({
      projectId,
      teamMemberId: member.id,
      action: 'password_reset',
      performedBy: auth.callerEmail ?? null,
    }).catch(() => {});

    const baseUrl = resolveInviteBaseUrl(req);
    const emailResult = await sendInviteEmail({
      to: normalizedEmail,
      name: member.name,
      projectName: projectName ?? '',
      appRole: null,
      inviteLink: baseUrl,
      invitedBy: auth.callerEmail ?? 'Your project owner',
      password: provisioned.password,
      isReset: true,
    });
    console.log(
      `[invite/reset-password] sendInviteEmail result ok=${emailResult.ok} dev=${!!emailResult.dev}` +
      (emailResult.error ? ` error=${emailResult.error}` : '')
    );

    return res.json({
      ok: true,
      password: provisioned.password,
      emailSent: !emailResult.dev && emailResult.ok,
      message: emailResult.dev
        ? 'Password reset. No email sent (RESEND_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD not set) — copy the password below and share it manually.'
        : 'Password reset. An email with the new password has been sent.',
    });
  });

  // ── POST /api/invite/accept ───────────────────────────────────────────────────
  // Accept an invite. Requires a valid, email-confirmed Supabase session — the
  // invited email must match the session's verified email exactly, so access is
  // tied to a real, confirmed account rather than a client-supplied string.
  router.post('/accept', async (req, res) => {
    const token = req.body?.token ?? req.query?.token;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const verified = await requireVerifiedInviteeEmail(req, res);
    if (!verified) return; // response already sent
    const { email: verifiedEmail, userId: verifiedUserId } = verified;

    const tokenHash = hashInviteToken(token);
    const dbPool = getDb();

    if (dbPool) {
      const { rows } = await dbPool.query(`
        SELECT tm.id, tm.project_id, tm.name, tm.email, tm.app_role, tm.invite_status, tm.invited_at, p.name AS project_name
        FROM team_members tm
        JOIN projects p ON p.id = tm.project_id
        WHERE tm.invite_token_hash = $1 OR tm.invite_token = $2
        LIMIT 1
      `, [tokenHash, token]).catch(() => ({ rows: [] }));

      const existing = rows[0];
      if (existing) {
        if (existing.invite_status === 'revoked') {
          await logInviteEvent({ projectId: existing.project_id, teamMemberId: existing.id, action: 'failed_validation:revoked', performedBy: verifiedEmail }).catch(() => {});
          return res.status(410).json({ error: 'This invite is no longer valid.' });
        }
        if (existing.invite_status === 'accepted') {
          return res.status(409).json({ error: 'This invite has already been accepted.' });
        }
        if (existing.email && existing.email.toLowerCase() !== verifiedEmail) {
          await logInviteEvent({ projectId: existing.project_id, teamMemberId: existing.id, action: 'failed_validation:email_mismatch', performedBy: verifiedEmail }).catch(() => {});
          return res.status(403).json({ error: 'This invite was sent to a different email address than your confirmed account.' });
        }
        if (isInviteExpired(existing.invited_at)) {
          await logInviteEvent({ projectId: existing.project_id, teamMemberId: existing.id, action: 'failed_validation:expired', performedBy: verifiedEmail }).catch(() => {});
          return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
        }
        let invalidRoleError = null;
        const dbRow = await dbAcceptInvite(token, verifiedEmail, verifiedUserId).catch((err) => {
          if (err?.code === 'INVALID_ROLE') { invalidRoleError = err; return null; }
          throw err;
        });
        if (invalidRoleError) {
          return res.status(409).json({ error: invalidRoleError.message });
        }
        if (dbRow) {
          await dbSyncAcceptedMemberInProjectData(dbRow.project_id, dbRow.email, Date.now());
          inviteStore.delete(tokenHash);
          return res.json({
            ok: true,
            accessToken: dbRow.access_token,
            projectId: dbRow.project_id,
            projectName: dbRow.project_name,
            appRole: dbRow.app_role,
            name: dbRow.name,
            email: dbRow.email,
            expiresAt: dbRow.expires_at,
          });
        }
        if (res.headersSent) return;
      }
    }

    const invite = inviteStore.get(tokenHash);
    if (!invite) return res.status(404).json({ error: 'Invite not found or already used.' });
    if (invite.email !== verifiedEmail) return res.status(403).json({ error: 'This invite was sent to a different email address than your confirmed account.' });
    if (invite.acceptedAt) return res.status(409).json({ error: 'This invite has already been accepted.' });

    if (isInviteExpired(invite.invitedAt)) {
      inviteStore.delete(tokenHash);
      return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
    }

    invite.acceptedAt = Date.now();
    inviteStore.set(tokenHash, invite);

    return res.json({
      ok: true,
      accessToken: token,
      projectId: invite.projectId,
      projectName: invite.projectName,
      appRole: invite.appRole,
      name: invite.name,
      email: invite.email,
      expiresAt: Date.now() + INVITE_SESSION_TTL_MS,
    });
  });

  // ── GET /api/invite/accept ────────────────────────────────────────────────────
  // Legacy variant of the accept endpoint — same verified-session requirement
  // as POST /api/invite/accept applies here (see requireVerifiedInviteeEmail).
  router.get('/accept', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const verified = await requireVerifiedInviteeEmail(req, res);
    if (!verified) return; // response already sent
    const { email: verifiedEmail, userId: verifiedUserId } = verified;

    const tokenHash = hashInviteToken(token);

    // Try DB first
    let invalidRoleError = null;
    const dbRow = await dbAcceptInvite(token, verifiedEmail, verifiedUserId).catch((err) => {
      if (err?.code === 'INVALID_ROLE') { invalidRoleError = err; return null; }
      return null; // any other DB error: fall through to in-memory fallback below
    });
    if (invalidRoleError) {
      return res.status(409).json({ error: invalidRoleError.message });
    }
    if (dbRow) {
      await dbSyncAcceptedMemberInProjectData(dbRow.project_id, dbRow.email, Date.now());
      inviteStore.delete(tokenHash);
      return res.json({
        ok: true,
        projectId: dbRow.project_id,
        projectName: dbRow.project_name,
        appRole: dbRow.app_role,
        name: dbRow.name,
        email: dbRow.email,
        accessToken: dbRow.access_token,
        expiresAt: dbRow.expires_at,
      });
    }

    // Fallback to in-memory
    const invite = inviteStore.get(tokenHash);
    if (!invite) return res.status(404).json({ error: 'Invite not found or already used.' });
    if (invite.email !== verifiedEmail) return res.status(403).json({ error: 'This invite was sent to a different email address than your confirmed account.' });
    if (invite.acceptedAt) return res.status(409).json({ error: 'This invite has already been accepted.' });

    if (isInviteExpired(invite.invitedAt)) {
      inviteStore.delete(tokenHash);
      return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
    }

    invite.acceptedAt = Date.now();
    inviteStore.set(tokenHash, invite);

    return res.json({
      ok: true,
      projectId: invite.projectId,
      projectName: invite.projectName,
      appRole: invite.appRole,
      name: invite.name,
      email: invite.email,
      accessToken: token,
      expiresAt: Date.now() + INVITE_SESSION_TTL_MS,
    });
  });

  // ── GET /api/invite/validate ──────────────────────────────────────────────────
  // Called by the frontend to preview invite details before the user clicks Accept.
  router.get('/validate', async (req, res) => {
    const { token, email } = req.query;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const tokenHash = hashInviteToken(token);
    const dbPool = getDb();

    // DB lookup
    if (dbPool) {
      const { rows } = await dbPool.query(
        `SELECT tm.name, tm.email, tm.app_role, tm.invite_status, tm.invited_at, p.id AS project_id, p.name AS project_name, p.description AS project_description
         FROM team_members tm JOIN projects p ON p.id = tm.project_id
         WHERE tm.invite_token_hash = $1 OR tm.invite_token = $2`, [tokenHash, token]
      ).catch(() => ({ rows: [] }));
      if (rows[0]) {
        const r = rows[0];
        if (r.invite_status === 'revoked') return res.status(409).json({ error: 'This invite is no longer valid.' });
        if (isInviteExpired(r.invited_at)) {
          return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
        }
        if (r.invite_status !== 'pending') return res.status(409).json({ error: 'This invite has already been used.' });
        // Note: this endpoint only previews invite details for the "you've been
        // invited" landing page (no session required) — it never grants access.
        // Access is granted exclusively by /api/invite/accept, which requires a
        // verified session and re-validates every rule server-side.
        return res.json({
          ok: true,
          id: token,
          role: r.app_role,
          invitedEmail: r.email,
          expiresAt: r.invited_at ? new Date(new Date(r.invited_at).getTime() + INVITE_TOKEN_TTL_MS).toISOString() : null,
          project: {
            id: r.project_id,
            name: r.project_name,
            description: r.project_description ?? '',
          },
        });
      }
    }

    // In-memory fallback
    const invite = inviteStore.get(tokenHash);
    if (!invite) return res.status(404).json({ error: 'Invite not found.' });
    if (invite.acceptedAt) return res.status(409).json({ error: 'Already accepted.' });
    if (isInviteExpired(invite.invitedAt)) {
      inviteStore.delete(tokenHash);
      return res.status(410).json({ error: 'This invite link has expired. Ask the project owner to resend.' });
    }
    return res.json({
      ok: true,
      id: token,
      role: invite.appRole,
      invitedEmail: invite.email,
      expiresAt: new Date(invite.invitedAt + INVITE_TOKEN_TTL_MS).toISOString(),
      project: {
        id: invite.projectId,
        name: invite.projectName,
        description: '',
      },
    });
  });

  // ── DELETE /api/invite/revoke ─────────────────────────────────────────────────
  router.delete('/revoke', checkToken, async (req, res) => {
    const { token } = req.body ?? {};
    if (!token) return res.status(400).json({ error: 'token is required' });

    const existing = await dbFindInviteByToken(token);
    const inviteFromMemory = existing ? null : inviteStore.get(hashInviteToken(token));
    const projectId = existing?.project_id ?? inviteFromMemory?.projectId ?? null;

    // If we can't resolve which project this token belongs to at all (DB
    // unavailable and not in the in-memory store either), there is nothing to
    // authorize against or to revoke — treat as not found rather than silently
    // "succeeding" with no authorization check performed.
    if (!projectId) {
      return res.status(404).json({ error: 'Invite not found.' });
    }

    const auth = await authorizeInviteAction(req, res, { projectId, action: 'revoke' });
    if (!auth.ok) return; // response already sent

    await dbRevokeInvite(token, auth.callerEmail).catch(() => {});
    inviteStore.delete(hashInviteToken(token));
    return res.json({ ok: true });
  });

  router.get('/projects', async (req, res) => {
    const inviteToken = getInviteBearer(req);
    if (!inviteToken) return res.status(401).json({ error: 'Invite session is required.' });
    const session = await dbGetInviteSession(inviteToken);
    if (!session) return res.status(401).json({ error: 'Invite session is invalid or expired.' });
    const dbPool = getDb();
    if (!dbPool) return res.status(503).json({ error: 'Project database is unavailable.' });

    const { rows } = await dbPool.query(`
      SELECT id, owner_id, name, description, domain, status, data, created_at, updated_at
      FROM projects
      WHERE id = $1
      LIMIT 1
    `, [session.project_id]).catch(() => ({ rows: [] }));

    return res.json(rows);
  });

  router.get('/projects/:projectId', async (req, res) => {
    const inviteToken = getInviteBearer(req);
    if (!inviteToken) return res.status(401).json({ error: 'Invite session is required.' });
    const session = await dbGetInviteSession(inviteToken);
    if (!session) return res.status(401).json({ error: 'Invite session is invalid or expired.' });
    if (session.project_id !== req.params.projectId) {
      return res.status(403).json({ error: 'This invite session can access only its assigned project.' });
    }
    const dbPool = getDb();
    if (!dbPool) return res.status(503).json({ error: 'Project database is unavailable.' });

    const { rows } = await dbPool.query(`
      SELECT id, owner_id, name, description, domain, status, data, created_at, updated_at
      FROM projects
      WHERE id = $1
      LIMIT 1
    `, [session.project_id]).catch(() => ({ rows: [] }));

    if (!rows[0]) return res.status(404).json({ error: 'Project not found.' });
    return res.json(rows[0]);
  });

  router.patch('/projects/:projectId', async (req, res) => {
    const inviteToken = getInviteBearer(req);
    if (!inviteToken) return res.status(401).json({ error: 'Invite session is required.' });
    const session = await dbGetInviteSession(inviteToken);
    if (!session) return res.status(401).json({ error: 'Invite session is invalid or expired.' });
    if (session.project_id !== req.params.projectId) {
      return res.status(403).json({ error: 'This invite session can access only its assigned project.' });
    }
    if (session.app_role !== 'editor') {
      return res.status(403).json({ error: 'Your invite role does not allow editing project data.' });
    }
    const dbPool = getDb();
    if (!dbPool) return res.status(503).json({ error: 'Project database is unavailable.' });

    const { name, description, domain, status, data } = req.body ?? {};
    const { rows } = await dbPool.query(`
      UPDATE projects
      SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        domain = COALESCE($4, domain),
        status = COALESCE($5, status),
        data = COALESCE($6::jsonb, data),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, owner_id, name, description, domain, status, data, created_at, updated_at
    `, [session.project_id, name ?? null, description ?? null, domain ?? null, status ?? null, data ? JSON.stringify(data) : null]).catch((err) => {
      console.error('Invite project update error:', err.message);
      return { rows: [] };
    });

    if (!rows[0]) return res.status(404).json({ error: 'Project not found.' });
    return res.json(rows[0]);
  });

  // ── GET /api/invite/team/:projectId ──────────────────────────────────────────
  router.get('/team/:projectId', checkToken, async (req, res) => {
    const { projectId } = req.params;

    const auth = await authorizeInviteAction(req, res, { projectId, action: 'view' });
    if (!auth.ok) return; // response already sent

    const dbRows = await dbGetTeam(projectId).catch(() => null);
    if (dbRows) return res.json({ ok: true, members: dbRows });
    // In-memory: filter by projectId. Note: the map key is now a token hash,
    // not the raw token, so it is never returned to the client here either.
    const members = [];
    for (const [tokenHash, inv] of inviteStore.entries()) {
      if (inv.projectId === projectId) members.push({ ...inv, tokenHash });
    }
    return res.json({ ok: true, members });
  });

  return {
    router,
    // Exported for unit testing only, matching what proxy.js's own
    // module.exports historically exposed for these (see
    // proxy.inviteSecurity.test.ts, proxy.sendInviteEmail.test.ts) --
    // proxy.js re-exports these by re-destructuring what this factory
    // returns, so require('./proxy').hashInviteToken etc. keeps working.
    hashInviteToken,
    isInviteExpired,
    appRoleRank,
    sendInviteEmail,
    getGmailTransporter,
    // Exported so proxy.js's /api/admin/reset-application-data route (not
    // itself invite-specific) can still ensure invite_sessions exists before
    // TRUNCATE-ing it -- same reason as the other re-exports above, this is
    // an existing external call site, not new coupling.
    ensureInviteSessionTable,
  };
}

module.exports = { createInviteAccountProvisioning, createInviteRouter };
