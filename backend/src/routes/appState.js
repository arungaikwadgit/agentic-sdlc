// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Extracted from backend/src/proxy.js (2026-07-20, architecture upgrade
// Phase 3g -- see docs/architecture/architecture-upgrade-execution-plan.md).
// The App State group: generic key/value app config (GET/PUT/POST-batch/
// DELETE), encrypted third-party integration credentials (GET list/GET one/
// PUT/DELETE), and the admin backlog board (GET list/POST/PATCH/DELETE) --
// 13 routes total.
//
// Unlike Phase 3a-3f, this block was NOT contiguous in proxy.js: the 13
// route handlers lived at one location, while several of their private
// helper functions (normalizeConfigKey, dbSetAppConfigValue,
// dbDeleteAllAppConfig, dbListIntegrations, dbGetIntegration,
// dbSaveIntegration, dbDeleteIntegration, dbListBacklogItems,
// dbCreateBacklogItem, dbUpdateBacklogItem, dbDeleteBacklogItem) lived much
// further down the file, with the admin/reset-application-data and
// master-data route groups physically interleaved in between. One more
// helper (lifecycleTypeForConfigKey) lived near the very top of the file,
// next to the other lifecycle-event helpers. Reconciliation grep (same
// technique as every prior phase) confirmed every one of those helper names
// is used ONLY by this route group -- safe to move in full.
//
// requireAppStateDb and dbGetAppConfigMap were NOT moved -- reconciliation
// grep found requireAppStateDb used by 4 other route groups (prompt-
// governance, user-preferences) beyond this one, and dbGetAppConfigMap used
// directly by proxy.js's own loadPromptOptimizationSkill() (passed into
// agentDispatch.js in Phase 2). Both stay in proxy.js and are passed in as
// dependencies, same convention as Phase 3f.
//
// promptOptimizationSkillCache is a `let` in proxy.js that
// dbSetAppConfigValue/dbDeleteAllAppConfig reassign (not just mutate) when
// the app:tokenOptimizationSkill key changes, so it can't be passed by
// value or by object reference the way appStateStore can -- it needs a
// setter closure, same reasoning as the getDb getter pattern used
// everywhere else in this refactor.
//
// Extraction discipline (plan Section 0.1): every function body below is a
// byte-for-byte verbatim copy from proxy.js.

const {
  encryptIntegrationCredentials,
  decryptIntegrationCredentials,
  IntegrationCredentialCryptoError,
} = require('../integrationCredentialCrypto');

function createAppStateRouter({
  getDb,
  checkToken,
  requireAdmin,
  requireAppStateDb,
  dbGetAppConfigMap,
  fanOutRuntimeLifecycleEvent,
  appStateStore,
  tokenOptimizationSkillKey,
  setPromptOptimizationSkillCache,
}) {
  const { Router } = require('express');
  const { DEFAULT_PROMPT_OPTIMIZATION_SKILL } = require('../promptOptimizationSkill');
  const router = Router();

  function lifecycleTypeForConfigKey(key) {
    if (key === 'app:promptDefaults') return 'prompt_changed';
    if (key === 'app:agentProviderHints' || key === 'app:modelAssignments' || key === 'app:model') return 'model_changed';
    if (key === 'app:domainKnowledgeDefaults') return 'data_changed';
    return null;
  }

  function normalizeConfigKey(key) {
    return typeof key === 'string' ? key.trim() : '';
  }

  async function dbSetAppConfigValue(key, value) {
    const dbPool = getDb();
    if (!dbPool) {
      await appStateStore.setAppConfigValue(key, value);
      if (key === tokenOptimizationSkillKey) {
        setPromptOptimizationSkillCache({ value: value ?? DEFAULT_PROMPT_OPTIMIZATION_SKILL, expiresAt: 0 });
      }
      return;
    }
    await dbPool.query(`
      INSERT INTO app_config (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = NOW()
    `, [key, JSON.stringify(value)]);
    if (key === tokenOptimizationSkillKey) {
      setPromptOptimizationSkillCache({ value: value ?? DEFAULT_PROMPT_OPTIMIZATION_SKILL, expiresAt: 0 });
    }
  }

  async function dbDeleteAllAppConfig() {
    const dbPool = getDb();
    if (!dbPool) {
      await appStateStore.deleteAllAppConfig();
    } else {
      await dbPool.query(`DELETE FROM app_config`);
    }
    setPromptOptimizationSkillCache({ value: DEFAULT_PROMPT_OPTIMIZATION_SKILL, expiresAt: 0 });
  }

  async function dbListIntegrations() {
    const dbPool = getDb();
    if (!dbPool) return await appStateStore.listIntegrations();
    const { rows } = await dbPool.query(`
      SELECT id, provider, label, encrypted_data, iv, created_at
      FROM app_integrations
      ORDER BY created_at ASC
    `);
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      label: row.label,
      encryptedData: row.encrypted_data,
      iv: row.iv,
      createdAt: Number(row.created_at),
    }));
  }

  async function dbGetIntegration(id) {
    const dbPool = getDb();
    if (!dbPool) return await appStateStore.getIntegration(id);
    const { rows } = await dbPool.query(`
      SELECT id, provider, label, encrypted_data, iv, created_at
      FROM app_integrations
      WHERE id = $1
      LIMIT 1
    `, [id]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider,
      label: row.label,
      encryptedData: row.encrypted_data,
      iv: row.iv,
      createdAt: Number(row.created_at),
    };
  }

  async function dbSaveIntegration(record) {
    const dbPool = getDb();
    if (!dbPool) {
      await appStateStore.saveIntegration(record);
      return;
    }
    await dbPool.query(`
      INSERT INTO app_integrations (id, provider, label, encrypted_data, iv, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE
        SET provider = EXCLUDED.provider,
            label = EXCLUDED.label,
            encrypted_data = EXCLUDED.encrypted_data,
            iv = EXCLUDED.iv,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
    `, [
      record.id,
      record.provider,
      record.label,
      record.encryptedData,
      record.iv,
      Number(record.createdAt ?? Date.now()),
      Date.now(),
    ]);
  }

  async function dbDeleteIntegration(id) {
    const dbPool = getDb();
    if (!dbPool) {
      await appStateStore.deleteIntegration(id);
      return;
    }
    await dbPool.query(`DELETE FROM app_integrations WHERE id = $1`, [id]);
  }

  async function dbListBacklogItems() {
    const dbPool = getDb();
    if (!dbPool) return await appStateStore.listBacklogItems();
    const { rows } = await dbPool.query(`
      SELECT id, title, description, category, priority, status, source, notes, project_id, created_at, updated_at
      FROM admin_backlog_items
      ORDER BY created_at ASC
    `);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      priority: row.priority,
      status: row.status,
      source: row.source,
      notes: row.notes ?? undefined,
      // AI Governance MVP-0 (2026-07-21) -- only present on governance-
      // sourced items (see migration 014_governance_backlog_project_scope.sql
      // and backend/src/routes/governance.js); every pre-existing/manually-
      // added row has project_id NULL, mapped to undefined here to match
      // BacklogItem.projectId's optional typing.
      projectId: row.project_id ?? undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  async function dbCreateBacklogItem(item) {
    const dbPool = getDb();
    if (!dbPool) {
      await appStateStore.createBacklogItem(item);
      return;
    }
    await dbPool.query(`
      INSERT INTO admin_backlog_items (
        id, title, description, category, priority, status, source, notes, project_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11)
    `, [
      item.id,
      item.title,
      item.description ?? '',
      item.category,
      item.priority,
      item.status,
      item.source,
      item.notes ?? null,
      item.projectId ?? null,
      Number(item.createdAt ?? Date.now()),
      Number(item.updatedAt ?? Date.now()),
    ]);
  }

  async function dbUpdateBacklogItem(id, patch) {
    const dbPool = getDb();
    if (!dbPool) return await appStateStore.updateBacklogItem(id, patch);
    const current = await dbPool.query(`
      SELECT id, title, description, category, priority, status, source, notes, project_id, created_at, updated_at
      FROM admin_backlog_items
      WHERE id = $1
      LIMIT 1
    `, [id]);
    if (!current.rows[0]) return null;
    const row = current.rows[0];
    const next = {
      title: patch.title ?? row.title,
      description: patch.description ?? row.description,
      category: patch.category ?? row.category,
      priority: patch.priority ?? row.priority,
      status: patch.status ?? row.status,
      source: patch.source ?? row.source,
      notes: patch.notes === undefined ? row.notes : patch.notes,
      // project_id is intentionally NOT patchable through this endpoint
      // (the admin Edit Item form has no field for it) -- reported back
      // unchanged from whatever the row already had.
      projectId: row.project_id ?? undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(patch.updatedAt ?? Date.now()),
    };
    await dbPool.query(`
      UPDATE admin_backlog_items
      SET title = $2,
          description = $3,
          category = $4,
          priority = $5,
          status = $6,
          source = $7,
          notes = $8,
          updated_at = $9
      WHERE id = $1
    `, [
      id,
      next.title,
      next.description,
      next.category,
      next.priority,
      next.status,
      next.source,
      next.notes ?? null,
      next.updatedAt,
    ]);
    return { id, ...next };
  }

  async function dbDeleteBacklogItem(id) {
    const dbPool = getDb();
    if (!dbPool) {
      await appStateStore.deleteBacklogItem(id);
      return;
    }
    await dbPool.query(`DELETE FROM admin_backlog_items WHERE id = $1`, [id]);
  }

  // NOTE: reads are intentionally admin-agnostic (checkToken only, no requireAdmin).
  // App-level config here includes values meant to be read by any authenticated user
  // during normal flows (e.g. app:domainKnowledgeDefaults, read by every user in
  // NewProjectModal when creating a project) — only *writing* config is an admin
  // action (see PUT/POST /batch/DELETE below, which still require requireAdmin).
  router.get('/config', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    const keys = typeof req.query.keys === 'string'
      ? req.query.keys.split(',').map((key) => normalizeConfigKey(key)).filter(Boolean)
      : null;
    const values = await dbGetAppConfigMap(keys);
    return res.json({ values });
  });

  router.get('/config/:key', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    const key = normalizeConfigKey(req.params.key);
    if (!key) return res.status(400).json({ error: 'key is required' });
    const values = await dbGetAppConfigMap([key]);
    return res.json({ key, value: values[key] ?? null });
  });

  router.put('/config/:key', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    const key = normalizeConfigKey(req.params.key);
    if (!key) return res.status(400).json({ error: 'key is required' });
    await dbSetAppConfigValue(key, req.body?.value ?? null);
    const lifecycleType = lifecycleTypeForConfigKey(key);
    if (lifecycleType) {
      void fanOutRuntimeLifecycleEvent(lifecycleType, key)
        .catch((error) => console.error('[lifecycle-events] config trigger failed:', error.message));
    }
    return res.json({ ok: true });
  });

  router.post('/config/batch', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    const values = req.body?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return res.status(400).json({ error: 'values must be an object' });
    }
    const lifecycleChanges = new Set();
    for (const [key, value] of Object.entries(values)) {
      const normalizedKey = normalizeConfigKey(key);
      if (!normalizedKey) continue;
      await dbSetAppConfigValue(normalizedKey, value);
      const lifecycleType = lifecycleTypeForConfigKey(normalizedKey);
      if (lifecycleType) lifecycleChanges.add(lifecycleType + ':' + normalizedKey);
    }
    for (const change of lifecycleChanges) {
      const [eventType, sourceKey] = change.split(':', 2);
      void fanOutRuntimeLifecycleEvent(eventType, sourceKey)
        .catch((error) => console.error('[lifecycle-events] batch config trigger failed:', error.message));
    }
    return res.json({ ok: true });
  });

  router.delete('/config', checkToken, requireAdmin, async (_req, res) => {
    if (!await requireAppStateDb(res)) return;
    await dbDeleteAllAppConfig();
    return res.json({ ok: true });
  });

  router.get('/integrations', checkToken, requireAdmin, async (_req, res) => {
    if (!await requireAppStateDb(res)) return;
    const items = await dbListIntegrations();
    return res.json({ items });
  });

  // Server-side encryption (integrationCredentialCrypto.js) as of this pass --
  // previously this module only stored/returned whatever ciphertext the
  // browser had already produced with a device-local, localStorage-held
  // passphrase (see git history: frontend/src/utils/crypto.ts +
  // frontend/src/hooks/useIntegrations.ts). That meant credentials became
  // permanently undecryptable if a user cleared localStorage or switched
  // devices, and the encryption key never lived anywhere centrally
  // rotatable/auditable. integrationCredentialCrypto.js already existed,
  // fully built and tested, but nothing ever called it -- this wires it in.
  // Existing rows saved under the old client-side scheme fail decryption
  // here with IntegrationCredentialCryptoError('LEGACY_RECORD', ...) (see
  // that module's STORAGE_MARKER check) -- treated the same as "not found"
  // below so the existing frontend "reconnect this integration" flow just
  // handles it, no separate migration UI needed.
  router.get('/integrations/:id', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    const item = await dbGetIntegration(req.params.id);
    if (!item) return res.status(404).json({ error: 'Integration not found.' });
    try {
      const credentials = decryptIntegrationCredentials({
        id: item.id,
        provider: item.provider,
        encryptedData: item.encryptedData,
        iv: item.iv,
        keyValue: process.env.APP_INTEGRATION_ENCRYPTION_KEY,
      });
      return res.json({
        id: item.id,
        provider: item.provider,
        label: item.label,
        credentials,
        createdAt: item.createdAt,
      });
    } catch (error) {
      if (error instanceof IntegrationCredentialCryptoError && error.code === 'LEGACY_RECORD') {
        return res.status(404).json({ error: 'Integration not found.', code: 'LEGACY_RECORD' });
      }
      if (error instanceof IntegrationCredentialCryptoError) {
        return res.status(500).json({ error: error.message, code: error.code });
      }
      throw error;
    }
  });

  router.put('/integrations/:id', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    const payload = req.body ?? {};
    if (!payload.provider || !payload.label || !payload.credentials) {
      return res.status(400).json({ error: 'provider, label, and credentials are required.' });
    }
    let encryptedData, iv;
    try {
      ({ encryptedData, iv } = encryptIntegrationCredentials({
        id: req.params.id,
        provider: payload.provider,
        credentials: payload.credentials,
        keyValue: process.env.APP_INTEGRATION_ENCRYPTION_KEY,
      }));
    } catch (error) {
      if (error instanceof IntegrationCredentialCryptoError) {
        return res.status(500).json({ error: error.message, code: error.code });
      }
      throw error;
    }
    const record = {
      id: req.params.id,
      provider: payload.provider,
      label: payload.label,
      encryptedData,
      iv,
      createdAt: payload.createdAt ?? Date.now(),
    };
    await dbSaveIntegration(record);
    return res.json({ ok: true, id: record.id });
  });

  router.delete('/integrations/:id', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    await dbDeleteIntegration(req.params.id);
    return res.json({ ok: true });
  });

  router.get('/backlog-items', checkToken, requireAdmin, async (_req, res) => {
    if (!await requireAppStateDb(res)) return;
    const items = await dbListBacklogItems();
    return res.json({ items });
  });

  router.post('/backlog-items', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    const item = req.body ?? {};
    if (!item.id || !item.title || !item.category || !item.priority || !item.status || !item.source) {
      return res.status(400).json({ error: 'id, title, category, priority, status, and source are required.' });
    }
    await dbCreateBacklogItem(item);
    return res.json({ ok: true, id: item.id });
  });

  router.patch('/backlog-items/:id', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    const item = await dbUpdateBacklogItem(req.params.id, req.body ?? {});
    if (!item) return res.status(404).json({ error: 'Backlog item not found.' });
    return res.json({ ok: true, item });
  });

  router.delete('/backlog-items/:id', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    await dbDeleteBacklogItem(req.params.id);
    return res.json({ ok: true });
  });

  return router;
}

module.exports = { createAppStateRouter };
