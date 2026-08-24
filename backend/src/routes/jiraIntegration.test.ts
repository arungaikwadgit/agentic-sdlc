// Tests for backend/src/routes/jiraIntegration.js (POST /test). Mirrors
// githubIntegration.test.ts's structure (same jest.mock('https') seam, same
// mockHttpsRequestOnce/buildApp/withServer helpers) -- jiraIntegration.js
// also does `const https = require('https')` inside its factory function.
//
// Unlike GitHub's single-request /test, Jira's /test makes up to two https
// calls in sequence: GET /rest/api/3/myself (auth check), then GET
// /rest/api/3/project/:key (project visibility check) -- only reached if
// auth succeeded. Tests that expect the auth check to fail queue exactly one
// mockHttpsRequestOnce; tests that reach the project check queue two.

export {};

jest.mock('https');

const express = require('express');
const https = require('https');
const { createJiraIntegrationRouter } = require('./jiraIntegration');

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
  const router = createJiraIntegrationRouter({ checkToken });
  app.use('/api/jira', router);
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

const VALID_BODY = {
  baseUrl: 'https://example.atlassian.net',
  email: 'user@example.com',
  apiToken: 'tok',
  projectKey: 'ENG',
};

describe('createJiraIntegrationRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /test', () => {
    it('400 when any required field is missing', async () => {
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl: 'https://x.atlassian.net', email: 'a@b.com' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/baseUrl, email, apiToken, and projectKey are required/);
      });
      expect(https.request).not.toHaveBeenCalled();
    });

    it('400 when the request has no body at all', async () => {
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, { method: 'POST' });
        expect(response.status).toBe(400);
      });
      expect(https.request).not.toHaveBeenCalled();
    });

    it('success: auth ok and project found, returns ok:true with the resolved project name', async () => {
      mockHttpsRequestOnce({ status: 200, body: { emailAddress: 'user@example.com' } });
      mockHttpsRequestOnce({ status: 200, body: { name: 'Engineering' } });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(VALID_BODY),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({ ok: true, message: 'Connected as user@example.com, project "Engineering" found.' });
      });
      expect(https.request).toHaveBeenCalledTimes(2);
    });

    it('invalid credentials (401 on the auth check) returns ok:false and never checks the project', async () => {
      mockHttpsRequestOnce({ status: 401, body: {} });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(VALID_BODY),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({ ok: false, message: 'Invalid email or API token.' });
      });
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    it('forbidden (403 on the auth check) is also reported as invalid credentials', async () => {
      mockHttpsRequestOnce({ status: 403, body: {} });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(VALID_BODY),
        });
        const body: any = await response.json();
        expect(body).toEqual({ ok: false, message: 'Invalid email or API token.' });
      });
    });

    it('unexpected status on the auth check is echoed as ok:false', async () => {
      mockHttpsRequestOnce({ status: 500, body: {} });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(VALID_BODY),
        });
        const body: any = await response.json();
        expect(body).toEqual({ ok: false, message: 'Jira responded with HTTP 500 while verifying credentials.' });
      });
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    it('valid credentials but project not found (404) returns ok:false with a descriptive message', async () => {
      mockHttpsRequestOnce({ status: 200, body: { emailAddress: 'user@example.com' } });
      mockHttpsRequestOnce({ status: 404, body: {} });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(VALID_BODY),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.ok).toBe(false);
        expect(body.message).toMatch(/project "ENG" was not found/);
      });
    });

    it('valid credentials but unexpected status on the project check is echoed as ok:false', async () => {
      mockHttpsRequestOnce({ status: 200, body: { emailAddress: 'user@example.com' } });
      mockHttpsRequestOnce({ status: 500, body: {} });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(VALID_BODY),
        });
        const body: any = await response.json();
        expect(body.ok).toBe(false);
        expect(body.message).toMatch(/HTTP 500/);
      });
    });

    it('502 when the request to Jira fails (network error)', async () => {
      mockHttpsRequestOnce({ error: new Error('ETIMEDOUT') });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(VALID_BODY),
        });
        const body: any = await response.json();
        expect(response.status).toBe(502);
        expect(body.error).toBe('Failed to reach Jira: ETIMEDOUT');
      });
    });

    it('502 when baseUrl is not a valid URL', async () => {
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...VALID_BODY, baseUrl: 'not a url at all' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(502);
        expect(body.error).toBe('Failed to reach Jira: Invalid Jira base URL');
      });
      expect(https.request).not.toHaveBeenCalled();
    });

    it('sends HTTP Basic auth built from email:apiToken, not a bearer token', async () => {
      mockHttpsRequestOnce({ status: 200, body: { emailAddress: 'user@example.com' } });
      mockHttpsRequestOnce({ status: 200, body: { name: 'Engineering' } });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        await fetch(`${baseUrl}/api/jira/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(VALID_BODY),
        });
      });
      const firstCallOptions = (https.request as jest.Mock).mock.calls[0][0];
      const expectedAuth = `Basic ${Buffer.from('user@example.com:tok', 'utf8').toString('base64')}`;
      expect(firstCallOptions.headers.Authorization).toBe(expectedAuth);
      expect(firstCallOptions.hostname).toBe('example.atlassian.net');
      expect(firstCallOptions.path).toBe('/rest/api/3/myself');
    });
  });
});
