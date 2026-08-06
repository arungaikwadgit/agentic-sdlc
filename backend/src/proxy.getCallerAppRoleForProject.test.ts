// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// getCallerAppRoleForProject() (proxy.js lines ~1175-1195) is injected into
// promptGovernance.js, governance.js, and inviteRoutes.js, but the real
// implementation had zero coverage -- inviteRoutes.test.ts's own harness
// injects its own fake stub instead of exercising this one.
//
// Reached here the same way dbGetMasterCatalog/dbUpsertDomain were: through
// a real router that wires in the real function, over HTTP.
// governance.js's GET /:projectId/history is the simplest caller
// (authorizeGovernanceProjectAccess -> getCallerAppRoleForProject) --
// admin-bypass and a configured admin email both short-circuit BEFORE ever
// calling it, and the shared-secret/service-account auth path has no email
// at all, so reaching the real function call requires a non-admin caller
// authenticated via a (mocked) Supabase JWT -- hence jest.mock('pg') AND a
// per-test jest.doMock('@supabase/supabase-js'), together for the first
// time in this session's proxy.js test files.
//
// export {}; -- this file has no other top-level import/export, so without
// this line TypeScript treats it as a global "script" whose top-level
// declarations (mockPoolQuery, makeMockPoolQuery) merge into one shared
// scope with every other script-mode file in the same tsc run. That caused
// real tsc --noEmit collisions against proxy.authorizeAgentRun.test.ts and
// proxy.masterData.test.ts, which declare the same names the same way.
export {};

const mockPoolQuery = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: (...args: any[]) => mockPoolQuery(...args) })),
}));

function makeMockPoolQuery(rules: Array<{ match: RegExp; resolve: () => any }> = []) {
  return jest.fn(async (sql: any) => {
    const text = typeof sql === 'string' ? sql : sql?.text ?? '';
    for (const rule of rules) {
      if (rule.match.test(text)) return rule.resolve();
    }
    return { rows: [] }; // handles the startup 'SELECT 1' probe and the final governance_decision read harmlessly
  });
}

describe('proxy getCallerAppRoleForProject (via /api/governance/:projectId/history)', () => {
  const ORIGINAL_ENV = { ...process.env };
  const CALLER_EMAIL = 'member@example.com';

  function baseEnv(overrides: Record<string, string> = {}) {
    return {
      ...ORIGINAL_ENV,
      OPENAI_API_KEY: 'test-openai-key',
      NODE_ENV: 'test',
      PROXY_TOKEN: '',
      SUPABASE_URL: 'https://fake-project.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_KEY: '',
      POSTGRES_URL_LOCAL: 'postgres://fake:fake@localhost:5432/fake_test_db',
      POSTGRES_URL_PRODUCTION: '',
      POSTGRES_URL: '',
      DATABASE_URL: '',
      SERVER_API_URL: '',
      ADMIN_EMAIL_ALLOWLIST: '', // deliberately empty -- CALLER_EMAIL must NOT be a configured admin, or getCallerAppRoleForProject is never reached at all
      ...overrides,
    };
  }

  function mockSupabaseGetUser(email: string) {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        auth: { getUser: jest.fn(async () => ({ data: { user: { email, id: 'user-1' } }, error: null })) },
      })),
    }));
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = baseEnv();
    mockPoolQuery.mockReset().mockImplementation(makeMockPoolQuery());
    mockSupabaseGetUser(CALLER_EMAIL);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.dontMock('@supabase/supabase-js');
  });

  async function withServer<T>(app: any, fn: (baseUrl: string) => Promise<T>): Promise<T> {
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to allocate test server port');
      return await fn(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  async function getJson(response: Response): Promise<any> {
    return response.json();
  }

  async function fetchHistory(baseUrl: string, projectId = 'proj-1') {
    return fetch(`${baseUrl}/api/governance/${projectId}/history`, {
      headers: { Authorization: 'Bearer valid-jwt' },
    });
  }

  it('grants access via the relational team_members row (JSONB fallback never queried)', async () => {
    mockPoolQuery.mockImplementation(makeMockPoolQuery([
      { match: /FROM team_members/, resolve: () => ({ rows: [{ app_role: 'editor' }] }) },
    ]));
    const { app } = require('./proxy');
    await withServer(app, async (baseUrl) => {
      const response = await fetchHistory(baseUrl);
      expect(response.status).toBe(200);
    });
    expect(mockPoolQuery.mock.calls.some((c) => /jsonb_array_elements/.test(String(c[0])))).toBe(false);
  }, 15000);

  it('falls back to the projects.data.teamMembers JSONB lookup when no relational row exists', async () => {
    mockPoolQuery.mockImplementation(makeMockPoolQuery([
      { match: /FROM team_members/, resolve: () => ({ rows: [] }) },
      { match: /jsonb_array_elements/, resolve: () => ({ rows: [{ app_role: 'project_owner' }] }) },
    ]));
    const { app } = require('./proxy');
    await withServer(app, async (baseUrl) => {
      const response = await fetchHistory(baseUrl);
      expect(response.status).toBe(200);
    });
  });

  it('denies access with 403 when neither lookup finds a row', async () => {
    mockPoolQuery.mockImplementation(makeMockPoolQuery([
      { match: /FROM team_members/, resolve: () => ({ rows: [] }) },
      { match: /jsonb_array_elements/, resolve: () => ({ rows: [] }) },
    ]));
    const { app } = require('./proxy');
    await withServer(app, async (baseUrl) => {
      const response = await fetchHistory(baseUrl);
      expect(response.status).toBe(403);
      expect((await getJson(response)).error).toBe('You do not have access to this project.');
    });
  });

  it('falls through to the JSONB lookup when the relational query itself throws', async () => {
    mockPoolQuery.mockImplementation(async (sql: any) => {
      const text = typeof sql === 'string' ? sql : sql?.text ?? '';
      if (/FROM team_members/.test(text)) throw new Error('relation "team_members" does not exist');
      if (/jsonb_array_elements/.test(text)) return { rows: [{ app_role: 'editor' }] };
      return { rows: [] };
    });
    const { app } = require('./proxy');
    await withServer(app, async (baseUrl) => {
      const response = await fetchHistory(baseUrl);
      expect(response.status).toBe(200);
    });
  });

  it('returns 403 (not a 500) when both the relational and JSONB queries throw', async () => {
    mockPoolQuery.mockImplementation(async (sql: any) => {
      const text = typeof sql === 'string' ? sql : sql?.text ?? '';
      if (/FROM team_members/.test(text) || /jsonb_array_elements/.test(text)) throw new Error('db exploded');
      return { rows: [] };
    });
    const { app } = require('./proxy');
    await withServer(app, async (baseUrl) => {
      const response = await fetchHistory(baseUrl);
      expect(response.status).toBe(403);
    });
  });
});
