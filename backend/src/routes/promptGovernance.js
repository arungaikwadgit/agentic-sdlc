// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Extracted from backend/src/proxy.js (2026-07-19, architecture upgrade
// Phase 3 — see docs/architecture/architecture-upgrade-execution-plan.md).
// The Prompt Governance group: the versioned prompt approval/activation
// workflow (draft -> submit -> approve -> activate, plus reject/
// changes-requested/rollback, plus a global-prompt seed endpoint and an
// audit-log read) and every private helper only these routes use
// (promptChecksum, promptActor, authorizePromptOwnerAction, dbAuditPrompt,
// nextPromptVersion, getActivePromptVersion, insertPromptVersion,
// activatePromptVersion, reviewPromptVersion). This was a genuinely
// contiguous block in proxy.js (verified via grep -- every one of these
// helper names' occurrences fell inside the block being moved, none
// outside it), unlike Phase 1b/2/3's earlier groups.
//
// Dependency notes:
//   - assertPromptTransition/canActivatePrompt/canRollbackPrompt come from
//     the already-separate backend/src/promptGovernancePolicy.js module,
//     required directly here rather than threaded through as params.
//   - dbPool is passed as a getter (() => dbPool), matching the
//     established convention (see inviteRoutes.js/agentDispatch.js),
//     since it can be reassigned to null asynchronously after startup.
//   - requireAppStateDb, dbGetAppConfigMap, isConfiguredAdminEmail,
//     getCallerAppRoleForProject are proxy.js's own shared helpers, used
//     by many other route groups too -- passed in as functions, not moved.
//   - enqueueRuntimeLifecycleEvent/fanOutRuntimeLifecycleEvent (used only
//     by activatePromptVersion, to notify the durable runtime a prompt
//     changed) are the SAME shared top-of-file proxy.js helpers Phase 3a's
//     doc comment already explains are used by multiple unrelated routes
//     -- passed in as functions here too, not moved (still not moved,
//     still shared).
//
// Extraction discipline (plan Section 0.1): every function body below is a
// byte-for-byte verbatim copy from proxy.js.

function createPromptGovernanceRouter({
  getDb,
  checkToken,
  requireAdmin,
  requireAppStateDb,
  dbGetAppConfigMap,
  isConfiguredAdminEmail,
  getCallerAppRoleForProject,
  enqueueRuntimeLifecycleEvent,
  fanOutRuntimeLifecycleEvent,
}) {
  const { Router } = require('express');
  const { randomUUID, createHash } = require('crypto');
  const { assertPromptTransition, canActivatePrompt, canRollbackPrompt } = require('../promptGovernancePolicy');
  const router = Router();

  function promptChecksum(content) {
    return createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex');
  }

  function promptActor(req) {
    return req.authUser?.email ?? (req.authUser?.adminBypass ? 'admin-bypass' : null);
  }

  // Bug fix (2026-07-20): requireAppStateDb() fails OPEN when dbPool is null
  // -- that's correct for appState.js/userPreferenceRoutes.js, which both
  // have a real in-memory fallback (appStateStore) or their own explicit
  // 503 check for the no-DB case. Prompt governance has neither -- every
  // helper below (nextPromptVersion/getActivePromptVersion/
  // insertPromptVersion/activatePromptVersion) calls getDb() and immediately
  // does dbPool.query(...) with no null guard, so a null dbPool previously
  // reached this file as an uncaught `TypeError: Cannot read properties of
  // null (reading 'query')` deep inside those helpers instead of a clean
  // error response. This is a local, additional guard -- requireAppStateDb
  // itself is untouched (it still does real, necessary work: ensuring the
  // prompt-governance tables exist via ensurePromptGovernanceTables() when a
  // DB *is* configured) -- this just closes the gap for when one isn't.
  function requirePromptGovernanceDb(res) {
    const dbPool = getDb();
    if (!dbPool) {
      res.status(503).json({
        error: 'Prompt governance requires a configured database connection (POSTGRES_URL). ' +
          'This deployment does not have one configured, so this action is unavailable.',
      });
      return null;
    }
    return dbPool;
  }

  async function authorizePromptOwnerAction(req, res, { projectId }) {
    if (req.authUser?.adminBypass && process.env.NODE_ENV !== 'production') {
      return { ok: true, callerEmail: null, callerRole: 'admin' };
    }
    const callerEmail = req.authUser?.email ?? null;
    if (!callerEmail) {
      res.status(401).json({ error: 'Please sign in to manage project prompt overrides.' });
      return { ok: false };
    }
    if (isConfiguredAdminEmail(callerEmail)) {
      return { ok: true, callerEmail, callerRole: 'admin' };
    }
    const callerAppRole = await getCallerAppRoleForProject(projectId, callerEmail);
    if (callerAppRole !== 'project_owner') {
      res.status(403).json({ error: 'Only the Project Owner or an app admin can approve project prompt overrides.' });
      return { ok: false };
    }
    return { ok: true, callerEmail, callerRole: 'project_owner' };
  }

  async function dbAuditPrompt({ promptVersionId, projectId, agentId, action, req, metadata = {} }) {
    const dbPool = getDb();
    if (!dbPool) return;
    await dbPool.query(`
      INSERT INTO agent_prompt_audit_log (id, prompt_version_id, project_id, agent_id, action, actor_email, actor_user_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `, [
      randomUUID(),
      promptVersionId ?? null,
      projectId ?? null,
      agentId,
      action,
      promptActor(req),
      req.authUser?.user?.id ?? null,
      JSON.stringify(metadata),
    ]);
  }

  async function nextPromptVersion({ scope, agentId, projectId = null }) {
    const dbPool = getDb();
    const { rows } = await dbPool.query(`
      SELECT COALESCE(MAX(version), 0) + 1 AS next_version
      FROM agent_prompt_versions
      WHERE scope = $1 AND agent_id = $2 AND (($3::uuid IS NULL AND project_id IS NULL) OR project_id = $3::uuid)
    `, [scope, agentId, projectId]);
    return Number(rows[0]?.next_version ?? 1);
  }

  async function getActivePromptVersion({ scope, agentId, projectId = null }) {
    const dbPool = getDb();
    const { rows } = await dbPool.query(`
      SELECT *
      FROM agent_prompt_versions
      WHERE scope = $1
        AND agent_id = $2
        AND active = TRUE
        AND (($3::uuid IS NULL AND project_id IS NULL) OR project_id = $3::uuid)
      ORDER BY version DESC
      LIMIT 1
    `, [scope, agentId, projectId]);
    return rows[0] ?? null;
  }

  async function insertPromptVersion({
    scope,
    agentId,
    agentName,
    projectId = null,
    content,
    resolvedEffectivePrompt = null,
    status,
    active,
    req,
    metadata = {},
    approvalComments = null,
    changeSummary = null,
    changeReason = null,
    businessReason = null,
    technicalReason = null,
    riskAssessment = null,
    impactAssessment = null,
    parentGlobalPromptId = null,
  }) {
    const dbPool = getDb();
    const version = await nextPromptVersion({ scope, agentId, projectId });
    const previous = await dbPool.query(`
      SELECT id FROM agent_prompt_versions
      WHERE scope = $1 AND agent_id = $2 AND (($3::uuid IS NULL AND project_id IS NULL) OR project_id = $3::uuid)
      ORDER BY version DESC
      LIMIT 1
    `, [scope, agentId, projectId]);
    const actor = promptActor(req);
    const id = randomUUID();
    const nowStatusTs = status === 'activated' ? 'NOW()' : 'NULL';
    const approvalStatus = status;
    await dbPool.query(`
      INSERT INTO agent_prompt_versions (
        id, scope, agent_id, agent_name, project_id, parent_global_prompt_id, version,
        content, resolved_effective_prompt, content_checksum, status, active, approval_status,
        project_owner_email, approval_comments, submitted_by, submitted_at,
        approved_by, approved_at, activated_by, activated_at,
        created_by, updated_by, change_summary, change_reason, business_reason,
        technical_reason, risk_assessment, impact_assessment, previous_version_id,
        immutable_history, metadata
      )
      VALUES (
        $1, $2, $3, $4, $5::uuid, $6::uuid, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, CASE WHEN $11 IN ('submitted', 'approved', 'activated') THEN NOW() ELSE NULL END,
        CASE WHEN $11 IN ('approved', 'activated') THEN $16 ELSE NULL END,
        CASE WHEN $11 IN ('approved', 'activated') THEN NOW() ELSE NULL END,
        CASE WHEN $11 = 'activated' THEN $16 ELSE NULL END,
        ${nowStatusTs},
        $16, $16, $17, $18, $19,
        $20, $21, $22, $23::uuid,
        $24::jsonb, $25::jsonb
      )
    `, [
      id,
      scope,
      agentId,
      agentName || agentId,
      projectId,
      parentGlobalPromptId,
      version,
      content,
      resolvedEffectivePrompt,
      promptChecksum(content),
      status,
      !!active,
      approvalStatus,
      scope === 'project' ? actor : null,
      approvalComments,
      actor,
      changeSummary,
      changeReason,
      businessReason,
      technicalReason,
      riskAssessment,
      impactAssessment,
      previous.rows[0]?.id ?? null,
      JSON.stringify({ createdBy: actor, createdAt: new Date().toISOString(), status }),
      JSON.stringify(metadata),
    ]);
    await dbAuditPrompt({ promptVersionId: id, projectId, agentId, action: 'created:' + status, req, metadata: { scope, version } });
    return { id, version };
  }

  async function activatePromptVersion({ versionId, projectId, agentId, scope, req, approvalComments = null }) {
    const dbPool = getDb();
    const activeArgs = scope === 'project' ? [projectId, agentId] : [agentId];
    if (scope === 'project') {
      await dbPool.query(`
        UPDATE agent_prompt_versions
        SET active = FALSE, status = 'superseded', approval_status = 'superseded', updated_at = NOW()
        WHERE scope = 'project' AND project_id = $1 AND agent_id = $2 AND active = TRUE AND id <> $3
      `, [...activeArgs, versionId]);
    } else {
      await dbPool.query(`
        UPDATE agent_prompt_versions
        SET active = FALSE, status = 'superseded', approval_status = 'superseded', updated_at = NOW()
        WHERE scope = 'global' AND agent_id = $1 AND active = TRUE AND id <> $2
      `, [...activeArgs, versionId]);
    }
    const { rows } = await dbPool.query(`
      UPDATE agent_prompt_versions
      SET status = 'activated',
          approval_status = 'activated',
          active = TRUE,
          approval_comments = COALESCE($2, approval_comments),
          approved_by = COALESCE(approved_by, $3),
          approved_at = COALESCE(approved_at, NOW()),
          activated_by = $3,
          activated_at = NOW(),
          updated_by = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [versionId, approvalComments, promptActor(req)]);
    if (!rows[0]) return null;
    await dbAuditPrompt({ promptVersionId: versionId, projectId: rows[0].project_id, agentId: rows[0].agent_id, action: 'activated', req });
    const promptEvent = {
      event_type: 'prompt_changed',
      agent_key: rows[0].agent_id,
      idempotency_key: 'prompt-changed:' + versionId,
    };
    if (rows[0].project_id) {
      void enqueueRuntimeLifecycleEvent({ ...promptEvent, project_id: rows[0].project_id })
        .catch((error) => console.error('[lifecycle-events] prompt trigger failed:', error.message));
    } else {
      void fanOutRuntimeLifecycleEvent('prompt_changed', versionId, rows[0].agent_id)
        .catch((error) => console.error('[lifecycle-events] global prompt trigger failed:', error.message));
    }
    return rows[0];
  }

  router.get('/effective', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const agentId = String(req.query.agentId ?? '').trim();
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    if (!agentId) return res.status(400).json({ error: 'agentId is required.' });

    const projectPrompt = projectId
      ? await getActivePromptVersion({ scope: 'project', agentId, projectId })
      : null;
    if (projectPrompt) {
      return res.json({ prompt: projectPrompt.resolved_effective_prompt || projectPrompt.content, source: 'project', version: projectPrompt.version, record: projectPrompt });
    }
    const globalPrompt = await getActivePromptVersion({ scope: 'global', agentId });
    if (globalPrompt) {
      return res.json({ prompt: globalPrompt.content, source: 'global', version: globalPrompt.version, record: globalPrompt });
    }
    const defaults = await dbGetAppConfigMap(['app:promptDefaults']);
    const legacyPrompt = defaults['app:promptDefaults']?.[agentId] ?? null;
    return res.json({ prompt: legacyPrompt, source: legacyPrompt ? 'legacy-app-state' : 'fallback', version: null, record: null });
  });

  router.get('/versions', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const agentId = String(req.query.agentId ?? '').trim();
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    if (!agentId) return res.status(400).json({ error: 'agentId is required.' });
    const dbPool = getDb();
    const { rows } = await dbPool.query(`
      SELECT *
      FROM agent_prompt_versions
      WHERE agent_id = $1 AND ($2::uuid IS NULL OR project_id = $2::uuid)
      ORDER BY scope, version DESC
    `, [agentId, projectId]);
    return res.json({ items: rows });
  });

  router.post('/global/:agentId', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const agentId = String(req.params.agentId ?? '').trim();
    const content = String(req.body?.content ?? '').trim();
    if (!agentId || !content) return res.status(400).json({ error: 'agentId and content are required.' });
    const { id, version } = await insertPromptVersion({
      scope: 'global',
      agentId,
      agentName: req.body?.agentName,
      content,
      status: 'activated',
      active: false,
      req,
      metadata: req.body?.metadata ?? {},
      changeSummary: req.body?.changeSummary,
      changeReason: req.body?.changeReason,
      businessReason: req.body?.businessReason,
      technicalReason: req.body?.technicalReason,
      riskAssessment: req.body?.riskAssessment,
      impactAssessment: req.body?.impactAssessment,
    });
    await activatePromptVersion({ versionId: id, scope: 'global', agentId, req });
    return res.json({ ok: true, id, version, status: 'activated' });
  });

  router.post('/project/:projectId/:agentId/draft', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const { projectId, agentId } = req.params;
    const auth = await authorizePromptOwnerAction(req, res, { projectId });
    if (!auth.ok) return;
    const content = String(req.body?.content ?? '').trim();
    if (!content) return res.status(400).json({ error: 'content is required.' });
    const globalPrompt = await getActivePromptVersion({ scope: 'global', agentId });
    const { id, version } = await insertPromptVersion({
      scope: 'project',
      agentId,
      agentName: req.body?.agentName,
      projectId,
      parentGlobalPromptId: globalPrompt?.id ?? null,
      content,
      resolvedEffectivePrompt: content,
      status: 'draft',
      active: false,
      req,
      metadata: req.body?.metadata ?? {},
      changeSummary: req.body?.changeSummary,
      changeReason: req.body?.changeReason,
      businessReason: req.body?.businessReason,
      technicalReason: req.body?.technicalReason,
      riskAssessment: req.body?.riskAssessment,
      impactAssessment: req.body?.impactAssessment,
    });
    return res.json({ ok: true, id, version, status: 'draft' });
  });

  router.post('/project/:projectId/:agentId/activate', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const { projectId, agentId } = req.params;
    const auth = await authorizePromptOwnerAction(req, res, { projectId });
    if (!auth.ok) return;
    const content = String(req.body?.content ?? '').trim();
    if (!content) return res.status(400).json({ error: 'content is required.' });
    const globalPrompt = await getActivePromptVersion({ scope: 'global', agentId });
    const { id, version } = await insertPromptVersion({
      scope: 'project',
      agentId,
      agentName: req.body?.agentName,
      projectId,
      parentGlobalPromptId: globalPrompt?.id ?? null,
      content,
      resolvedEffectivePrompt: content,
      status: 'approved',
      active: false,
      req,
      metadata: req.body?.metadata ?? {},
      approvalComments: req.body?.approvalComments ?? 'Approved through Save for this project.',
      changeSummary: req.body?.changeSummary,
      changeReason: req.body?.changeReason,
      businessReason: req.body?.businessReason,
      technicalReason: req.body?.technicalReason,
      riskAssessment: req.body?.riskAssessment,
      impactAssessment: req.body?.impactAssessment,
    });
    await activatePromptVersion({ versionId: id, projectId, agentId, scope: 'project', req, approvalComments: req.body?.approvalComments });
    return res.json({ ok: true, id, version, status: 'activated' });
  });

  router.post('/project/:projectId/:agentId/:versionId/submit', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const { projectId, agentId, versionId } = req.params;
    const auth = await authorizePromptOwnerAction(req, res, { projectId });
    if (!auth.ok) return;
    const dbPool = getDb();
    const before = await dbPool.query('SELECT status FROM agent_prompt_versions WHERE id = $1 AND project_id = $2 AND agent_id = $3', [versionId, projectId, agentId]);
    if (!before.rows[0]) return res.status(404).json({ error: 'Prompt version not found.' });
    try { assertPromptTransition(before.rows[0].status, 'submitted'); }
    catch (error) { return res.status(409).json({ error: error.message }); }
    const { rows } = await dbPool.query(`
      UPDATE agent_prompt_versions
      SET status = 'submitted', approval_status = 'submitted', submitted_by = $2, submitted_at = NOW(), updated_by = $2, updated_at = NOW()
      WHERE id = $1 AND project_id = $3 AND agent_id = $4
      RETURNING *
    `, [versionId, promptActor(req), projectId, agentId]);
    if (!rows[0]) return res.status(404).json({ error: 'Prompt version not found.' });
    await dbAuditPrompt({ promptVersionId: versionId, projectId, agentId, action: 'submitted', req });
    return res.json({ ok: true, item: rows[0] });
  });

  router.post('/project/:projectId/:agentId/:versionId/approve', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const { projectId, agentId, versionId } = req.params;
    const auth = await authorizePromptOwnerAction(req, res, { projectId });
    if (!auth.ok) return;
    const dbPool = getDb();
    const before = await dbPool.query('SELECT status FROM agent_prompt_versions WHERE id = $1 AND project_id = $2 AND agent_id = $3', [versionId, projectId, agentId]);
    if (!before.rows[0]) return res.status(404).json({ error: 'Prompt version not found.' });
    try { assertPromptTransition(before.rows[0].status, 'approved'); }
    catch (error) { return res.status(409).json({ error: error.message }); }
    const { rows } = await dbPool.query(`
      UPDATE agent_prompt_versions
      SET status = 'approved',
          approval_status = 'approved',
          approval_comments = $2,
          approved_by = $3,
          approved_at = NOW(),
          updated_by = $3,
          updated_at = NOW()
      WHERE id = $1 AND project_id = $4 AND agent_id = $5
      RETURNING *
    `, [versionId, req.body?.approvalComments ?? null, promptActor(req), projectId, agentId]);
    if (!rows[0]) return res.status(404).json({ error: 'Prompt version not found.' });
    await dbAuditPrompt({ promptVersionId: versionId, projectId, agentId, action: 'approved', req });
    return res.json({ ok: true, item: rows[0] });
  });

  router.post('/project/:projectId/:agentId/:versionId/activate', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const { projectId, agentId, versionId } = req.params;
    const auth = await authorizePromptOwnerAction(req, res, { projectId });
    if (!auth.ok) return;
    const dbPool = getDb();
    const current = await dbPool.query(`
      SELECT * FROM agent_prompt_versions
      WHERE id = $1 AND project_id = $2 AND agent_id = $3
    `, [versionId, projectId, agentId]);
    if (!current.rows[0]) return res.status(404).json({ error: 'Prompt version not found.' });
    if (!canActivatePrompt(current.rows[0].status)) {
      return res.status(409).json({ error: 'Prompt version must be approved before activation.' });
    }
    const item = await activatePromptVersion({ versionId, projectId, agentId, scope: 'project', req, approvalComments: req.body?.approvalComments });
    return res.json({ ok: true, item });
  });

  async function reviewPromptVersion(req, res, nextStatus, actorColumn, timestampColumn) {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const { projectId, agentId, versionId } = req.params;
    const auth = await authorizePromptOwnerAction(req, res, { projectId });
    if (!auth.ok) return;
    const dbPool = getDb();
    const current = await dbPool.query(
      'SELECT * FROM agent_prompt_versions WHERE id = $1 AND project_id = $2 AND agent_id = $3',
      [versionId, projectId, agentId],
    );
    if (!current.rows[0]) return res.status(404).json({ error: 'Prompt version not found.' });
    try { assertPromptTransition(current.rows[0].status, nextStatus); }
    catch (error) { return res.status(409).json({ error: error.message }); }
    const actor = promptActor(req);
    const { rows } = await dbPool.query(`
      UPDATE agent_prompt_versions
      SET status = $2,
          approval_status = $2,
          approval_comments = $3,
          ${actorColumn} = $4,
          ${timestampColumn} = NOW(),
          updated_by = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [versionId, nextStatus, req.body?.approvalComments ?? null, actor]);
    await dbAuditPrompt({ promptVersionId: versionId, projectId, agentId, action: nextStatus, req, metadata: { comments: req.body?.approvalComments ?? null } });
    return res.json({ ok: true, item: rows[0] });
  }

  router.post('/project/:projectId/:agentId/:versionId/reject', checkToken, async (req, res) => {
    return reviewPromptVersion(req, res, 'rejected', 'rejected_by', 'rejected_at');
  });

  router.post('/project/:projectId/:agentId/:versionId/changes-requested', checkToken, async (req, res) => {
    return reviewPromptVersion(req, res, 'changes_requested', 'rejected_by', 'rejected_at');
  });

  router.post('/project/:projectId/:agentId/:versionId/rollback', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const { projectId, agentId, versionId } = req.params;
    const auth = await authorizePromptOwnerAction(req, res, { projectId });
    if (!auth.ok) return;
    const dbPool = getDb();
    const targetResult = await dbPool.query(
      'SELECT * FROM agent_prompt_versions WHERE id = $1 AND project_id = $2 AND agent_id = $3',
      [versionId, projectId, agentId],
    );
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'Prompt version not found.' });
    if (!canRollbackPrompt(target)) {
      return res.status(409).json({ error: 'Only a previously activated, inactive prompt version can be rolled back.' });
    }
    const globalPrompt = await getActivePromptVersion({ scope: 'global', agentId });
    const created = await insertPromptVersion({
      scope: 'project', agentId, agentName: target.agent_name, projectId,
      parentGlobalPromptId: globalPrompt?.id ?? null,
      content: target.content,
      resolvedEffectivePrompt: target.resolved_effective_prompt || target.content,
      status: 'approved', active: false, req,
      approvalComments: req.body?.reason ?? 'Rollback approved by Project Owner.',
      changeSummary: 'Rollback to project prompt version ' + target.version,
      changeReason: req.body?.reason ?? 'Restore a previously activated prompt.',
      metadata: { rollbackFromVersionId: versionId, rollbackFromVersion: target.version },
    });
    await dbPool.query('UPDATE agent_prompt_versions SET rollback_reference_id = $2 WHERE id = $1', [created.id, versionId]);
    const item = await activatePromptVersion({ versionId: created.id, projectId, agentId, scope: 'project', req, approvalComments: req.body?.reason });
    await dbAuditPrompt({ promptVersionId: created.id, projectId, agentId, action: 'rollback_created', req, metadata: { rollbackReferenceId: versionId } });
    return res.json({ ok: true, item });
  });

  router.post('/seed/global', checkToken, requireAdmin, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const prompts = Array.isArray(req.body?.prompts) ? req.body.prompts : [];
    if (prompts.length === 0 || prompts.length > 100) {
      return res.status(400).json({ error: 'prompts must contain between 1 and 100 entries.' });
    }
    let created = 0;
    let skipped = 0;
    for (const prompt of prompts) {
      const agentId = String(prompt?.agentId ?? '').trim();
      const agentName = String(prompt?.agentName ?? agentId).trim();
      const promptContent = String(prompt?.content ?? '').trim();
      if (!agentId || !promptContent) return res.status(400).json({ error: 'Every seed entry requires agentId and content.' });
      const existing = await getActivePromptVersion({ scope: 'global', agentId });
      if (existing) { skipped++; continue; }
      const version = await insertPromptVersion({
        scope: 'global', agentId, agentName, content: promptContent,
        status: 'approved', active: false, req,
        changeSummary: 'Seeded built-in global prompt default.',
        changeReason: 'Initialize versioned prompt governance.',
        metadata: { source: 'built-in-seed' },
      });
      await activatePromptVersion({ versionId: version.id, scope: 'global', agentId, req });
      created++;
    }
    return res.json({ ok: true, created, skipped });
  });

  router.get('/audit', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    if (!requirePromptGovernanceDb(res)) return;
    const agentId = String(req.query.agentId ?? '').trim();
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    if (!agentId) return res.status(400).json({ error: 'agentId is required.' });
    const dbPool = getDb();
    const { rows } = await dbPool.query(`
      SELECT * FROM agent_prompt_audit_log
      WHERE agent_id = $1 AND ($2::uuid IS NULL OR project_id = $2::uuid)
      ORDER BY created_at DESC
      LIMIT 200
    `, [agentId, projectId]);
    return res.json({ items: rows });
  });

  return router;
}

module.exports = { createPromptGovernanceRouter };
