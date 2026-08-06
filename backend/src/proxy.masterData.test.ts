// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// dbGetMasterCatalog/dbUpsertDomain (proxy.js lines ~1040-1160) back the
// public GET /api/master-data/catalog and admin PUT /api/master-data/
// domains/:id routes. Neither function is in proxy.js's export list, so
// they're exercised here the same way forwardToServer was: real app.listen()
// + HTTP requests against the mounted route.
//
// dbGetMasterCatalog has two independent data-source branches (dbPool unset
// -> 7 parallel Supabase REST calls via fetchSupabaseTable; dbPool set -> 7
// parallel Postgres queries) plus a 5-minute in-memory cache shared by both.
// jest.mock('pg') makes the Postgres branch testable without a real
// database; the Supabase branch is tested via a fetch spy that only
// intercepts calls to the configured SUPABASE_URL (same
// delegate-everything-else-to-the-real-fetch pattern as
// proxy.forwardToServer.test.ts).
//
// export {}; -- this file has no other top-level import/export, so without
// this line TypeScript treats it as a global "script" whose top-level
// declarations (mockPoolQuery, makeMockPoolQuery) merge into one shared
// scope with every other script-mode file in the same tsc run. That caused
// real tsc --noEmit collisions against proxy.authorizeAgentRun.test.ts and
// proxy.getCallerAppRoleForProject.test.ts, which declare the same names the
// same way.
export {};

const mockPoolQuery = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: (...args: any[]) => mockPoolQuery(...args) })),
}));

function makeMockPoolQuery(rules: Array<{ match: RegExp; rows: unknown[] }> = []) {
  return jest.fn(async (sql: any) => {
    const text = typeof sql === 'string' ? sql : sql?.text ?? '';
    for (const rule of rules) {
      if (rule.match.test(text)) return { rows: rule.rows };
    }
    return { rows: [] }; // handles the startup 'SELECT 1' probe and any DDL harmlessly
  });
}

describe('proxy master-data routes', () => {
  const ORIGINAL_ENV = { ...process.env };

  function baseEnv(overrides: Record<string, string> = {}) {
    return {
      ...ORIGINAL_ENV,
      OPENAI_API_KEY: 'test-openai-key',
      NODE_ENV: 'test',
      PROXY_TOKEN: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_KEY: '',
      POSTGRES_URL_LOCAL: '',
      POSTGRES_URL_PRODUCTION: '',
      POSTGRES_URL: '',
      DATABASE_URL: '',
      SERVER_API_URL: '',
      ADMIN_EMAIL_ALLOWLIST: '',
      ...overrides,
    };
  }

  beforeEach(() => {
    mockPoolQuery.mockReset().mockImplementation(makeMockPoolQuery());
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
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

  describe('GET /catalog -- Supabase REST fallback (no Postgres configured)', () => {
    const SUPABASE_URL = 'https://fake-project.supabase.co';

    beforeEach(() => {
      jest.resetModules();
      process.env = baseEnv({ SUPABASE_URL, SUPABASE_SERVICE_KEY: 'fake-service-key' });
    });

    function mockSupabaseFetch(tables: Record<string, unknown[]>) {
      const realFetch = global.fetch;
      return jest.spyOn(global, 'fetch').mockImplementation((async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url;
        if (typeof url === 'string' && url.startsWith(`${SUPABASE_URL}/rest/v1/`)) {
          const table = url.slice(`${SUPABASE_URL}/rest/v1/`.length).split('?')[0];
          if (table in tables) {
            return { ok: true, json: async () => tables[table] } as any;
          }
          return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'no table' } as any;
        }
        return realFetch(input, init);
      }) as any);
    }

    // fetchSpy.mock.calls includes EVERY call to global.fetch, including the
    // ones deliberately delegated through to the real fetch (this test
    // file's own client calls to baseUrl) -- count only the calls that
    // actually hit the Supabase REST prefix.
    function countSupabaseFetchCalls(fetchSpy: jest.SpyInstance) {
      return fetchSpy.mock.calls.filter(([input]: any[]) => {
        const url = typeof input === 'string' ? input : input?.url;
        return typeof url === 'string' && url.startsWith(`${SUPABASE_URL}/rest/v1/`);
      }).length;
    }

    it('assembles the catalog from 7 parallel Supabase REST calls', async () => {
      const fetchSpy = mockSupabaseFetch({
        master_phases: [{ id: 'p1' }],
        master_review_gates: [{ gate_id: 'g1' }],
        master_agents: [{ id: 'a1' }],
        master_phase_agents: [{ phase_id: 'p1', agent_id: 'a1' }],
        master_domains: [{ id: 'd1' }],
        master_role_templates: [{ id: 'r1' }],
        master_role_template_agents: [{ role_template_id: 'r1', agent_id: 'a1' }],
      });
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/catalog`);
        expect(response.status).toBe(200);
        expect(await getJson(response)).toEqual({
          phases: [{ id: 'p1' }],
          reviewGates: [{ gate_id: 'g1' }],
          agents: [{ id: 'a1' }],
          phaseAgents: [{ phase_id: 'p1', agent_id: 'a1' }],
          domains: [{ id: 'd1' }],
          roleTemplates: [{ id: 'r1' }],
          roleTemplateAgents: [{ role_template_id: 'r1', agent_id: 'a1' }],
        });
      });
      expect(countSupabaseFetchCalls(fetchSpy)).toBe(7);
    }, 15000);

    it('caches the catalog for subsequent requests instead of re-fetching', async () => {
      const fetchSpy = mockSupabaseFetch({
        master_phases: [], master_review_gates: [], master_agents: [], master_phase_agents: [],
        master_domains: [], master_role_templates: [], master_role_template_agents: [],
      });
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        await fetch(`${baseUrl}/api/master-data/catalog`);
        await fetch(`${baseUrl}/api/master-data/catalog`);
      });
      expect(countSupabaseFetchCalls(fetchSpy)).toBe(7); // not 14 -- second call served from cache
    });

    it('returns 500 when Supabase service-role access is not configured', async () => {
      process.env.SUPABASE_SERVICE_KEY = ''; // fetchSupabaseTable throws before ever calling fetch()
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/catalog`);
        expect(response.status).toBe(500);
        expect(await getJson(response)).toEqual({ error: 'Master data catalog is unavailable.' });
      });
    });
  });

  describe('GET /catalog -- Postgres configured', () => {
    beforeEach(() => {
      jest.resetModules();
      process.env = baseEnv({ POSTGRES_URL_LOCAL: 'postgres://fake:fake@localhost:5432/fake_test_db' });
    });

    it('assembles the catalog from 7 parallel Postgres queries', async () => {
      mockPoolQuery.mockImplementation(makeMockPoolQuery([
        { match: /FROM master_phases/, rows: [{ id: 'p1' }] },
        { match: /FROM master_review_gates/, rows: [{ gate_id: 'g1' }] },
        { match: /FROM master_agents/, rows: [{ id: 'a1' }] },
        { match: /FROM master_phase_agents/, rows: [{ phase_id: 'p1', agent_id: 'a1' }] },
        { match: /FROM master_domains/, rows: [{ id: 'd1' }] },
        { match: /FROM master_role_templates/, rows: [{ id: 'r1' }] },
        { match: /FROM master_role_template_agents/, rows: [{ role_template_id: 'r1', agent_id: 'a1' }] },
      ]));
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/catalog`);
        expect(response.status).toBe(200);
        expect(await getJson(response)).toEqual({
          phases: [{ id: 'p1' }],
          reviewGates: [{ gate_id: 'g1' }],
          agents: [{ id: 'a1' }],
          phaseAgents: [{ phase_id: 'p1', agent_id: 'a1' }],
          domains: [{ id: 'd1' }],
          roleTemplates: [{ id: 'r1' }],
          roleTemplateAgents: [{ role_template_id: 'r1', agent_id: 'a1' }],
        });
      });
    }, 15000);
  });

  describe('PUT /domains/:id', () => {
    function adminHeaders() {
      return { Authorization: 'Bearer admin-local-bypass-token', 'Content-Type': 'application/json' };
    }

    it('401s with no auth at all (PROXY_TOKEN configured but header missing)', async () => {
      // baseEnv() alone (no verifier configured at all) hits checkToken's
      // separate 503 "Authentication service is not configured" branch, not
      // 401 -- that's covered by proxy.authFailClosed.test.ts already.
      // PROXY_TOKEN configured + no X-API-Token header is what actually
      // exercises the 401 "Unauthorized" branch this route relies on.
      jest.resetModules();
      process.env = baseEnv({ PROXY_TOKEN: 'shared-secret' });
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'L', context: 'C' }),
        });
        expect(response.status).toBe(401);
      });
    }, 15000);

    it('403s for a non-admin authenticated caller', async () => {
      jest.resetModules();
      process.env = baseEnv({ PROXY_TOKEN: 'shared-secret' });
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT',
          headers: { 'X-API-Token': 'shared-secret', 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'L', context: 'C' }),
        });
        expect(response.status).toBe(403);
      });
    });

    it('400s an invalid domain id', async () => {
      jest.resetModules();
      process.env = baseEnv();
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/1-starts-with-digit`, {
          method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ label: 'L', context: 'C' }),
        });
        expect(response.status).toBe(400);
        expect((await getJson(response)).error).toMatch(/Domain id must be/);
      });
    });

    it('400s when label is missing', async () => {
      jest.resetModules();
      process.env = baseEnv();
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ context: 'C' }),
        });
        expect(response.status).toBe(400);
        expect((await getJson(response)).error).toBe('label is required.');
      });
    });

    it('400s when context is missing', async () => {
      jest.resetModules();
      process.env = baseEnv();
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ label: 'L' }),
        });
        expect(response.status).toBe(400);
        expect((await getJson(response)).error).toBe('context is required.');
      });
    });

    it('501s when no Postgres connection is configured', async () => {
      jest.resetModules();
      process.env = baseEnv();
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ label: 'Logistics', context: 'Ctx' }),
        });
        expect(response.status).toBe(501);
        expect((await getJson(response)).error).toMatch(/requires a direct Postgres connection/);
      });
    });

    it('falls back to default colors for invalid/omitted hex values and upserts via Postgres', async () => {
      process.env = baseEnv({ POSTGRES_URL_LOCAL: 'postgres://fake:fake@localhost:5432/fake_test_db' });
      jest.resetModules();
      mockPoolQuery.mockImplementation(makeMockPoolQuery([
        {
          match: /INSERT INTO master_domains/,
          rows: [{ id: 'logistics', label: 'Logistics', color: '#64748b', bg_color: '#e2e8f0', context: 'Ctx', template: '' }],
        },
      ]));
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT', headers: adminHeaders(),
          body: JSON.stringify({ label: 'Logistics', context: 'Ctx', color: 'not-a-hex-color' }),
        });
        expect(response.status).toBe(200);
        expect(await getJson(response)).toEqual({
          ok: true,
          domain: { id: 'logistics', label: 'Logistics', color: '#64748b', bg_color: '#e2e8f0', context: 'Ctx', template: '' },
        });
      });
    }, 15000);

    it('returns 500 when the upsert query itself throws', async () => {
      process.env = baseEnv({ POSTGRES_URL_LOCAL: 'postgres://fake:fake@localhost:5432/fake_test_db' });
      jest.resetModules();
      mockPoolQuery.mockImplementation(async (sql: any) => {
        const text = typeof sql === 'string' ? sql : sql?.text ?? '';
        if (/INSERT INTO master_domains/.test(text)) throw new Error('constraint violation');
        return { rows: [] };
      });
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ label: 'Logistics', context: 'Ctx' }),
        });
        expect(response.status).toBe(500);
        expect((await getJson(response)).error).toBe('Failed to save domain: constraint violation');
      });
    });
  });
});
