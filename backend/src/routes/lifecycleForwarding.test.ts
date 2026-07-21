export {};

const express = require('express');
const { createLifecycleForwardingRouter } = require('./lifecycleForwarding');

const RUNTIME_URL = 'http://runtime.internal.test';
const RUNTIME_TOKEN = 'test-runtime-token';
const REAL_FETCH: any = global.fetch;

function authOk(req: any, _res: any, next: any) {
  req.authUser = { email: 'test@example.com', user: { id: 'u1' } };
  next();
}

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());
  const checkToken = overrides.checkToken ?? authOk;
  const router = createLifecycleForwardingRouter({
    RUNTIME_API_URL: overrides.RUNTIME_API_URL !== undefined ? overrides.RUNTIME_API_URL : RUNTIME_URL,
    RUNTIME_API_TOKEN: overrides.RUNTIME_API_TOKEN !== undefined ? overrides.RUNTIME_API_TOKEN : RUNTIME_TOKEN,
    checkToken,
  });
  app.use('/api/lifecycle-events', router);
  return app;
}

async function withServer(app: any, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to allocate test server port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Intercepts only calls whose URL targets the fake runtime host; everything
// else (including the test client's own request to the local Express
// server started by withServer) is passed straight through to the real
// global fetch implementation.
function mockRuntimeFetch(impl: (url: string, init: any) => any) {
  (global as any).fetch = jest.fn((url: any, init?: any) => {
    const urlStr = String(url);
    if (urlStr.startsWith(RUNTIME_URL)) {
      return impl(urlStr, init);
    }
    return REAL_FETCH(url, init);
  });
}

describe('createLifecycleForwardingRouter', () => {
  afterEach(() => {
    (global as any).fetch = REAL_FETCH;
  });

  it('forwards the request body to the runtime API and relays its response', async () => {
    mockRuntimeFetch(async (url: string, init: any) => {
      expect(url).toBe(`${RUNTIME_URL}/api/v1/lifecycle-events`);
      expect(init.method).toBe('POST');
      expect(init.headers['X-API-Token']).toBe(RUNTIME_TOKEN);
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ event: 'phase.completed' });
      return {
        status: 202,
        headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
        text: async () => JSON.stringify({ accepted: true }),
      };
    });

    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lifecycle-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'phase.completed' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(202);
      expect(body).toEqual({ accepted: true });
    });
  });

  it('returns 503 when the runtime API is not configured', async () => {
    const app = buildApp({ RUNTIME_API_URL: '', RUNTIME_API_TOKEN: '' });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lifecycle-events`, { method: 'POST' });
      const body: any = await response.json();
      expect(response.status).toBe(503);
      expect(body.error).toMatch(/not configured/i);
    });
  });

  it('returns 502 when forwarding to the runtime fails', async () => {
    mockRuntimeFetch(async () => {
      throw new Error('ECONNREFUSED');
    });

    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lifecycle-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'phase.failed' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toMatch(/unavailable/i);
    });
  });

  it('returns 401 when checkToken rejects the request (auth-failure path)', async () => {
    const app = buildApp({
      checkToken: (_req: any, res: any) => res.status(401).json({ error: 'unauthorized' }),
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lifecycle-events`, { method: 'POST' });
      expect(response.status).toBe(401);
    });
  });


  it('forwards an empty JSON body when there is no body-parsing middleware at all (req.body ?? {} fallback)', async () => {
    // No express.json() mounted at all, so req.body is truly undefined
    // (unlike express.json()'s own default of {} for bodyless requests) --
    // this is the only way to exercise the `req.body ?? {}` nullish fallback.
    mockRuntimeFetch(async (_url: string, init: any) => {
      expect(init.body).toBe('{}');
      return {
        status: 200,
        headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
        text: async () => JSON.stringify({ ok: true }),
      };
    });

    const app = express();
    const router = createLifecycleForwardingRouter({
      RUNTIME_API_URL: RUNTIME_URL,
      RUNTIME_API_TOKEN: RUNTIME_TOKEN,
      checkToken: authOk,
    });
    app.use('/api/lifecycle-events', router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lifecycle-events`, { method: 'POST' });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true });
    });
  });

  it('falls back to application/json when the runtime response has no content-type header', async () => {
    mockRuntimeFetch(async () => ({
      status: 200,
      headers: { get: () => null },
      text: async () => 'plain text body',
    }));

    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lifecycle-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'phase.completed' }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
    });
  });

  it('relays a non-Error throw from the runtime forward (error instanceof Error ternary, false branch)', async () => {
    mockRuntimeFetch(async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'connection dropped';
    });

    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lifecycle-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'phase.failed' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toMatch(/unavailable/i);
    });
  });
});
