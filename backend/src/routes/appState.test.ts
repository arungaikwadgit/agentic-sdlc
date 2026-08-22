export {};
// Tests for backend/src/routes/appState.js
// Boots a real express() app around createAppStateRouter with fully-mocked
// DI dependencies, then exercises it over real HTTP via global fetch.

const express = require('express');
const { createAppStateRouter } = require('./appState');
const {
  encryptIntegrationCredentials,
  decryptIntegrationCredentials,
} = require('../integrationCredentialCrypto');

function defaultAppStateStore(): any {
  return {
    setAppConfigValue: jest.fn(async () => {}),
    deleteAllAppConfig: jest.fn(async () => {}),
    listIntegrations: jest.fn(async () => []),
    getIntegration: jest.fn(async () => null),
    saveIntegration: jest.fn(async () => {}),
    deleteIntegration: jest.fn(async () => {}),
    listBacklogItems: jest.fn(async () => []),
    createBacklogItem: jest.fn(async () => {}),
    updateBacklogItem: jest.fn(async () => null),
    deleteBacklogItem: jest.fn(async () => {}),
  };
}

function buildDeps(overrides: any = {}) {
  const db = overrides.db !== undefined ? overrides.db : { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const getDb = overrides.getDb || (() => db);
  const checkToken = overrides.checkToken || ((req: any, res: any, next: any) => {
    req.authUser = { email: 'user@example.com', user: { id: 'u1' } };
    next();
  });
  const requireAdmin = overrides.requireAdmin || ((req: any, res: any, next: any) => next());
  const requireAppStateDb = overrides.requireAppStateDb || (async () => true);
  const dbGetAppConfigMap = overrides.dbGetAppConfigMap || jest.fn(async () => ({}));
  const fanOutRuntimeLifecycleEvent = overrides.fanOutRuntimeLifecycleEvent || jest.fn(async () => {});
  const appStateStore = overrides.appStateStore || defaultAppStateStore();
  const tokenOptimizationSkillKey = 'app:tokenOptimizationSkill';
  const setPromptOptimizationSkillCache = overrides.setPromptOptimizationSkillCache || jest.fn();

  return {
    getDb,
    checkToken,
    requireAdmin,
    requireAppStateDb,
    dbGetAppConfigMap,
    fanOutRuntimeLifecycleEvent,
    appStateStore,
    tokenOptimizationSkillKey,
    setPromptOptimizationSkillCache,
    db,
  };
}

async function startServer(overrides: any = {}) {
  const deps = buildDeps(overrides);
  const app = express();
  app.use(express.json());
  app.use('/api/app-state', createAppStateRouter(deps));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/app-state`;
  return { server, baseUrl, deps };
}

async function withServer(overrides: any, fn: (ctx: any) => Promise<void>) {
  const ctx = await startServer(overrides);
  try {
    await fn(ctx);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

describe('appState routes', () => {
  describe('GET /config', () => {
    it('returns values for all keys when no keys query param is supplied', async () => {
      const dbGetAppConfigMap = jest.fn(async () => ({ 'app:model': 'gpt' }));
      await withServer({ dbGetAppConfigMap }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ values: { 'app:model': 'gpt' } });
        expect(dbGetAppConfigMap).toHaveBeenCalledWith(null);
      });
    });

    it('splits, trims, and filters the keys query param', async () => {
      const dbGetAppConfigMap = jest.fn(async () => ({}));
      await withServer({ dbGetAppConfigMap }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config?keys=${encodeURIComponent('a, b ,,c')}`);
        expect(res.status).toBe(200);
        expect(dbGetAppConfigMap).toHaveBeenCalledWith(['a', 'b', 'c']);
      });
    });

    it('returns 503-shaped response when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'App state DB unavailable.' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config`);
        expect(res.status).toBe(503);
        const body: any = await res.json();
        expect(body).toEqual({ error: 'App state DB unavailable.' });
      });
    });
  });

  describe('GET /config/:key', () => {
    it('returns the value for the key when present', async () => {
      const dbGetAppConfigMap = jest.fn(async () => ({ 'app:model': 'gpt-4' }));
      await withServer({ dbGetAppConfigMap }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:model`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ key: 'app:model', value: 'gpt-4' });
        expect(dbGetAppConfigMap).toHaveBeenCalledWith(['app:model']);
      });
    });

    it('falls back to null when the key value is undefined', async () => {
      const dbGetAppConfigMap = jest.fn(async () => ({}));
      await withServer({ dbGetAppConfigMap }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/missing-key`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({ key: 'missing-key', value: null });
      });
    });

    it('returns 400 when the key trims to empty', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/%20`);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'key is required' });
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:model`);
        expect(res.status).toBe(503);
      });
    });
  });

  describe('PUT /config/:key', () => {
    it('sets the value and returns ok for a non-lifecycle key', async () => {
      const fanOutRuntimeLifecycleEvent = jest.fn(async () => {});
      await withServer({ fanOutRuntimeLifecycleEvent }, async ({ baseUrl, deps }) => {
        const res = await fetch(`${baseUrl}/config/some:key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'hello' }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(deps.db.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO app_config'),
          ['some:key', JSON.stringify('hello')],
        );
        expect(fanOutRuntimeLifecycleEvent).not.toHaveBeenCalled();
      });
    });

    it('defaults value to null when body.value is absent', async () => {
      await withServer({}, async ({ baseUrl, deps }) => {
        const res = await fetch(`${baseUrl}/config/some:key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(200);
        expect(deps.db.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO app_config'),
          ['some:key', JSON.stringify(null)],
        );
      });
    });

    it('refreshes the prompt-optimization cache via the real-DB path when the token-optimization key is set', async () => {
      const setPromptOptimizationSkillCache = jest.fn();
      await withServer({ setPromptOptimizationSkillCache }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:tokenOptimizationSkill`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: { rules: { a: 1 } } }),
        });
        expect(res.status).toBe(200);
        expect(setPromptOptimizationSkillCache).toHaveBeenCalledWith({ value: { rules: { a: 1 } }, expiresAt: 0 });
      });
    });

    it('refreshes the cache with the built-in default when the token-optimization value is null (real-DB path)', async () => {
      const { DEFAULT_PROMPT_OPTIMIZATION_SKILL } = require('../promptOptimizationSkill');
      const setPromptOptimizationSkillCache = jest.fn();
      await withServer({ setPromptOptimizationSkillCache }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:tokenOptimizationSkill`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: null }),
        });
        expect(res.status).toBe(200);
        expect(setPromptOptimizationSkillCache).toHaveBeenCalledWith({ value: DEFAULT_PROMPT_OPTIMIZATION_SKILL, expiresAt: 0 });
      });
    });

    it('fires the lifecycle event for app:promptDefaults', async () => {
      const fanOutRuntimeLifecycleEvent = jest.fn(async () => {});
      await withServer({ fanOutRuntimeLifecycleEvent }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:promptDefaults`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: { a: 1 } }),
        });
        expect(res.status).toBe(200);
        expect(fanOutRuntimeLifecycleEvent).toHaveBeenCalledWith('prompt_changed', 'app:promptDefaults');
      });
    });

    it('fires the lifecycle event for app:model (model_changed)', async () => {
      const fanOutRuntimeLifecycleEvent = jest.fn(async () => {});
      await withServer({ fanOutRuntimeLifecycleEvent }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:model`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'gpt' }),
        });
        expect(res.status).toBe(200);
        expect(fanOutRuntimeLifecycleEvent).toHaveBeenCalledWith('model_changed', 'app:model');
      });
    });

    it('fires the lifecycle event for app:domainKnowledgeDefaults (data_changed)', async () => {
      const fanOutRuntimeLifecycleEvent = jest.fn(async () => {});
      await withServer({ fanOutRuntimeLifecycleEvent }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:domainKnowledgeDefaults`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: {} }),
        });
        expect(res.status).toBe(200);
        expect(fanOutRuntimeLifecycleEvent).toHaveBeenCalledWith('data_changed', 'app:domainKnowledgeDefaults');
      });
    });

    it('swallows a rejected lifecycle event via the internal .catch', async () => {
      const fanOutRuntimeLifecycleEvent = jest.fn(async () => { throw new Error('lifecycle boom'); });
      await withServer({ fanOutRuntimeLifecycleEvent }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:model`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'x' }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        // give the fire-and-forget rejection's .catch a tick to run so it doesn't
        // leak into other tests as an unhandled rejection
        await new Promise((resolve) => setImmediate(resolve));
      });
    });

    it('returns 400 when the key trims to empty', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/%20`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'x' }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'key is required' });
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/some:key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'x' }),
        });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/some:key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'x' }),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /config/batch', () => {
    it('sets every normalized key and fires distinct lifecycle events', async () => {
      const fanOutRuntimeLifecycleEvent = jest.fn(async () => {});
      await withServer({ fanOutRuntimeLifecycleEvent }, async ({ baseUrl, deps }) => {
        const res = await fetch(`${baseUrl}/config/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: {
              'app:promptDefaults': 'p',
              'app:model': 'm',
              'randomKey': 'r',
              '   ': 'skipped-because-blank-key',
            },
          }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        // 3 valid keys => 3 INSERTs (blank key skipped via `continue`)
        expect(deps.db.query).toHaveBeenCalledTimes(3);
        // BUG (pre-existing, not introduced by this test): the route builds
        // `lifecycleType + ':' + normalizedKey` (e.g. "prompt_changed:app:promptDefaults")
        // then recovers it via `change.split(':', 2)`. Because config keys
        // themselves contain a colon (the "app:" convention used by every
        // key in lifecycleTypeForConfigKey), split(':', 2) silently truncates
        // the key to "app" -- fanOutRuntimeLifecycleEvent is always called
        // with the wrong/truncated sourceKey for every batch update. See
        // appState.js lines ~325-328. Asserting the actual (buggy) behavior
        // here rather than hiding it.
        expect(fanOutRuntimeLifecycleEvent).toHaveBeenCalledWith('prompt_changed', 'app');
        expect(fanOutRuntimeLifecycleEvent).toHaveBeenCalledWith('model_changed', 'app');
        expect(fanOutRuntimeLifecycleEvent).toHaveBeenCalledTimes(2);
      });
    });

    it('swallows a rejected lifecycle event via the internal .catch', async () => {
      const fanOutRuntimeLifecycleEvent = jest.fn(async () => { throw new Error('batch lifecycle boom'); });
      await withServer({ fanOutRuntimeLifecycleEvent }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: { 'app:model': 'm' } }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        await new Promise((resolve) => setImmediate(resolve));
      });
    });

    it('returns 400 when values is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'values must be an object' });
      });
    });

    it('returns 400 when values is an array', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [1, 2, 3] }),
        });
        expect(res.status).toBe(400);
      });
    });

    it('returns 400 when values is not an object', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: 'nope' }),
        });
        expect(res.status).toBe(400);
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: { a: 1 } }),
        });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: { a: 1 } }),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('DELETE /config', () => {
    it('deletes all config and resets the prompt-optimization cache', async () => {
      const setPromptOptimizationSkillCache = jest.fn();
      await withServer({ setPromptOptimizationSkillCache }, async ({ baseUrl, deps }) => {
        const res = await fetch(`${baseUrl}/config`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(deps.db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM app_config'));
        expect(setPromptOptimizationSkillCache).toHaveBeenCalled();
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config`, { method: 'DELETE' });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config`, { method: 'DELETE' });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('GET /integrations', () => {
    it('lists and maps integration rows', async () => {
      const db = {
        query: jest.fn().mockResolvedValue({
          rows: [
            { id: 'i1', provider: 'slack', label: 'Slack', encrypted_data: 'enc', iv: 'iv1', created_at: '1000' },
          ],
        }),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({
          items: [{ id: 'i1', provider: 'slack', label: 'Slack', encryptedData: 'enc', iv: 'iv1', createdAt: 1000 }],
        });
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations`);
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations`);
        expect(res.status).toBe(503);
      });
    });
  });

  describe('GET /integrations/:id', () => {
    // Server-side decryption (backend/src/integrationCredentialCrypto.js) as
    // of the item #14 migration -- this route now decrypts before
    // responding, so these tests exercise the real crypto module against a
    // fixed test key rather than asserting on opaque ciphertext passthrough.
    const TEST_KEY = '11'.repeat(32);
    const originalKey = process.env.APP_INTEGRATION_ENCRYPTION_KEY;

    beforeEach(() => {
      process.env.APP_INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    });

    afterAll(() => {
      if (originalKey === undefined) delete process.env.APP_INTEGRATION_ENCRYPTION_KEY;
      else process.env.APP_INTEGRATION_ENCRYPTION_KEY = originalKey;
    });

    it('returns the decrypted credentials when found', async () => {
      const { encryptedData, iv } = encryptIntegrationCredentials({
        id: 'i1',
        provider: 'slack',
        credentials: { token: 'secret-token' },
        keyValue: TEST_KEY,
      });
      const db = {
        query: jest.fn().mockResolvedValue({
          rows: [{ id: 'i1', provider: 'slack', label: 'Slack', encrypted_data: encryptedData, iv, created_at: 2000 }],
        }),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body).toEqual({
          id: 'i1',
          provider: 'slack',
          label: 'Slack',
          credentials: { token: 'secret-token' },
          createdAt: 2000,
        });
      });
    });

    it('returns 404 when not found', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/missing`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Integration not found.' });
      });
    });

    it('returns 404 with code LEGACY_RECORD for records saved under the old client-side scheme', async () => {
      const db = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            id: 'i1',
            provider: 'slack',
            label: 'Slack',
            encrypted_data: 'client-side-aes-gcm-ciphertext',
            iv: 'browser-generated-iv',
            created_at: 2000,
          }],
        }),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Integration not found.', code: 'LEGACY_RECORD' });
      });
    });

    it('returns 500 with code KEY_NOT_CONFIGURED when the encryption key env var is unset', async () => {
      delete process.env.APP_INTEGRATION_ENCRYPTION_KEY;
      const db = {
        query: jest.fn().mockResolvedValue({
          rows: [{ id: 'i1', provider: 'slack', label: 'Slack', encrypted_data: '{}', iv: 'server:aes-256-gcm:v1', created_at: 2000 }],
        }),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          error: 'Integration credential encryption is not configured.',
          code: 'KEY_NOT_CONFIGURED',
        });
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`);
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`);
        expect(res.status).toBe(503);
      });
    });
  });

  describe('PUT /integrations/:id', () => {
    // Payload shape changed under the item #14 migration: the frontend now
    // sends plaintext credentials and the route encrypts server-side
    // (backend/src/integrationCredentialCrypto.js) instead of receiving an
    // already-encrypted blob from the browser.
    const TEST_KEY = '11'.repeat(32);
    const originalKey = process.env.APP_INTEGRATION_ENCRYPTION_KEY;
    const validPayload = { provider: 'slack', label: 'Slack', credentials: { token: 'secret-token' } };

    beforeEach(() => {
      process.env.APP_INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    });

    afterAll(() => {
      if (originalKey === undefined) delete process.env.APP_INTEGRATION_ENCRYPTION_KEY;
      else process.env.APP_INTEGRATION_ENCRYPTION_KEY = originalKey;
    });

    it('encrypts the credentials server-side and saves the integration', async () => {
      await withServer({}, async ({ baseUrl, deps }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 'i1' });
        expect(deps.db.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO app_integrations'),
          expect.arrayContaining(['i1', 'slack', 'Slack']),
        );
        const [, params] = deps.db.query.mock.calls[0];
        const [, , , encryptedData, iv] = params;
        expect(iv).toBe('server:aes-256-gcm:v1');
        expect(encryptedData).not.toContain('secret-token');
        expect(decryptIntegrationCredentials({
          id: 'i1',
          provider: 'slack',
          encryptedData,
          iv,
          keyValue: TEST_KEY,
        })).toEqual({ token: 'secret-token' });
      });
    });

    it('returns 400 when a required field is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'slack', label: 'Slack' }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'provider, label, and credentials are required.' });
      });
    });

    it('returns 500 with code KEY_NOT_CONFIGURED when the encryption key env var is unset', async () => {
      delete process.env.APP_INTEGRATION_ENCRYPTION_KEY;
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          error: 'Integration credential encryption is not configured.',
          code: 'KEY_NOT_CONFIGURED',
        });
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload),
        });
        expect(res.status).toBe(503);
      });
    });

    it('falls back to an empty payload (400) when the request has no body', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, { method: 'PUT' });
        expect(res.status).toBe(400);
      });
    });
  });

  describe('DELETE /integrations/:id', () => {
    it('deletes the integration', async () => {
      await withServer({}, async ({ baseUrl, deps }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(deps.db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM app_integrations'), ['i1']);
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, { method: 'DELETE' });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, { method: 'DELETE' });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('GET /backlog-items', () => {
    it('lists and maps backlog rows, dropping null notes', async () => {
      const db = {
        query: jest.fn().mockResolvedValue({
          rows: [
            {
              id: 'b1', title: 'T', description: 'D', category: 'bug', priority: 'high',
              status: 'open', source: 'user', notes: null, created_at: 100, updated_at: 200,
            },
            {
              id: 'b2', title: 'T2', description: 'D2', category: 'feature', priority: 'low',
              status: 'closed', source: 'admin', notes: 'has a note', created_at: 300, updated_at: 400,
            },
          ],
        }),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body.items).toHaveLength(2);
        expect(body.items[0].notes).toBeUndefined();
        expect(body.items[1].notes).toBe('has a note');
        expect(body.items[0].createdAt).toBe(100);
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items`);
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items`);
        expect(res.status).toBe(503);
      });
    });
  });

  describe('POST /backlog-items', () => {
    const validItem = { id: 'b1', title: 'T', category: 'bug', priority: 'high', status: 'open', source: 'user' };

    it('creates the backlog item and returns ok+id', async () => {
      await withServer({}, async ({ baseUrl, deps }) => {
        const res = await fetch(`${baseUrl}/backlog-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validItem),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 'b1' });
        expect(deps.db.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO admin_backlog_items'),
          expect.arrayContaining(['b1', 'T', '', 'bug', 'high', 'open', 'user']),
        );
      });
    });

    it('returns 400 when a required field is missing', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'b1', title: 'T', category: 'bug', priority: 'high', status: 'open' }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'id, title, category, priority, status, and source are required.' });
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validItem),
        });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validItem),
        });
        expect(res.status).toBe(503);
      });
    });

    it('falls back to an empty payload (400) when the request has no body', async () => {
      await withServer({}, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items`, { method: 'POST' });
        expect(res.status).toBe(400);
      });
    });
  });

  describe('PATCH /backlog-items/:id', () => {
    it('updates the backlog item when found', async () => {
      const currentRow = {
        id: 'b1', title: 'Old', description: 'OldD', category: 'bug', priority: 'high',
        status: 'open', source: 'user', notes: null, created_at: 100, updated_at: 200,
      };
      const db = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [currentRow] }) // SELECT current
          .mockResolvedValueOnce({ rows: [] }), // UPDATE
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/b1`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New title' }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.item.id).toBe('b1');
        expect(body.item.title).toBe('New title');
        expect(body.item.description).toBe('OldD');
      });
    });

    it('applies every provided field in the patch (not just the row fallback)', async () => {
      const currentRow = {
        id: 'b1', title: 'Old', description: 'OldD', category: 'bug', priority: 'high',
        status: 'open', source: 'user', notes: null, created_at: 100, updated_at: 200,
      };
      const db = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [currentRow] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/b1`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'New title', description: 'New desc', category: 'feature',
            priority: 'low', status: 'closed', source: 'admin', notes: 'a note',
          }),
        });
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body.item).toEqual(expect.objectContaining({
          title: 'New title', description: 'New desc', category: 'feature',
          priority: 'low', status: 'closed', source: 'admin', notes: 'a note',
        }));
      });
    });

    it('returns 404 when the backlog item does not exist', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await withServer({ db }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/missing`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Backlog item not found.' });
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/b1`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/b1`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('DELETE /backlog-items/:id', () => {
    it('deletes the backlog item', async () => {
      await withServer({}, async ({ baseUrl, deps }) => {
        const res = await fetch(`${baseUrl}/backlog-items/b1`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(deps.db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM admin_backlog_items'), ['b1']);
      });
    });

    it('returns 403 when requireAdmin denies', async () => {
      const requireAdmin = (req: any, res: any) => res.status(403).json({ error: 'forbidden' });
      await withServer({ requireAdmin }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/b1`, { method: 'DELETE' });
        expect(res.status).toBe(403);
      });
    });

    it('returns 503 when the app-state DB is unavailable', async () => {
      const requireAppStateDb = jest.fn(async (res) => {
        res.status(503).json({ error: 'unavailable' });
        return false;
      });
      await withServer({ requireAppStateDb }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/b1`, { method: 'DELETE' });
        expect(res.status).toBe(503);
      });
    });
  });

  describe('in-memory fallback when getDb() returns null', () => {
    // requireAppStateDb still reports "ok" (mirrors both the documented
    // fail-open behavior in proxy.js's real requireAppStateDb AND the
    // legitimate no-Postgres-configured case) -- appState.js's own helpers
    // guard every dbPool usage with `if (!dbPool)` and fall back to the
    // injected in-memory appStateStore, so this path is safe (unlike
    // promptGovernance.js -- see report).
    const getDb = () => null;

    // GET/PUT /integrations/:id still run through the real server-side
    // crypto module regardless of which storage backend is active (the
    // crypto call happens in the route handler, not inside dbGetIntegration/
    // dbSaveIntegration) -- so these fallback tests need a real key and a
    // real encrypted envelope too, same as the DB-backed describe blocks
    // above.
    const TEST_KEY = '11'.repeat(32);
    const originalKey = process.env.APP_INTEGRATION_ENCRYPTION_KEY;

    beforeEach(() => {
      process.env.APP_INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    });

    afterAll(() => {
      if (originalKey === undefined) delete process.env.APP_INTEGRATION_ENCRYPTION_KEY;
      else process.env.APP_INTEGRATION_ENCRYPTION_KEY = originalKey;
    });

    it('PUT /config/:key falls back to appStateStore.setAppConfigValue', async () => {
      const appStateStore = defaultAppStateStore();
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/some:key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'x' }),
        });
        expect(res.status).toBe(200);
        expect(appStateStore.setAppConfigValue).toHaveBeenCalledWith('some:key', 'x');
      });
    });

    it('PUT /config/:key with the token-optimization key refreshes the cache from the store fallback', async () => {
      const appStateStore = defaultAppStateStore();
      const setPromptOptimizationSkillCache = jest.fn();
      await withServer({ getDb, appStateStore, setPromptOptimizationSkillCache }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:tokenOptimizationSkill`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: { rules: {} } }),
        });
        expect(res.status).toBe(200);
        expect(setPromptOptimizationSkillCache).toHaveBeenCalled();
      });
    });

    it('PUT /config/:key refreshes the cache with the built-in default when value is null (fallback path)', async () => {
      const { DEFAULT_PROMPT_OPTIMIZATION_SKILL } = require('../promptOptimizationSkill');
      const appStateStore = defaultAppStateStore();
      const setPromptOptimizationSkillCache = jest.fn();
      await withServer({ getDb, appStateStore, setPromptOptimizationSkillCache }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config/app:tokenOptimizationSkill`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: null }),
        });
        expect(res.status).toBe(200);
        expect(setPromptOptimizationSkillCache).toHaveBeenCalledWith({ value: DEFAULT_PROMPT_OPTIMIZATION_SKILL, expiresAt: 0 });
      });
    });

    it('DELETE /config falls back to appStateStore.deleteAllAppConfig', async () => {
      const appStateStore = defaultAppStateStore();
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/config`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(appStateStore.deleteAllAppConfig).toHaveBeenCalled();
      });
    });

    it('GET /integrations falls back to appStateStore.listIntegrations', async () => {
      const appStateStore = defaultAppStateStore();
      appStateStore.listIntegrations.mockResolvedValue([{ id: 'i1', provider: 'p', label: 'l', encryptedData: 'e', iv: 'v', createdAt: 1 }]);
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations`);
        const body: any = await res.json();
        expect(res.status).toBe(200);
        expect(body.items).toHaveLength(1);
      });
    });

    it('GET /integrations/:id falls back to appStateStore.getIntegration (found)', async () => {
      const appStateStore = defaultAppStateStore();
      const { encryptedData, iv } = encryptIntegrationCredentials({
        id: 'i1',
        provider: 'p',
        credentials: { token: 'secret-token' },
        keyValue: TEST_KEY,
      });
      appStateStore.getIntegration.mockResolvedValue({ id: 'i1', provider: 'p', label: 'l', encryptedData, iv, createdAt: 1 });
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          id: 'i1',
          provider: 'p',
          label: 'l',
          credentials: { token: 'secret-token' },
          createdAt: 1,
        });
      });
    });

    it('GET /integrations/:id falls back to appStateStore.getIntegration (not found -> 404)', async () => {
      const appStateStore = defaultAppStateStore();
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/missing`);
        expect(res.status).toBe(404);
      });
    });

    it('PUT /integrations/:id falls back to appStateStore.saveIntegration', async () => {
      const appStateStore = defaultAppStateStore();
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'p', label: 'l', credentials: { token: 'secret-token' } }),
        });
        expect(res.status).toBe(200);
        expect(appStateStore.saveIntegration).toHaveBeenCalled();
        const [record] = appStateStore.saveIntegration.mock.calls[0];
        expect(record.iv).toBe('server:aes-256-gcm:v1');
        expect(record.encryptedData).not.toContain('secret-token');
      });
    });

    it('DELETE /integrations/:id falls back to appStateStore.deleteIntegration', async () => {
      const appStateStore = defaultAppStateStore();
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/integrations/i1`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(appStateStore.deleteIntegration).toHaveBeenCalledWith('i1');
      });
    });

    it('GET /backlog-items falls back to appStateStore.listBacklogItems', async () => {
      const appStateStore = defaultAppStateStore();
      appStateStore.listBacklogItems.mockResolvedValue([]);
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items`);
        expect(res.status).toBe(200);
        expect(appStateStore.listBacklogItems).toHaveBeenCalled();
      });
    });

    it('POST /backlog-items falls back to appStateStore.createBacklogItem', async () => {
      const appStateStore = defaultAppStateStore();
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'b1', title: 'T', category: 'bug', priority: 'high', status: 'open', source: 'user' }),
        });
        expect(res.status).toBe(200);
        expect(appStateStore.createBacklogItem).toHaveBeenCalled();
      });
    });

    it('PATCH /backlog-items/:id falls back to appStateStore.updateBacklogItem (found)', async () => {
      const appStateStore = defaultAppStateStore();
      appStateStore.updateBacklogItem.mockResolvedValue({ id: 'b1', title: 'Updated' });
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/b1`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Updated' }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, item: { id: 'b1', title: 'Updated' } });
      });
    });

    it('PATCH /backlog-items/:id falls back to appStateStore.updateBacklogItem (not found -> 404)', async () => {
      const appStateStore = defaultAppStateStore();
      appStateStore.updateBacklogItem.mockResolvedValue(null);
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/missing`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        });
        expect(res.status).toBe(404);
      });
    });

    it('DELETE /backlog-items/:id falls back to appStateStore.deleteBacklogItem', async () => {
      const appStateStore = defaultAppStateStore();
      await withServer({ getDb, appStateStore }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/backlog-items/b1`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(appStateStore.deleteBacklogItem).toHaveBeenCalledWith('b1');
      });
    });
  });
});
