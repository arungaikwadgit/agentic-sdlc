// backend/src/proxy.inviteSecurity.test.ts
//
// Unit tests for the pure security-critical helpers added to harden the
// manual invite-link flow in proxy.js:
//   - hashInviteToken: tokens are stored only as a SHA-256 hash, never raw
//   - appRoleRank: enforces "Project Owner cannot assign a role >= their own"
//   - isConfiguredAdminEmail: app-wide Admin allowlist check
//   - isInviteExpired: single source of truth for the 7-day TTL
//
// These run without a database and are safe to execute anywhere (including
// environments with no Postgres available). The full authorization +
// accept/revoke HTTP flow (which needs real team_members/projects rows) is
// covered separately in proxy.inviteFlow.integration.test.ts, which requires
// a real Postgres (POSTGRES_URL_TEST) and is skipped when one isn't present.

describe('invite-link security helpers', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      PORT: '0',
      RESEND_API_KEY: '',
      RESEND_FROM_EMAIL: '',
      POSTGRES_URL: '',
      POSTGRES_URL_LOCAL: '',
      POSTGRES_URL_PRODUCTION: '',
      DATABASE_URL: '',
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('hashInviteToken', () => {
    it('is deterministic — the same raw token always hashes to the same value', () => {
      const { hashInviteToken } = require('./proxy');
      const token = 'abc-123-def-456';
      expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    });

    it('produces a 64-character hex SHA-256 digest', () => {
      const { hashInviteToken } = require('./proxy');
      const hash = hashInviteToken('some-raw-invite-token');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('different tokens hash to different values (no collisions for near-identical inputs)', () => {
      const { hashInviteToken } = require('./proxy');
      expect(hashInviteToken('token-a')).not.toBe(hashInviteToken('token-b'));
      // A single-character difference should not be recoverable/guessable —
      // this is a sanity check that we're not accidentally truncating input.
      expect(hashInviteToken('token-1')).not.toBe(hashInviteToken('token-2'));
    });

    it('a tampered token (even one edited from a real one) never matches the stored hash', () => {
      const { hashInviteToken } = require('./proxy');
      const realToken = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const tamperedToken = 'f47ac10b-58cc-4372-a567-0e02b2c3d47a'; // last char changed
      expect(hashInviteToken(tamperedToken)).not.toBe(hashInviteToken(realToken));
    });
  });

  describe('appRoleRank (Project Owner role-ceiling enforcement)', () => {
    it('ranks roles from lowest to highest privilege', () => {
      const { appRoleRank } = require('./proxy');
      expect(appRoleRank('viewer')).toBeLessThan(appRoleRank('reviewer'));
      expect(appRoleRank('reviewer')).toBeLessThan(appRoleRank('editor'));
      expect(appRoleRank('editor')).toBeLessThan(appRoleRank('project_owner'));
    });

    it('returns -1 for an unrecognized/invalid role', () => {
      const { appRoleRank } = require('./proxy');
      expect(appRoleRank('super_admin')).toBe(-1);
      expect(appRoleRank('')).toBe(-1);
      expect(appRoleRank(undefined)).toBe(-1);
    });

    it('a Project Owner (rank 3) can grant any invitable role, all of which rank below project_owner', () => {
      const { appRoleRank } = require('./proxy');
      const projectOwnerRank = appRoleRank('project_owner');
      for (const invitable of ['editor', 'reviewer', 'viewer']) {
        expect(appRoleRank(invitable)).toBeLessThan(projectOwnerRank);
      }
    });
  });

  describe('isConfiguredAdminEmail', () => {
    it('returns false when ADMIN_EMAIL_ALLOWLIST is not configured', () => {
      process.env.ADMIN_EMAIL_ALLOWLIST = '';
      const { isConfiguredAdminEmail } = require('./proxy');
      expect(isConfiguredAdminEmail('anyone@example.com')).toBe(false);
    });

    it('returns true only for emails on the allowlist (case-insensitive)', () => {
      process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com, Owner2@Example.com';
      const { isConfiguredAdminEmail } = require('./proxy');
      expect(isConfiguredAdminEmail('admin@example.com')).toBe(true);
      expect(isConfiguredAdminEmail('ADMIN@EXAMPLE.COM')).toBe(true);
      expect(isConfiguredAdminEmail('owner2@example.com')).toBe(true);
      expect(isConfiguredAdminEmail('random@example.com')).toBe(false);
    });

    it('returns false for null/undefined/empty email', () => {
      process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com';
      const { isConfiguredAdminEmail } = require('./proxy');
      expect(isConfiguredAdminEmail(null)).toBe(false);
      expect(isConfiguredAdminEmail(undefined)).toBe(false);
      expect(isConfiguredAdminEmail('')).toBe(false);
    });
  });

  describe('authorizeAgentRun — dbPool-unavailable fail-open path', () => {
    // process.env in beforeEach above clears POSTGRES_URL/POSTGRES_URL_LOCAL,
    // so proxy.js's dbPool stays null (see the `if (dbConnectionString) {...}`
    // guard around Pool creation) — this exercises the "fail-open, this is
    // defense-in-depth not the sole gate" branch documented on
    // authorizeAgentRun() itself. The real assigned-vs-not-assigned SQL logic
    // (which needs a working dbPool) is covered by
    // proxy.agentAccess.integration.test.ts against a real Postgres.
    function fakeReqRes(email: string | null, opts: { adminBypass?: boolean } = {}) {
      const req: any = { authUser: opts.adminBypass ? { adminBypass: true } : { email } };
      const res: any = {
        status(this: any) { return this; },
        json(this: any) { return this; },
      };
      return { req, res };
    }

    it('skips when projectId or agentId is missing, even with no dbPool', async () => {
      const { authorizeAgentRun } = require('./proxy');
      const { req, res } = fakeReqRes('someone@example.com');
      expect(await authorizeAgentRun(req, res, { projectId: null, agentId: 'architecture' })).toEqual({ ok: true, skipped: true });
      expect(await authorizeAgentRun(req, res, { projectId: 'proj-1', agentId: null })).toEqual({ ok: true, skipped: true });
    });

    it('skips (fail-open) for a would-be-scoped caller when dbPool is unavailable', async () => {
      const { authorizeAgentRun } = require('./proxy');
      const { req, res } = fakeReqRes('some-editor@example.com');
      const result = await authorizeAgentRun(req, res, { projectId: 'proj-1', agentId: 'architecture' });
      expect(result).toEqual({ ok: true, skipped: true });
    });

    it('skips for the admin-bypass identity regardless of dbPool availability', async () => {
      const { authorizeAgentRun } = require('./proxy');
      const { req, res } = fakeReqRes(null, { adminBypass: true });
      const result = await authorizeAgentRun(req, res, { projectId: 'proj-1', agentId: 'architecture' });
      expect(result).toEqual({ ok: true, skipped: true });
    });

    it('skips for a configured app-admin email regardless of dbPool availability', async () => {
      process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com';
      const { authorizeAgentRun } = require('./proxy');
      const { req, res } = fakeReqRes('admin@example.com');
      const result = await authorizeAgentRun(req, res, { projectId: 'proj-1', agentId: 'architecture' });
      expect(result).toEqual({ ok: true, skipped: true });
    });
  });

  describe('isInviteExpired', () => {
    it('is not expired immediately after being invited', () => {
      const { isInviteExpired } = require('./proxy');
      expect(isInviteExpired(new Date())).toBe(false);
      expect(isInviteExpired(Date.now())).toBe(false);
    });

    it('is not expired just under the 7-day TTL', () => {
      const { isInviteExpired } = require('./proxy');
      const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
      expect(isInviteExpired(sixDaysAgo)).toBe(false);
    });

    it('is expired once the 7-day TTL has elapsed', () => {
      const { isInviteExpired } = require('./proxy');
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      expect(isInviteExpired(eightDaysAgo)).toBe(true);
    });

    it('treats a missing/null invited-at timestamp as expired (fail closed)', () => {
      const { isInviteExpired } = require('./proxy');
      expect(isInviteExpired(null)).toBe(true);
      expect(isInviteExpired(undefined)).toBe(true);
    });

    it('treats an unparseable date as expired (fail closed)', () => {
      const { isInviteExpired } = require('./proxy');
      expect(isInviteExpired('not-a-real-date')).toBe(true);
    });
  });
});
