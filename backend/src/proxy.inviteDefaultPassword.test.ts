// backend/src/proxy.inviteDefaultPassword.test.ts
//
// Unit tests for the default-invite-password feature's pure/mockable
// helpers in proxy.js:
//   - generateDefaultPassword: <firstname>_DDMMYY<suffix> format
//   - getSupabaseAdmin: service-role client, null when unconfigured
//   - findSupabaseUserByEmail: paginated listUsers() scan
//   - provisionInviteeAccount: create-or-update-existing account, with the
//     generated password and must_change_password metadata
//
// Mocks @supabase/supabase-js entirely — no live Supabase project or
// Postgres needed. Follows the same jest.resetModules() + fresh require('./proxy')
// pattern as proxy.inviteSecurity.test.ts so each test gets isolated module
// state (proxy.js caches its Supabase clients as module-level singletons).
// The full HTTP-level /api/invite/send and /api/invite/reset-password
// behavior (DB-backed) is covered by proxy.inviteFlow.integration.test.ts's
// POSTGRES_URL_TEST-gated suite, consistent with how the rest of the invite
// flow's DB-dependent behavior is already tested in this codebase.

describe('default-password invite/reset helpers', () => {
  const ORIGINAL_ENV = { ...process.env };

  function mockSupabaseAdminClient(overrides: {
    createUser?: jest.Mock;
    updateUserById?: jest.Mock;
    listUsers?: jest.Mock;
  } = {}) {
    const createUser = overrides.createUser ?? jest.fn().mockResolvedValue({ data: { user: { id: 'new-user-id' } }, error: null });
    const updateUserById = overrides.updateUserById ?? jest.fn().mockResolvedValue({ data: {}, error: null });
    const listUsers = overrides.listUsers ?? jest.fn().mockResolvedValue({ data: { users: [] }, error: null });
    return {
      client: { auth: { admin: { createUser, updateUserById, listUsers } } },
      createUser, updateUserById, listUsers,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, PORT: '0', POSTGRES_URL: '', POSTGRES_URL_LOCAL: '' };
  });

  afterEach(() => {
    jest.dontMock('@supabase/supabase-js');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('generateDefaultPassword', () => {
    it('formats as <firstname>_DDMMYY<3-char suffix>, lowercased', () => {
      process.env.SUPABASE_URL = '';
      process.env.SUPABASE_SERVICE_KEY = '';
      const { generateDefaultPassword } = require('./proxy');
      const date = new Date(2026, 6, 8); // 8 Jul 2026 (month is 0-indexed)
      const password = generateDefaultPassword('Jane Doe', date);
      expect(password).toMatch(/^jane_080726[a-z0-9]{3}$/);
    });

    it('uses only the first name when given a full name', () => {
      const { generateDefaultPassword } = require('./proxy');
      const password = generateDefaultPassword('Preeti Hingorani', new Date(2026, 0, 1));
      expect(password.startsWith('preeti_010126')).toBe(true);
    });

    it('strips non-alphanumeric characters from the name', () => {
      const { generateDefaultPassword } = require('./proxy');
      const password = generateDefaultPassword("O'Brien-Smith", new Date(2026, 0, 1));
      expect(password.startsWith('obriensmith_010126')).toBe(true);
    });

    it('falls back to "user" for an empty/missing name', () => {
      const { generateDefaultPassword } = require('./proxy');
      expect(generateDefaultPassword('', new Date(2026, 0, 1)).startsWith('user_010126')).toBe(true);
      expect(generateDefaultPassword(undefined, new Date(2026, 0, 1)).startsWith('user_010126')).toBe(true);
    });

    it('produces a different password each call (random suffix), even for the same name+date', () => {
      const { generateDefaultPassword } = require('./proxy');
      const date = new Date(2026, 0, 1);
      const passwords = new Set(Array.from({ length: 20 }, () => generateDefaultPassword('Sam', date)));
      // 3 chars from a 32-char alphabet = 32,768 combinations; 20 draws
      // collapsing to 1 unique value would indicate the suffix isn't random.
      expect(passwords.size).toBeGreaterThan(1);
    });

    it('never includes ambiguous characters (0/O/1/l/i) in the suffix', () => {
      const { generateDefaultPassword } = require('./proxy');
      const date = new Date(2026, 0, 1);
      for (let i = 0; i < 50; i++) {
        const password = generateDefaultPassword('Sam', date);
        const suffix = password.slice('sam_010126'.length);
        expect(suffix).not.toMatch(/[0O1li]/);
      }
    });
  });

  describe('getSupabaseAdmin', () => {
    it('returns null when SUPABASE_URL/SUPABASE_SERVICE_KEY are not configured', () => {
      process.env.SUPABASE_URL = '';
      process.env.SUPABASE_SERVICE_KEY = '';
      const { getSupabaseAdmin } = require('./proxy');
      expect(getSupabaseAdmin()).toBeNull();
    });

    it('returns a client (and caches it) when both env vars are set', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      const { client } = mockSupabaseAdminClient();
      const createClient = jest.fn().mockReturnValue(client);
      jest.doMock('@supabase/supabase-js', () => ({ createClient }));

      const { getSupabaseAdmin } = require('./proxy');
      const first = getSupabaseAdmin();
      const second = getSupabaseAdmin();
      expect(first).toBe(client);
      expect(second).toBe(first); // cached singleton, not re-created
      expect(createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('findSupabaseUserByEmail', () => {
    it('finds a match on the first page', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      const listUsers = jest.fn().mockResolvedValue({
        data: { users: [{ id: 'u1', email: 'jane@example.com' }, { id: 'u2', email: 'other@example.com' }] },
        error: null,
      });
      const { client } = mockSupabaseAdminClient({ listUsers });
      const { findSupabaseUserByEmail } = require('./proxy');

      const result = await findSupabaseUserByEmail(client, 'JANE@EXAMPLE.COM'); // case-insensitive match
      expect(result?.id).toBe('u1');
      expect(listUsers).toHaveBeenCalledTimes(1);
    });

    it('pages forward until it finds the match', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      const page1 = Array.from({ length: 200 }, (_, i) => ({ id: `p1-${i}`, email: `user${i}@example.com` }));
      const page2 = [{ id: 'target', email: 'findme@example.com' }];
      const listUsers = jest.fn()
        .mockResolvedValueOnce({ data: { users: page1 }, error: null })
        .mockResolvedValueOnce({ data: { users: page2 }, error: null });
      const { client } = mockSupabaseAdminClient({ listUsers });
      const { findSupabaseUserByEmail } = require('./proxy');

      const result = await findSupabaseUserByEmail(client, 'findme@example.com');
      expect(result?.id).toBe('target');
      expect(listUsers).toHaveBeenCalledTimes(2);
    });

    it('returns null when no page contains a match (short final page stops pagination)', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      const listUsers = jest.fn().mockResolvedValue({
        data: { users: [{ id: 'u1', email: 'someone-else@example.com' }] },
        error: null,
      });
      const { client } = mockSupabaseAdminClient({ listUsers });
      const { findSupabaseUserByEmail } = require('./proxy');

      const result = await findSupabaseUserByEmail(client, 'nobody@example.com');
      expect(result).toBeNull();
      expect(listUsers).toHaveBeenCalledTimes(1); // short page (< perPage) — no further pagination
    });

    it('returns null if listUsers errors', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      const listUsers = jest.fn().mockResolvedValue({ data: null, error: new Error('boom') });
      const { client } = mockSupabaseAdminClient({ listUsers });
      const { findSupabaseUserByEmail } = require('./proxy');

      expect(await findSupabaseUserByEmail(client, 'anyone@example.com')).toBeNull();
    });
  });

  describe('provisionInviteeAccount', () => {
    beforeEach(() => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
    });

    it('throws a clear error when Supabase admin access is not configured', async () => {
      process.env.SUPABASE_URL = '';
      process.env.SUPABASE_SERVICE_KEY = '';
      const { provisionInviteeAccount } = require('./proxy');
      await expect(provisionInviteeAccount({ email: 'a@b.com', name: 'A' }))
        .rejects.toThrow(/not configured/i);
    });

    it('creates a new account with email_confirm true and must_change_password true', async () => {
      const { client, createUser } = mockSupabaseAdminClient();
      jest.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
      const { provisionInviteeAccount } = require('./proxy');

      const result = await provisionInviteeAccount({ email: 'jane@example.com', name: 'Jane Doe', actionDate: new Date(2026, 6, 8) });

      expect(result.created).toBe(true);
      expect(result.userId).toBe('new-user-id');
      expect(result.password).toMatch(/^jane_080726[a-z0-9]{3}$/);
      expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
        email: 'jane@example.com',
        password: result.password,
        email_confirm: true,
        user_metadata: expect.objectContaining({ must_change_password: true, name: 'Jane Doe' }),
      }));
    });

    it('falls back to updating the existing user when createUser reports the email is already registered', async () => {
      const createUser = jest.fn().mockResolvedValue({
        data: null,
        error: { status: 422, message: 'User already registered' },
      });
      const updateUserById = jest.fn().mockResolvedValue({ data: {}, error: null });
      const listUsers = jest.fn().mockResolvedValue({
        data: { users: [{ id: 'existing-id', email: 'jane@example.com', user_metadata: { name: 'Jane Doe' } }] },
        error: null,
      });
      const { client } = mockSupabaseAdminClient({ createUser, updateUserById, listUsers });
      jest.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
      const { provisionInviteeAccount } = require('./proxy');

      const result = await provisionInviteeAccount({ email: 'jane@example.com', name: 'Jane Doe', actionDate: new Date(2026, 6, 8) });

      expect(result.created).toBe(false);
      expect(result.userId).toBe('existing-id');
      expect(updateUserById).toHaveBeenCalledWith('existing-id', expect.objectContaining({
        password: result.password,
        user_metadata: expect.objectContaining({ must_change_password: true }),
      }));
    });

    it('rethrows the original createUser error when the account cannot be found via listUsers either', async () => {
      const createUser = jest.fn().mockResolvedValue({
        data: null,
        error: { status: 422, message: 'User already registered' },
      });
      const listUsers = jest.fn().mockResolvedValue({ data: { users: [] }, error: null });
      const { client } = mockSupabaseAdminClient({ createUser, listUsers });
      jest.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
      const { provisionInviteeAccount } = require('./proxy');

      await expect(provisionInviteeAccount({ email: 'ghost@example.com', name: 'Ghost' }))
        .rejects.toMatchObject({ message: 'User already registered' });
    });

    it('rethrows unrelated createUser errors without attempting the update fallback', async () => {
      const createUser = jest.fn().mockResolvedValue({
        data: null,
        error: { status: 500, message: 'Internal error' },
      });
      const listUsers = jest.fn();
      const { client } = mockSupabaseAdminClient({ createUser, listUsers });
      jest.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
      const { provisionInviteeAccount } = require('./proxy');

      await expect(provisionInviteeAccount({ email: 'x@example.com', name: 'X' }))
        .rejects.toMatchObject({ message: 'Internal error' });
      expect(listUsers).not.toHaveBeenCalled();
    });
  });
});
