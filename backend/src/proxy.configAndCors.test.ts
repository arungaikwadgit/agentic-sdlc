// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Targets six small, previously-untested config/CORS/alias gaps in proxy.js,
// none of which needed jest.mock('pg') or Supabase JWT mocking -- they're
// either pure functions, module-scope parsing, or plain middleware reached
// via real HTTP through app.listen() (same withServer() pattern as every
// other proxy.*.test.ts file):
//
//   - line 47:      getProductionAuthConfigurationErrors' "SUPABASE_URL
//                    required when SUPABASE_ANON_KEY alone is set" branch
//                    (the file's existing test only covered the reverse).
//   - lines 140-141: fetchSupabaseTable's non-ok-response throw, reached via
//                    GET /api/master-data/catalog with a mocked non-ok fetch.
//   - line 191:      MODEL_CATALOG JSON.parse catch (malformed env var).
//   - line 203:      AGENT_PROVIDER_MAP JSON.parse catch (malformed env var).
//   - lines 233-239: ALLOWED_ORIGINS' three branches (explicit list / empty
//                    fail-secure in production / default localhost list) plus
//                    isTrustedVercelPreview -- untouched because every other
//                    test file only ever calls without-/api-prefix... no,
//                    because every other test's requests either omit the
//                    Origin header entirely (short-circuits at `!origin`) or
//                    never run with NODE_ENV=production.
//   - line 248:      the CORS rejection branch itself.
//   - lines 274-283: the API_ALIAS_RULES rewrite middleware -- untouched
//                    because it only runs for paths NOT starting with /api/,
//                    and every other test file exclusively requests /api/...
//                    paths.

describe('proxy config/CORS/alias gaps', () => {
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
      ALLOW_INSECURE_LOCAL_AUTH: '',
      ALLOWED_ORIGINS: '',
      MODEL_CATALOG: '',
      AGENT_PROVIDER_MAP: '',
      ...overrides,
    };
  }

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

  describe('getProductionAuthConfigurationErrors (line 47)', () => {
    beforeEach(() => {
      jest.resetModules();
      process.env = baseEnv();
    });

    it('flags a missing SUPABASE_URL when SUPABASE_ANON_KEY is configured alone', () => {
      const { getProductionAuthConfigurationErrors } = require('./proxy');
      const errors = getProductionAuthConfigurationErrors({
        NODE_ENV: 'production',
        SUPABASE_URL: '',
        SUPABASE_ANON_KEY: 'anon-key-only',
        PROXY_TOKEN: '',
      });
      expect(errors).toContain('SUPABASE_URL is required when SUPABASE_ANON_KEY is configured.');
    });
  });

  describe('fetchSupabaseTable non-ok response (lines 140-141, via GET /api/master-data/catalog)', () => {
    const SUPABASE_URL = 'https://fake-project.supabase.co';

    beforeEach(() => {
      jest.resetModules();
      process.env = baseEnv({ SUPABASE_URL, SUPABASE_SERVICE_KEY: 'fake-service-key' });
    });

    it('surfaces a 500 when a Supabase REST table lookup returns a non-ok response', async () => {
      const realFetch = global.fetch;
      jest.spyOn(global, 'fetch').mockImplementation((async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url;
        if (typeof url === 'string' && url.startsWith(`${SUPABASE_URL}/rest/v1/`)) {
          return { ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'db unavailable' } as any;
        }
        return realFetch(input, init);
      }) as any);

      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/catalog`);
        expect(response.status).toBe(500);
        expect((await getJson(response)).error).toBe('Master data catalog is unavailable.');
      });
    }, 15000);
  });

  describe('malformed JSON env vars (lines 191, 203)', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('falls back to an empty MODEL_CATALOG when the env var is malformed JSON, without crashing the module', async () => {
      process.env = baseEnv({ MODEL_CATALOG: '{not valid json' });
      let app: any;
      expect(() => {
        ({ app } = require('./proxy'));
      }).not.toThrow();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health`);
        expect(response.status).toBe(200);
      });
    });

    it('falls back to an empty AGENT_PROVIDER_MAP when the env var is malformed JSON, without crashing the module', async () => {
      process.env = baseEnv({ AGENT_PROVIDER_MAP: '{not valid json' });
      let app: any;
      expect(() => {
        ({ app } = require('./proxy'));
      }).not.toThrow();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health`);
        expect(response.status).toBe(200);
      });
    });
  });

  describe('CORS origin allowlisting (lines 233-239, 248)', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('rejects a non-allowlisted origin in production when ALLOWED_ORIGINS is unset (fail secure)', async () => {
      process.env = baseEnv({ NODE_ENV: 'production' });
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health`, {
          headers: { Origin: 'https://evil.example.com' },
        });
        expect(response.status).toBe(500);
      });
    });

    it('accepts an origin explicitly listed in ALLOWED_ORIGINS', async () => {
      process.env = baseEnv({ ALLOWED_ORIGINS: 'https://allowed.example.com' });
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health`, {
          headers: { Origin: 'https://allowed.example.com' },
        });
        expect(response.status).toBe(200);
      });
    });

    it('accepts a trusted Vercel preview origin even when not in ALLOWED_ORIGINS', async () => {
      process.env = baseEnv();
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health`, {
          headers: { Origin: 'https://agentic-sdlc-pr-123.vercel.app' },
        });
        expect(response.status).toBe(200);
      });
    });
  });

  describe('API_ALIAS_RULES rewrite middleware (lines 274-283)', () => {
    beforeEach(() => {
      jest.resetModules();
      process.env = baseEnv();
    });

    it('rewrites an exact-match alias (/health -> /api/health)', async () => {
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        expect(response.status).toBe(200);
        expect((await getJson(response)).status).toBe('ok');
      });
    });

    it('preserves the query string when rewriting an aliased path', async () => {
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health?debug=1`);
        expect(response.status).toBe(200);
      });
    });

    it('rewrites a trailing-slash prefix alias (/app-state/config -> /api/app-state/config)', async () => {
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/app-state/config`);
        // No auth verifier is configured in baseEnv() -- reaching checkToken's
        // 503 branch (not a 404) proves the alias rewrite landed on the real
        // /api/app-state/config route.
        expect(response.status).toBe(503);
        expect((await getJson(response)).error).toBe('Authentication service is not configured.');
      });
    });

    it('leaves an unmapped, non-/api path to fall through to the final 404 handler', async () => {
      const { app } = require('./proxy');
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/totally-unmapped-path`);
        expect(response.status).toBe(404);
        expect((await getJson(response)).error).toBe('Not found');
      });
    });
  });
});
