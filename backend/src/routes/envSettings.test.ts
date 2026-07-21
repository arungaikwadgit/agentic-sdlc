// Tests for backend/src/routes/envSettings.js (GET / and POST /, which
// read/write backend/.env directly on disk). Both handlers do
// `const fs = require('fs')` INSIDE the handler body at call time, so the
// mocking seam is jest.mock('fs') with an explicit factory limited to the
// four fs functions this file actually calls -- this guarantees no test in
// this file ever touches the real filesystem's .env, in the scratch
// checkout or otherwise.

export {};

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  chmodSync: jest.fn(),
}));

const express = require('express');
const fs = require('fs');
const { createEnvSettingsRouter } = require('./envSettings');

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());
  const checkToken =
    overrides.checkToken ||
    ((req: any, _res: any, next: any) => {
      req.authUser = { email: 'admin@example.com' };
      next();
    });
  const requireAdmin = overrides.requireAdmin || ((_req: any, _res: any, next: any) => next());
  const router = createEnvSettingsRouter({ checkToken, requireAdmin });
  app.use('/api/settings', router);
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

describe('createEnvSettingsRouter', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /', () => {
    it('403 when requireAdmin denies the request (fs is never touched)', async () => {
      const requireAdmin = (_req: any, res: any) => res.status(403).json({ error: 'admin only' });
      const app = buildApp({ requireAdmin });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`);
        expect(response.status).toBe(403);
      });
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('returns defaults when the .env file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`);
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({
          openaiApiKey: '',
          anthropicApiKey: '',
          huggingfaceApiKey: '',
          proxyToken: '',
          openaiModel: 'gpt-4o',
          anthropicModel: 'claude-opus-4-5',
          anthropicEnabled: false,
          defaultLlmProvider: 'openai',
          agentProviderMap: {},
          modelCatalog: [],
          hasOpenaiKey: false,
          hasAnthropicKey: false,
          hasHuggingfaceKey: false,
          hasProxyToken: false,
          hasGmailAppPassword: false,
          gmailUser: '',
          appUrl: '',
        });
      });
    });

    it('parses an existing .env file and masks secret values', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        [
          'OPENAI_API_KEY=sk-123',
          'OPENAI_MODEL=gpt-4o-mini',
          'PROXY_TOKEN=tok-1',
          'ANTHROPIC_API_KEY=ak-1',
          'ANTHROPIC_MODEL=claude-3',
          'ANTHROPIC_ENABLED=true',
          'DEFAULT_LLM_PROVIDER=anthropic',
          'AGENT_PROVIDER_MAP={"architecture":"anthropic"}',
          'HUGGINGFACE_API_KEY=hf-1',
          'MODEL_CATALOG=[{"id":"gpt-4o"}]',
          'GMAIL_USER=me@example.com',
          'GMAIL_APP_PASSWORD=secretpass',
          'APP_URL=https://app.example.com',
        ].join('\n'),
      );
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`);
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.openaiApiKey).toBe('***');
        expect(body.anthropicApiKey).toBe('***');
        expect(body.huggingfaceApiKey).toBe('***');
        expect(body.proxyToken).toBe('***');
        expect(body.openaiModel).toBe('gpt-4o-mini');
        expect(body.anthropicModel).toBe('claude-3');
        expect(body.anthropicEnabled).toBe(true);
        expect(body.defaultLlmProvider).toBe('anthropic');
        expect(body.agentProviderMap).toEqual({ architecture: 'anthropic' });
        expect(body.modelCatalog).toEqual([{ id: 'gpt-4o' }]);
        expect(body.hasOpenaiKey).toBe(true);
        expect(body.hasAnthropicKey).toBe(true);
        expect(body.hasHuggingfaceKey).toBe(true);
        expect(body.hasProxyToken).toBe(true);
        expect(body.hasGmailAppPassword).toBe(true);
        expect(body.gmailUser).toBe('me@example.com');
        expect(body.appUrl).toBe('https://app.example.com');
      });
    });

    it('falls back to {} / [] when AGENT_PROVIDER_MAP or MODEL_CATALOG is malformed JSON', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(['AGENT_PROVIDER_MAP=not-json', 'MODEL_CATALOG=also-not-json'].join('\n'));
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`);
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.agentProviderMap).toEqual({});
        expect(body.modelCatalog).toEqual([]);
      });
    });

    it('500 when reading the file throws', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES');
      });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`);
        const body: any = await response.json();
        expect(response.status).toBe(500);
        expect(body.error).toBe('Failed to read settings: EACCES');
      });
    });
  });

  describe('POST /', () => {
    it('403 when requireAdmin denies the request (fs is never touched)', async () => {
      const requireAdmin = (_req: any, res: any) => res.status(403).json({ error: 'admin only' });
      const app = buildApp({ requireAdmin });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openaiApiKey: 'sk-x' }),
        });
        expect(response.status).toBe(403);
      });
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('400 when a string field contains a newline (CRLF/env-injection guard)', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openaiApiKey: 'sk-1\nEVIL_KEY=injected' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toBe('openaiApiKey cannot contain newline characters');
      });
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('writes new settings to a fresh (nonexistent) .env file and locks its permissions', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const app = buildApp();
      let responseBody: any;
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openaiApiKey: 'sk-new', openaiModel: 'gpt-4o' }),
        });
        responseBody = await response.json();
        expect(response.status).toBe(200);
      });
      expect(responseBody).toEqual({ ok: true, message: 'Settings saved. Restart the backend for changes to take effect.' });
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const [writtenPath, writtenContent, encoding] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(typeof writtenPath).toBe('string');
      expect(writtenContent).toBe('OPENAI_API_KEY=sk-new\nOPENAI_MODEL=gpt-4o\n');
      expect(encoding).toBe('utf8');
      expect(fs.chmodSync).toHaveBeenCalledWith(writtenPath, 0o600);
    });

    it('upserts into existing lines (replacing the matching KEY=, keeping unrelated lines, dropping blanks)', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('OPENAI_MODEL=old-model\nFOO=bar\n\n');
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openaiModel: 'new-model' }),
        });
        expect(response.status).toBe(200);
      });
      const [, writtenContent] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(writtenContent).toBe('OPENAI_MODEL=new-model\nFOO=bar\n');
    });

    it('writes an explicit anthropicEnabled:false (upsertFlag writes even falsy values)', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ anthropicEnabled: false }),
        });
        expect(response.status).toBe(200);
      });
      const [, writtenContent] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(writtenContent).toBe('ANTHROPIC_ENABLED=false\n');
    });

    it('trims gmailUser and strips whitespace from gmailAppPassword before writing', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gmailUser: ' user@example.com ', gmailAppPassword: 'abcd efgh ijkl' }),
        });
        expect(response.status).toBe(200);
      });
      const [, writtenContent] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(writtenContent).toContain('GMAIL_USER=user@example.com');
      expect(writtenContent).toContain('GMAIL_APP_PASSWORD=abcdefghijkl');
    });

    it('500 when writing the file throws', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOSPC');
      });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openaiApiKey: 'sk-x' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(500);
        expect(body.error).toBe('Failed to write settings: ENOSPC');
      });
    });

    it('still returns 200 ok:true when chmodSync fails (best-effort, must not block the save)', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.chmodSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOTSUP');
      });
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openaiApiKey: 'sk-x' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
      });
    });

    // The two tests below exercise the CRLF/env-injection guard's
    // JSON.stringify(...) branches for agentProviderMap/modelCatalog
    // (envSettings.js lines ~115-120). In real usage these two `if` branches
    // are effectively unreachable through legitimate objects: JSON.stringify
    // always *escapes* embedded \r/\n as the two literal characters
    // backslash-n rather than emitting raw control bytes, for any string
    // value nested anywhere in the structure (and this holds even if a
    // nested value defines a custom toJSON()). Rather than leave this
    // defensive guard completely unverified, these tests stub the global
    // JSON.stringify just long enough to prove the route correctly rejects
    // with 400 *if* stringification of that specific field ever did produce
    // a raw newline -- restoring the real JSON.stringify afterward.
    it('400 when a stringified agentProviderMap unexpectedly contains a raw newline (defensive guard, synthetic case)', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const app = buildApp();
      const originalStringify = JSON.stringify;
      const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: any, ...rest: any[]) => {
        if (value && typeof value === 'object' && value.__injected) return 'not-json\nBUT_HAS_A_RAW_NEWLINE';
        return originalStringify(value, ...(rest as [any, any?]));
      });
      try {
        await withServer(app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: originalStringify({ agentProviderMap: { __injected: true } }),
          });
          const body: any = await response.json();
          expect(response.status).toBe(400);
          expect(body.error).toBe('agentProviderMap cannot contain newline characters');
        });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('400 when a stringified modelCatalog unexpectedly contains a raw newline (defensive guard, synthetic case)', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const app = buildApp();
      const originalStringify = JSON.stringify;
      const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: any, ...rest: any[]) => {
        if (value && typeof value === 'object' && value.__injected) return 'not-json\nBUT_HAS_A_RAW_NEWLINE';
        return originalStringify(value, ...(rest as [any, any?]));
      });
      try {
        await withServer(app, async (baseUrl) => {
          const response = await fetch(`${baseUrl}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: originalStringify({ modelCatalog: { __injected: true } }),
          });
          const body: any = await response.json();
          expect(response.status).toBe(400);
          expect(body.error).toBe('modelCatalog cannot contain newline characters');
        });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('writes proxyToken, anthropic settings, agentProviderMap, huggingfaceApiKey, modelCatalog, and appUrl on a fresh file', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proxyToken: 'tok-2',
            anthropicApiKey: 'ak-2',
            anthropicModel: 'claude-3-opus',
            agentProviderMap: { architecture: 'anthropic' },
            huggingfaceApiKey: 'hf-2',
            modelCatalog: [{ id: 'gpt-4o' }],
            appUrl: 'https://app.example.com',
          }),
        });
        expect(response.status).toBe(200);
      });
      const [, writtenContent] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(writtenContent).toContain('PROXY_TOKEN=tok-2');
      expect(writtenContent).toContain('ANTHROPIC_API_KEY=ak-2');
      expect(writtenContent).toContain('ANTHROPIC_MODEL=claude-3-opus');
      expect(writtenContent).toContain('AGENT_PROVIDER_MAP={"architecture":"anthropic"}');
      expect(writtenContent).toContain('HUGGINGFACE_API_KEY=hf-2');
      expect(writtenContent).toContain('MODEL_CATALOG=[{"id":"gpt-4o"}]');
      expect(writtenContent).toContain('APP_URL=https://app.example.com');
    });

    it('replaces (rather than duplicates) existing AGENT_PROVIDER_MAP/MODEL_CATALOG/ANTHROPIC_ENABLED lines (upsertFlag idx>=0 branch)', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        ['AGENT_PROVIDER_MAP={"old":"value"}', 'MODEL_CATALOG=[]', 'ANTHROPIC_ENABLED=false', 'UNRELATED=keep-me'].join('\n'),
      );
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentProviderMap: { architecture: 'openai' },
            modelCatalog: [{ id: 'new-model' }],
            anthropicEnabled: true,
          }),
        });
        expect(response.status).toBe(200);
      });
      const [, writtenContent] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      const lines = writtenContent.split('\n').filter(Boolean);
      expect(lines).toEqual([
        'AGENT_PROVIDER_MAP={"architecture":"openai"}',
        'MODEL_CATALOG=[{"id":"new-model"}]',
        'ANTHROPIC_ENABLED=true',
        'UNRELATED=keep-me',
      ]);
    });

    it('writes defaultLlmProvider when provided', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const app = buildApp();
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultLlmProvider: 'anthropic' }),
        });
        expect(response.status).toBe(200);
      });
      const [, writtenContent] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(writtenContent).toBe('DEFAULT_LLM_PROVIDER=anthropic\n');
    });
  });
});
