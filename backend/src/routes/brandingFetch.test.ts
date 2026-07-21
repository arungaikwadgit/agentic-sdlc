// Tests for backend/src/routes/brandingFetch.js (POST /, mounted in
// production as /api/fetch-site). brandingFetch.js does
// `const https = require('https')` and `const http = require('http')`
// INSIDE the factory function body, so the only mocking seam is
// jest.mock('https') / jest.mock('http') at module-resolution level.

export {};

jest.mock('https');
jest.mock('http', () => ({
  ...jest.requireActual('http'),
  request: jest.fn(),
}));

const express = require('express');
const https = require('https');
const http = require('http');
const { createBrandingFetchRouter } = require('./brandingFetch');

type Outcome = { status: number; headers?: Record<string, string>; body: string } | { error: Error };

function installMock(lib: any, outcomes: Outcome[]) {
  let i = 0;
  (lib.request as jest.Mock).mockImplementation((_options: any, callback: any) => {
    const outcome = outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    let errorHandler: ((err: Error) => void) | null = null;
    const req = {
      on: (event: string, handler: any) => {
        if (event === 'error') errorHandler = handler;
        return req;
      },
      end: () => {
        if ('error' in outcome) {
          if (errorHandler) errorHandler(outcome.error);
          return;
        }
        const res = {
          statusCode: outcome.status,
          headers: outcome.headers ?? {},
          resume: () => {},
          on: (event: string, handler: any) => {
            if (event === 'data') handler(Buffer.from(outcome.body));
            if (event === 'end') handler();
          },
        };
        callback(res);
      },
      destroy: () => {},
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
  const router = createBrandingFetchRouter({ checkToken });
  app.use('/api/fetch-site', router);
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

describe('createBrandingFetchRouter (POST /)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('400 when url is missing or not a string', async () => {
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body: any = await response.json();
      expect(response.status).toBe(400);
      expect(body.error).toBe('url is required');
    });
    expect(https.request).not.toHaveBeenCalled();
  });

  it('400 when the value cannot be parsed as a URL even after defaulting to https://', async () => {
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'not a valid host' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid URL');
    });
    expect(https.request).not.toHaveBeenCalled();
  });

  it('success: fetches an https URL (protocol defaulted) and extracts branding signals', async () => {
    installMock(https, [
      {
        status: 200,
        body: `<html><head>
          <title> My Site </title>
          <meta name="description" content="A great site">
          <meta name="theme-color" content="#112233">
          <meta property="og:title" content="My Site OG">
          <link href="https://fonts.googleapis.com/css2?family=Roboto+Slab&display=swap" rel="stylesheet">
          <style>:root{--brand-color: #445566;} .a{color:#abcdef;}</style>
        </head><body></body></html>`,
      },
    ]);
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'example.com' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.title).toBe('My Site');
      expect(body.description).toBe('A great site');
      expect(body.themeColor).toBe('#112233');
      expect(body.ogTags).toEqual({ title: 'My Site OG' });
      expect(body.cssVars).toEqual(expect.arrayContaining(['--brand-color: #445566']));
      expect(body.googleFonts).toEqual(expect.arrayContaining(['Roboto Slab']));
      expect(body.colorsFound).toEqual(expect.arrayContaining(['#112233', '#445566', '#abcdef']));
      expect(body.url).toBe('https://example.com/');
    });
    expect(http.request).not.toHaveBeenCalled();
  });

  it('502 when the site responds with a non-2xx status', async () => {
    installMock(https, [{ status: 500, body: '' }]);
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'example.com' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toBe('Site responded with HTTP 500');
    });
  });

  it('502 when the underlying request fails (network error)', async () => {
    installMock(https, [{ error: new Error('ENOTFOUND') }]);
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'nowhere.example' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toBe('Failed to fetch site: ENOTFOUND');
    });
  });

  it('follows a single redirect hop and extracts signals from the final page', async () => {
    installMock(https, [
      { status: 301, headers: { location: 'https://redirected.example.com/final' }, body: '' },
      { status: 200, body: '<html><head><title>Redirected Page</title></head></html>' },
    ]);
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'example.com' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.title).toBe('Redirected Page');
      expect(body.url).toBe('https://redirected.example.com/final');
    });
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it('uses the http module (not https) when the caller supplies an explicit http:// URL', async () => {
    installMock(http, [{ status: 200, body: '<html><head><title>Plain HTTP Page</title></head></html>' }]);
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://plain-example.com/page' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.title).toBe('Plain HTTP Page');
    });
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(https.request).not.toHaveBeenCalled();
  });

  it('502 when a redirect Location header points at a non-http(s) scheme', async () => {
    installMock(https, [
      { status: 302, headers: { location: 'ftp://evil.example.com/payload' }, body: '' },
    ]);
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'example.com' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toBe('Failed to fetch site: Only http/https URLs are supported');
    });
  });

  it('truncates style block content once the combined size passes the 20,000-character cap', async () => {
    const hugeStyle = 'a'.repeat(25_000);
    installMock(https, [
      { status: 200, body: `<html><head><title>Big Styles</title><style>${hugeStyle}</style></head></html>` },
    ]);
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'example.com' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.styleSampleChars.length).toBe(8000); // styleSampleChars itself caps at 8000
    });
  });

  it('stops accumulating data once the ~1.5MB response size cap is exceeded', async () => {
    const hugeBody = '<html><head><title>' + 'x'.repeat(1_600_000) + '</title></head></html>';
    installMock(https, [{ status: 200, body: hugeBody }]);
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'example.com' }),
      });
      const body: any = await response.json();
      // The single oversized chunk trips the cap before any of it is appended,
      // so nothing was scanned -- title comes back null rather than the huge string.
      expect(response.status).toBe(200);
      expect(body.title).toBeNull();
    });
  });

  it('skips a blank/whitespace-only <style> block without adding it to the style sample', async () => {
    installMock(https, [
      {
        status: 200,
        body: '<html><head><title>Blank Style</title><style>   </style><style>.real{color:#123456;}</style></head></html>',
      },
    ]);
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/fetch-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'example.com' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.styleSampleChars).toBe('.real{color:#123456;}');
    });
  });
});
