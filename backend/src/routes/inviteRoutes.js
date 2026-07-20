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

module.exports = { createInviteAccountProvisioning };
