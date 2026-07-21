// Tests for backend/src/routes/githubIntegration.js (POST /test and POST
// /issues). Like figmaIntegration.js, githubIntegration.js does
// `const https = require('https')` INSIDE the factory function body, so the
// only mocking seam is jest.mock('https') at module-resolution level.

export {};

jest.mock('https');

const express = require('express');
const https = require('https');
const { createGithubIntegrationRouter } = require('./githubIntegration');

type Outcome = { status: number; body: any } | { error: Error };

function mockHttpsRequestOnce(outcome: Outcome) {
  (https.request as jest.Mock).mockImplementationOnce((_options: any, callback: any) => {
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
  const router = createGithubIntegrationRouter({ checkToken });
  app.use('/api/github', router);
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

describe('createGithubIntegrationRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /test', () => {
    it('400 when token, owner, or repo is missing', async () => {
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 't', owner: 'o' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/token, owner, and repo are required/);
      });
      expect(https.request).not.toHaveBeenCalled();
    });

    it('400 when the request has no body at all (req.body ?? {} fallback)', async () => {
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/test`, { method: 'POST' });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/token, owner, and repo are required/);
      });
      expect(https.request).not.toHaveBeenCalled();
    });

    it('success (public repo): returns ok:true without a "(private)" suffix', async () => {
      mockHttpsRequestOnce({ status: 200, body: { full_name: 'octo/repo', private: false } });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok', owner: 'octo', repo: 'repo' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({ ok: true, message: 'Connected to octo/repo.' });
      });
    });

    it('success (private repo): appends "(private)" to the message', async () => {
      mockHttpsRequestOnce({ status: 200, body: { full_name: 'octo/secret', private: true } });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok', owner: 'octo', repo: 'secret' }),
        });
        const body: any = await response.json();
        expect(body.message).toBe('Connected to octo/secret (private).');
      });
    });

    it('repo not found (404) returns ok:false with a descriptive message (still HTTP 200)', async () => {
      mockHttpsRequestOnce({ status: 404, body: {} });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok', owner: 'octo', repo: 'missing' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.ok).toBe(false);
        expect(body.message).toMatch(/not found, or the token doesn't have access/);
      });
    });

    it('invalid token (401) returns ok:false', async () => {
      mockHttpsRequestOnce({ status: 401, body: {} });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'bad', owner: 'octo', repo: 'repo' }),
        });
        const body: any = await response.json();
        expect(body).toEqual({ ok: false, message: 'Invalid or expired token.' });
      });
    });

    it('unexpected status is echoed as ok:false', async () => {
      mockHttpsRequestOnce({ status: 500, body: {} });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok', owner: 'octo', repo: 'repo' }),
        });
        const body: any = await response.json();
        expect(body).toEqual({ ok: false, message: 'GitHub responded with HTTP 500.' });
      });
    });

    it('502 when the request to GitHub fails (network error)', async () => {
      mockHttpsRequestOnce({ error: new Error('ETIMEDOUT') });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok', owner: 'octo', repo: 'repo' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(502);
        expect(body.error).toBe('Failed to reach GitHub: ETIMEDOUT');
      });
    });
  });

  describe('POST /issues', () => {
    it('400 when required fields are missing or issues is not a non-empty array', async () => {
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok', owner: 'octo', repo: 'repo', issues: [] }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/non-empty issues array are required/);
      });
      expect(https.request).not.toHaveBeenCalled();
    });

    it('400 when the request has no body at all (req.body ?? {} fallback)', async () => {
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/issues`, { method: 'POST' });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/non-empty issues array are required/);
      });
      expect(https.request).not.toHaveBeenCalled();
    });

    it('400 when more than 50 issues are requested', async () => {
      const issues = Array.from({ length: 51 }, (_, i) => ({ title: `Issue ${i}` }));
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok', owner: 'octo', repo: 'repo', issues }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/Cannot create more than 50 issues/);
      });
      expect(https.request).not.toHaveBeenCalled();
    });

    it('creates issues successfully and reports created/total counts', async () => {
      mockHttpsRequestOnce({ status: 201, body: { number: 101, html_url: 'https://github.com/octo/repo/issues/101' } });
      mockHttpsRequestOnce({ status: 201, body: { number: 102, html_url: 'https://github.com/octo/repo/issues/102' } });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: 'tok',
            owner: 'octo',
            repo: 'repo',
            issues: [
              { title: 'Bug A', body: 'desc A', labels: ['bug'] },
              { title: 'Bug B' },
            ],
          }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.created).toBe(2);
        expect(body.total).toBe(2);
        expect(body.results).toEqual([
          { title: 'Bug A', ok: true, number: 101, url: 'https://github.com/octo/repo/issues/101' },
          { title: 'Bug B', ok: true, number: 102, url: 'https://github.com/octo/repo/issues/102' },
        ]);
      });
    });

    it('skips issues missing a title without making a request for them (title undefined and a null issue entry)', async () => {
      // Using `{}` (no title key at all) and a literal `null` array entry rather
      // than `{ title: '' }` -- `title ?? '(missing)'` in the source is a
      // nullish-coalesce, so an empty string would NOT fall back to
      // '(missing)' (only null/undefined do). This also exercises the
      // `issue ?? {}` destructuring fallback for a null array entry.
      mockHttpsRequestOnce({ status: 201, body: { number: 5, html_url: 'https://github.com/octo/repo/issues/5' } });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: 'tok',
            owner: 'octo',
            repo: 'repo',
            issues: [{}, null, { title: 'Good one' }],
          }),
        });
        const body: any = await response.json();
        expect(body.created).toBe(1);
        expect(body.total).toBe(3);
        expect(body.results[0]).toEqual({ title: '(missing)', ok: false, error: 'Missing title' });
        expect(body.results[1]).toEqual({ title: '(missing)', ok: false, error: 'Missing title' });
        expect(body.results[2]).toEqual({ title: 'Good one', ok: true, number: 5, url: 'https://github.com/octo/repo/issues/5' });
      });
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    it('falls back to "HTTP <status>" when a non-201 response has no message field', async () => {
      mockHttpsRequestOnce({ status: 500, body: {} });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok', owner: 'octo', repo: 'repo', issues: [{ title: 'No message' }] }),
        });
        const body: any = await response.json();
        expect(body.results[0]).toEqual({ title: 'No message', ok: false, error: 'HTTP 500' });
      });
    });

    it('records a per-issue failure when GitHub returns a non-201 status with a message', async () => {
      mockHttpsRequestOnce({ status: 422, body: { message: 'Validation failed' } });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok', owner: 'octo', repo: 'repo', issues: [{ title: 'Broken' }] }),
        });
        const body: any = await response.json();
        expect(body.created).toBe(0);
        expect(body.results[0]).toEqual({ title: 'Broken', ok: false, error: 'Validation failed' });
      });
    });

    it('records a per-issue failure when the request throws (network error), and still processes remaining issues', async () => {
      mockHttpsRequestOnce({ error: new Error('ECONNRESET') });
      mockHttpsRequestOnce({ status: 201, body: { number: 9, html_url: 'https://github.com/octo/repo/issues/9' } });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/github/issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: 'tok',
            owner: 'octo',
            repo: 'repo',
            issues: [{ title: 'Fails' }, { title: 'Succeeds' }],
          }),
        });
        const body: any = await response.json();
        expect(body.created).toBe(1);
        expect(body.total).toBe(2);
        expect(body.results[0]).toEqual({ title: 'Fails', ok: false, error: 'ECONNRESET' });
        expect(body.results[1]).toEqual({ title: 'Succeeds', ok: true, number: 9, url: 'https://github.com/octo/repo/issues/9' });
      });
    });
  });
});
