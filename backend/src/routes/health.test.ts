export {};

const express = require('express');
const { createHealthRouter } = require('./health');

function buildApp(config: any = {}) {
  const app = express();
  const router = createHealthRouter({
    openaiModel: 'gpt-4o',
    anthropicEnabled: true,
    anthropicModel: 'claude-3-5-sonnet',
    defaultLlmProvider: 'openai',
    corpProxy: 'http://proxy.example.com:8080',
    ...config,
  });
  app.use('/api/health', router);
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

describe('createHealthRouter', () => {
  it('returns 200 with the full config reflected when anthropic is enabled', async () => {
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      const body: any = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.model).toBe('gpt-4o');
      expect(body.claudeEnabled).toBe(true);
      expect(body.claudeModel).toBe('claude-3-5-sonnet');
      expect(body.defaultProvider).toBe('openai');
      expect(body.proxy).toBe('http://proxy.example.com:8080');
      expect(typeof body.ts).toBe('number');
    });
  });

  it('returns claudeModel: null and proxy: null when anthropic is disabled and no corpProxy is configured', async () => {
    const app = buildApp({ anthropicEnabled: false, anthropicModel: 'claude-3-5-sonnet', corpProxy: '' });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      const body: any = await response.json();

      expect(response.status).toBe(200);
      expect(body.claudeEnabled).toBe(false);
      expect(body.claudeModel).toBeNull();
      expect(body.proxy).toBeNull();
      expect(body.defaultProvider).toBe('openai');
    });
  });

  it('reflects a different defaultLlmProvider value verbatim', async () => {
    const app = buildApp({ defaultLlmProvider: 'anthropic' });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      const body: any = await response.json();

      expect(response.status).toBe(200);
      expect(body.defaultProvider).toBe('anthropic');
    });
  });
});
