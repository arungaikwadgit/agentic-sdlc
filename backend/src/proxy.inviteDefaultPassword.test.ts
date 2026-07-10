// backend/src/proxy.inviteDefaultPassword.test.ts
//
// Unit tests for the default-password account-provisioning helpers added to
// proxy.js for the invite/send + admin-triggered reset-password flow:
//   - generateDefaultPassword: firstname_ddmmyy + random suffix format
//   - getSupabaseAdmin: lazy singleton, null when unconfigured
//   - findSupabaseUserByEmail: paginated listUsers() scan
//   - provisionInviteeAccount: create-or-update Supabase Auth user
//
// These run without a database. provisionInviteeAccount and the Supabase
// admin client are exercised against a mocked @supabase/supabase-js so no
// network access is required.

describe('invite default-password provisioning', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.dontMock('@supabase/supabase-js');
    process.env = { ...ORIGINAL_ENV, PORT: '0', RESEND_API_KEY: '', RESEND_FROM_EMAIL: '', POSTGRES_URL: '', POSTGRES_URL_LOCAL: '' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('generateDefaultPassword', () => {
    it('formats as firstname_ddmmyy followed by a 3-character suffix', () => {
      const { generateDefaultPassword } = require('./proxy');
      const date = new Date(2026, 6, 9); // July 9, 2026 (month is 0-indexed)
      const password = generateDefaultPassword('Jane Doe', date);
      expect(password).toMatch(/^jane_090726[abcdefghjkmnpqrstuvwxyz23456789]{3}$/);
    });

    it('uses only the first name when given a full name', () => {
      const { generateDefaultPassword } = require('./proxy');
      const date = new Date(2026, 0, 1);
      const password = generateDefaultPassword('Arun Gaikwad', date);
      expect(password.startsWith('arun_')).toBe(true);
    });

    it('strips non-alphanumeric characters from the name', () => {
      const { generateDefaultPassword } = require('./proxy');
      const date = new Date(2026, 0, 1);
      const password = generateDefaultPassword("O'Brien-Smith", date);
      expect(password.startsWith('obriensmith_')).toBe(true);
    });

    it('falls back to "user" when the name is empty or missing', () => {
      const { generateDefaultPassword } = require('./proxy');
      const date = new Date(2026, 0, 1);
      expect(generateDefaultPassword('', date).startsWith('user_')).toBe(true);
      expect(generateDefaultPassword(undefined, date).startsWith('user_')).toBe(true);
      expect(generateDefaultPassword('   ', date).startsWith('user_')).toBe(true);
    });

    it('produces a different random suffix across calls', () => {
      const { generateDefaultPassword } = require('./proxy');
      const date = new Date(2026, 0, 1);
      const suffixes = new Set(
        Array.from({ length: 20 }, () => generateDefaultPassword('sam', date).slice(-3))
      );
      // Extremely unlikely all 20 collide if the suffix is genuinely random.
      expect(suffixes.size).toBeGreaterThan(1);
    });

    it('never includes visually ambiguous characters (0, O, 1, l, i) in the suffix', () => {
      const { generateDefaultPassword } = require('./proxy');
      const date = new Date(2026, 0, 1);
      for (let i = 0; i < 30; i++) {
        const suffix = generateDefaultPassword('sam', date).slice(-3);
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

    it('returns a cached singleton client when configured', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() => ({ auth: { admin: {} } })),
      }));
      const { getSupabaseAdmin } = require('./proxy');
      const client1 = getSupabaseAdmin();
      const client2 = getSupabaseAdmin();
      expect(client1).not.toBeNull();
      expect(client1).toBe(client2);
      const { createClient } = require('@supabase/supabase-js');
      expect(createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('findSupabaseUserByEmail', () => {
    it('finds a match on the first page', async () => {
      const { findSupabaseUserByEmail } = require('./proxy');
      const admin = {
        auth: {
          admin: {
            listUsers: jest.fn().mockResolvedValue({
              data: { users: [{ id: '1', email: 'jane@example.com' }, { id: '2', email: 'other@example.com' }] },
              error: null,
            }),
          },
        },
      };
      const result = await findSupabaseUserByEmail(admin, 'JANE@example.com');
      expect(result).toEqual({ id: '1', email: 'jane@example.com' });
      expect(admin.auth.admin.listUsers).toHaveBeenCalledTimes(1);
    });

    it('paginates until it finds a match on a later page', async () => {
      const { findSupabaseUserByEmail } = require('./proxy');
      const page1 = { data: { users: Array.from({ length: 200 }, (_, i) => ({ id: `p1-${i}`, email: `user${i}@example.com` })) }, error: null };
      const page2 = { data: { users: [{ id: 'match', email: 'target@example.com' }] }, error: null };
      const listUsers = jest.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
      const admin = { auth: { admin: { listUsers } } };
      const result = await findSupabaseUserByEmail(admin, 'target@example.com');
      expect(result).toEqual({ id: 'match', email: 'target@example.com' });
      expect(listUsers).toHaveBeenCalledTimes(2);
    });

    it('returns null once a short page (less than perPage) is reached with no match', async () => {
      const { findSupabaseUserByEmail } = require('./proxy');
      const admin = {
        auth: {
          admin: {
            listUsers: jest.fn().mockResolvedValue({
              data: { users: [{ id: '1', email: 'someone-else@example.com' }] },
              error: null,
            }),
          },
        },
      };
      const result = await findSupabaseUserByEmail(admin, 'nomatch@example.com');
      expect(result).toBeNull();
    });

    it('returns null on a listUsers error', async () => {
      const { findSupabaseUserByEmail } = require('./proxy');
      const admin = {
        auth: { admin: { listUsers: jest.fn().mockResolvedValue({ data: null, error: new Error('boom') }) } },
      };
      const result = await findSupabaseUserByEmail(admin, 'anyone@example.com');
      expect(result).toBeNull();
    });
  });

  describe('provisionInviteeAccount', () => {
    it('throws ADMIN_CLIENT_UNAVAILABLE when Supabase admin is not configured', async () => {
      process.env.SUPABASE_URL = '';
      process.env.SUPABASE_SERVICE_KEY = '';
      const { provisionInviteeAccount } = require('./proxy');
      await expect(provisionInviteeAccount({ email: 'a@b.com', name: 'A', actionDate: new Date() }))
        .rejects.toMatchObject({ code: 'ADMIN_CLIENT_UNAVAILABLE' });
    });

    it('creates a new account with must_change_password metadata', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      const createUser = jest.fn().mockResolvedValue({ data: { user: { id: 'new-user-id' } }, error: null });
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() => ({ auth: { admin: { createUser } } })),
      }));
      const { provisionInviteeAccount } = require('./proxy');
      const result = await provisionInviteeAccount({ email: 'jane@example.com', name: 'Jane Doe', actionDate: new Date(2026, 6, 9) });

      expect(result.created).toBe(true);
      expect(result.userId).toBe('new-user-id');
      expect(result.password).toMatch(/^jane_090726/);
      expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
        email: 'jane@example.com',
        email_confirm: true,
        user_metadata: expect.objectContaining({ must_change_password: true, name: 'Jane Doe' }),
      }));
    });

    it('falls back to updating the existing user when the email is already registered', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      const createUser = jest.fn().mockResolvedValue({
        data: null,
        error: { status: 422, message: 'Email address already registered' },
      });
      const listUsers = jest.fn().mockResolvedValue({
        data: { users: [{ id: 'existing-id', email: 'jane@example.com', user_metadata: { name: 'Old Name' } }] },
        error: null,
      });
      const updateUserById = jest.fn().mockResolvedValue({ error: null });
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() => ({ auth: { admin: { createUser, listUsers, updateUserById } } })),
      }));
      const { provisionInviteeAccount } = require('./proxy');
      const result = await provisionInviteeAccount({ email: 'jane@example.com', name: 'Jane Doe', actionDate: new Date(2026, 6, 9) });

      expect(result.created).toBe(false);
      expect(result.userId).toBe('existing-id');
      expect(updateUserById).toHaveBeenCalledWith('existing-id', expect.objectContaining({
        email_confirm: true,
        user_metadata: expect.objectContaining({ name: 'Jane Doe', must_change_password: true }),
      }));
    });

    it('rethrows the original create error if the fallback lookup finds no match', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      const createError = { status: 422, message: 'Email address already registered' };
      const createUser = jest.fn().mockResolvedValue({ data: null, error: createError });
      const listUsers = jest.fn().mockResolvedValue({ data: { users: [] }, error: null });
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() => ({ auth: { admin: { createUser, listUsers } } })),
      }));
      const { provisionInviteeAccount } = require('./proxy');
      await expect(provisionInviteeAccount({ email: 'ghost@example.com', name: 'Ghost', actionDate: new Date() }))
        .rejects.toBe(createError);
    });

    it('rethrows unrelated errors without attempting the fallback lookup', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
      const unrelatedError = { status: 500, message: 'Internal server error' };
      const createUser = jest.fn().mockResolvedValue({ data: null, error: unrelatedError });
      const listUsers = jest.fn();
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() => ({ auth: { admin: { createUser, listUsers } } })),
      }));
      const { provisionInviteeAccount } = require('./proxy');
      await expect(provisionInviteeAccount({ email: 'x@example.com', name: 'X', actionDate: new Date() }))
        .rejects.toBe(unrelatedError);
      expect(listUsers).not.toHaveBeenCalled();
    });
  });
});
