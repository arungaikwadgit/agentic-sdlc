// Tests for backend/src/routes/figmaIntegration.js (POST /styles).
// figmaIntegration.js does `const https = require('https')` INSIDE the
// factory function body (not injectable via constructor params), so the
// only mocking seam is jest.mock('https') at the module-resolution level --
// this must run before createFigmaIntegrationRouter() is ever invoked so
// that its internal require('https') picks up the mock.

export {};

jest.mock('https');

const express = require('express');
const https = require('https');
const { createFigmaIntegrationRouter } = require('./figmaIntegration');

type Outcome = { status: number; body: any } | { error: Error };

// Configures the shared https.request mock to answer based on the request
// path -- figmaRequest() is called twice per successful /styles request
// (once for /v1/files/:key/styles, once for /v1/files/:key/nodes), so tests
// key their canned responses off which endpoint is being hit.
function mockHttpsRequest(pickOutcome: (path: string) => Outcome) {
  (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
    let errorHandler: ((err: Error) => void) | null = null;
    const req = {
      on: (event: string, handler: any) => {
        if (event === 'error') errorHandler = handler;
        return req;
      },
      end: () => {
        const outcome = pickOutcome(options.path);
        if ('error' in outcome) {
          if (errorHandler) errorHandler(outcome.error);
          return;
        }
        const res = {
          statusCode: outcome.status,
          on: (event: string, handler: any) => {
            if (event === 'data') handler(Buffer.from(JSON.stringify(outcome.body)));
            if (event === 'end') handler();
          },
        };
        callback(res);
      },
      destroy: () => {},
      write: () => {},
    };
    return req;
  });
}

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());
  const checkToken =
    overrides.checkToken ||
    ((req: any, _res: any, next: any) => {
      req.authUser = { email: 'test@example.com' };
      next();
    });
  const router = createFigmaIntegrationRouter({ checkToken });
  app.use('/api/figma', router);
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

describe('createFigmaIntegrationRouter (POST /styles)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('400 when fileKey or token is missing', async () => {
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'abc' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(400);
      expect(body.error).toMatch(/fileKey and token are required/);
    });
    expect(https.request).not.toHaveBeenCalled();
  });

  it('400 when the request has no body at all (req.body ?? {} fallback)', async () => {
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, { method: 'POST' });
      const body: any = await response.json();
      expect(response.status).toBe(400);
      expect(body.error).toMatch(/fileKey and token are required/);
    });
    expect(https.request).not.toHaveBeenCalled();
  });

  it('does not reach Figma at all when checkToken denies the request', async () => {
    const checkToken = (_req: any, res: any) => res.status(401).json({ error: 'no token' });
    const app = buildApp({ checkToken });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'abc', token: 'tok' }),
      });
      expect(response.status).toBe(401);
    });
    expect(https.request).not.toHaveBeenCalled();
  });

  it('success: fetches styles then nodes and returns computed colors/typography', async () => {
    mockHttpsRequest((path) => {
      if (path.includes('/styles')) {
        return {
          status: 200,
          body: {
            meta: {
              styles: [
                { node_id: '1:1', style_type: 'FILL', name: 'Brand/Primary' },
                { node_id: '1:2', style_type: 'TEXT', name: 'Heading/H1' },
              ],
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          nodes: {
            '1:1': { document: { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] } },
            '1:2': { document: { style: { fontFamily: 'Inter', fontSize: 32, fontWeight: 700, lineHeightPx: 40, letterSpacing: 0 } } },
          },
        },
      };
    });

    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.rawStyleCount).toBe(2);
      expect(body.colors).toEqual([{ name: 'Brand/Primary', hex: '#ff0000', opacity: 100 }]);
      expect(body.typography).toEqual([
        { name: 'Heading/H1', fontFamily: 'Inter', fontSize: 32, fontWeight: 700, lineHeight: 40, letterSpacing: 0 },
      ]);
    });
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it('returns empty colors/typography without a second request when there are no styles', async () => {
    mockHttpsRequest(() => ({ status: 200, body: { meta: { styles: [] } } }));
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ colors: [], typography: [], rawStyleCount: 0 });
    });
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('403 when Figma responds with an invalid-token status', async () => {
    mockHttpsRequest(() => ({ status: 403, body: {} }));
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'bad-tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(403);
      expect(body.error).toMatch(/Invalid Figma token/);
    });
  });

  it('404 when the Figma file is not found', async () => {
    mockHttpsRequest(() => ({ status: 404, body: {} }));
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'missing', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(404);
      expect(body.error).toMatch(/Figma file not found/);
    });
  });

  it('502 when the styles call returns an unexpected status', async () => {
    mockHttpsRequest(() => ({ status: 500, body: {} }));
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toBe('Figma API responded with 500');
    });
  });

  it('502 when the nodes call returns an unexpected status', async () => {
    mockHttpsRequest((path) =>
      path.includes('/styles')
        ? { status: 200, body: { meta: { styles: [{ node_id: '1:1', style_type: 'FILL', name: 'X' }] } } }
        : { status: 500, body: {} },
    );
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toBe('Figma nodes API responded with 500');
    });
  });

  it('502 when the underlying https request fails (network error)', async () => {
    mockHttpsRequest(() => ({ error: new Error('ECONNRESET') }));
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toBe('Figma request failed: ECONNRESET');
    });
  });

  it('treats a styles response with no "meta" key at all as zero styles (body?.meta?.styles ?? [] fallback)', async () => {
    mockHttpsRequest(() => ({ status: 200, body: {} }));
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ colors: [], typography: [], rawStyleCount: 0 });
    });
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('ignores a FILL style whose fill type is not SOLID, skips a style with no matching node, defaults missing TEXT style properties, and tolerates a nodes response with no "nodes" key', async () => {
    mockHttpsRequest((path) => {
      if (path.includes('/styles')) {
        return {
          status: 200,
          body: {
            meta: {
              styles: [
                { node_id: '1:1', style_type: 'FILL', name: 'Gradient/NotSolid' },
                { node_id: '1:2', style_type: 'TEXT', name: 'Heading/NoStyleProps' },
                { node_id: '1:3', style_type: 'FILL', name: 'Missing/NoNode' },
              ],
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          nodes: {
            '1:1': { document: { fills: [{ type: 'GRADIENT_LINEAR' }] } },
            '1:2': { document: {} },
          },
        },
      };
    });
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.rawStyleCount).toBe(3);
      expect(body.colors).toEqual([]);
      expect(body.typography).toEqual([
        { name: 'Heading/NoStyleProps', fontFamily: '', fontSize: null, fontWeight: null, lineHeight: null, letterSpacing: null },
      ]);
    });
  });

  it('treats a nodes response with no "nodes" key at all as an empty node map (nb?.nodes ?? {} fallback)', async () => {
    mockHttpsRequest((path) => {
      if (path.includes('/styles')) {
        return {
          status: 200,
          body: { meta: { styles: [{ node_id: '1:1', style_type: 'FILL', name: 'Whatever' }] } },
        };
      }
      return { status: 200, body: {} }; // no `nodes` key
    });
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.colors).toEqual([]);
      expect(body.typography).toEqual([]);
      expect(body.rawStyleCount).toBe(1);
    });
  });

  it('defaults opacity to 100 when a SOLID fill color has no alpha channel, and skips a SOLID fill with no color object', async () => {
    mockHttpsRequest((path) => {
      if (path.includes('/styles')) {
        return {
          status: 200,
          body: {
            meta: {
              styles: [
                { node_id: '1:1', style_type: 'FILL', name: 'NoAlpha' },
                { node_id: '1:2', style_type: 'FILL', name: 'NoColorObject' },
              ],
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          nodes: {
            '1:1': { document: { fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0 } }] } }, // no `a` -- exercises the `a = 1` default
            '1:2': { document: { fills: [{ type: 'SOLID' }] } }, // no `color` at all -- fill.color falsy short-circuits the push
          },
        },
      };
    });
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.colors).toEqual([{ name: 'NoAlpha', hex: '#00ff00', opacity: 100 }]);
    });
  });

  it('counts a style whose style_type is neither FILL nor TEXT in rawStyleCount without adding it to colors or typography', async () => {
    mockHttpsRequest((path) => {
      if (path.includes('/styles')) {
        return {
          status: 200,
          body: { meta: { styles: [{ node_id: '1:1', style_type: 'EFFECT', name: 'Shadow/Card' }] } },
        };
      }
      return { status: 200, body: { nodes: { '1:1': { document: {} } } } };
    });
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/figma/styles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: 'file123', token: 'tok' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.rawStyleCount).toBe(1);
      expect(body.colors).toEqual([]);
      expect(body.typography).toEqual([]);
    });
  });
});
