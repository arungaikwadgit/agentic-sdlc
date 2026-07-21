// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// AI Governance MVP-0 (2026-07-21) -- see
// docs/architecture/govern-ai-gap-assessment-and-implementation-plan.md.
// New route group (no proxy.js precursor -- this is genuinely new
// surface, not an extraction): persists the aiGovernance agent's
// structured decision + findings (governance_decision / governance_finding,
// migration 013_ai_governance_mvp.sql), records human overrides of a
// Blocked decision (governance_override), and auto-creates/updates
// backlog items from Medium+ findings (admin_backlog_items, now
// project-scoped via migration 014_governance_backlog_project_scope.sql).
//
// authorizeGovernanceOverrideAction below is a deliberate byte-for-byte
// copy of promptGovernance.js's authorizePromptOwnerAction, per the plan
// doc's decision 5 ("reuses authorizePromptOwnerAction's existing
// owner-or-admin check ... rather than inventing a new authorization
// rule"). Duplicated rather than extracted into a shared module: pulling
// a working, already-shipped authorization function out of
// promptGovernance.js into a new shared module, with no test run
// available to confirm zero behavior change (the sandbox shell was down
// for this entire implementation pass), is exactly the "clean up while in
// here" risk this codebase's own extraction discipline warns against (see
// agentDispatch.js's header comment). Same rule, same behavior, zero risk
// to the existing prompt-governance code path -- worth revisiting as a
// real shared-module extraction once tests can verify it.

function createGovernanceRouter({
  getDb,
  checkToken,
  isConfiguredAdminEmail,
  getCallerAppRoleForProject,
}) {
  const { Router } = require('express');
  const { randomUUID } = require('crypto');
  const router = Router();

  const DECISION_VALUES = new Set(['approved', 'approved_with_conditions', 'human_review_required', 'blocked', 'not_applicable']);
  const RISK_TIERS = new Set(['critical', 'high', 'moderate', 'low']);
  const FINDING_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
  // Decision 7: only Medium+ severity findings spawn backlog items; Low
  // stays visible in the report and the admin Governance tab only.
  const BACKLOG_ELIGIBLE_SEVERITIES = new Set(['critical', 'high', 'medium']);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function requireGovernanceDb(res) {
    const dbPool = getDb();
    if (!dbPool) {
      res.status(503).json({ error: 'AI governance requires a configured database connection (POSTGRES_URL). This deployment does not have one configured.' });
      return null;
    }
    return dbPool;
  }

  function actorEmail(req) {
    return req.authUser?.email ?? (req.authUser?.adminBypass ? 'admin-bypass' : null);
  }

  // Verbatim copy of promptGovernance.js's authorizePromptOwnerAction --
  // see header comment above for why this is duplicated, not shared.
  async function authorizeGovernanceOverrideAction(req, res, { projectId }) {
    if (req.authUser?.adminBypass && process.env.NODE_ENV !== 'production') {
      return { ok: true, callerEmail: null, callerRole: 'app_admin' };
    }
    const callerEmail = req.authUser?.email ?? null;
    if (!callerEmail) {
      res.status(401).json({ error: 'Please sign in to override a governance decision.' });
      return { ok: false };
    }
    if (isConfiguredAdminEmail(callerEmail)) {
      return { ok: true, callerEmail, callerRole: 'app_admin' };
    }
    const callerAppRole = await getCallerAppRoleForProject(projectId, callerEmail);
    if (callerAppRole !== 'project_owner') {
      res.status(403).json({ error: 'Only the Project Owner or an app admin can override a Blocked governance decision.' });
      return { ok: false };
    }
    return { ok: true, callerEmail, callerRole: 'project_owner' };
  }

  // GET /api/governance/:projectId -- latest decision + open findings +
  // most recent override (if any). Read by the gate0 modal and the
  // persistent workspace-header badge (decisions 1 and 4).
  router.get('/:projectId', checkToken, async (req, res) => {
    const dbPool = requireGovernanceDb(res);
    if (!dbPool) return;
    const { projectId } = req.params;

    const decisionResult = await dbPool.query(`
      SELECT * FROM governance_decision
      WHERE project_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [projectId]);
    const latestDecision = decisionResult.rows[0] ?? null;

    const findingsResult = await dbPool.query(`
      SELECT * FROM governance_finding
      WHERE project_id = $1 AND status = 'open'
      ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        first_seen_at ASC
    `, [projectId]);

    let latestOverride = null;
    if (latestDecision) {
      const overrideResult = await dbPool.query(`
        SELECT * FROM governance_override
        WHERE governance_decision_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [latestDecision.id]);
      latestOverride = overrideResult.rows[0] ?? null;
    }

    return res.json({
      decision: latestDecision,
      findings: findingsResult.rows,
      openFindingsCount: findingsResult.rows.length,
      override: latestOverride,
    });
  });

  // GET /api/governance/:projectId/history -- full decision run history,
  // for the admin Governance tab's drill-in view.
  router.get('/:projectId/history', checkToken, async (req, res) => {
    const dbPool = requireGovernanceDb(res);
    if (!dbPool) return;
    const { rows } = await dbPool.query(`
      SELECT * FROM governance_decision
      WHERE project_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.params.projectId]);
    return res.json({ items: rows });
  });

  // POST /api/governance/:projectId/decision -- called once per aiGovernance
  // run, after frontend/src/services/l3Runtime.ts parses the structured
  // JSON block out of the agent's FINAL_OUTPUT. Persists the run
  // (governance_decision), upserts findings by controlId
  // (governance_finding), resolves findings that dropped out of this run's
  // set (updating any linked backlog item's status per decision 6), and
  // auto-creates/updates backlog items for still-open Medium+ findings
  // (decision 7).
  router.post('/:projectId/decision', checkToken, async (req, res) => {
    const dbPool = requireGovernanceDb(res);
    if (!dbPool) return;
    const { projectId } = req.params;
    const body = req.body ?? {};

    const decision = String(body.decision ?? '').trim();
    const riskTier = String(body.riskTier ?? '').trim();
    if (!DECISION_VALUES.has(decision)) {
      return res.status(400).json({ error: `decision must be one of: ${[...DECISION_VALUES].join(', ')}` });
    }
    if (!RISK_TIERS.has(riskTier)) {
      return res.status(400).json({ error: `riskTier must be one of: ${[...RISK_TIERS].join(', ')}` });
    }
    const findingsInput = Array.isArray(body.findings) ? body.findings : [];
    for (const f of findingsInput) {
      if (!f || typeof f.controlId !== 'string' || !f.controlId.trim()) {
        return res.status(400).json({ error: 'Every finding requires a non-empty controlId.' });
      }
      if (!FINDING_SEVERITIES.has(String(f.severity))) {
        return res.status(400).json({ error: `Finding "${f.controlId}" has an invalid severity.` });
      }
    }

    const agentRunId = body.agentRunId && UUID_RE.test(String(body.agentRunId)) ? body.agentRunId : null;
    const decisionId = randomUUID();
    await dbPool.query(`
      INSERT INTO governance_decision (id, project_id, agent_run_id, risk_tier, decision, confidence, decision_reason, findings)
      VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb)
    `, [
      decisionId,
      projectId,
      agentRunId,
      riskTier,
      decision,
      body.confidence != null ? Number(body.confidence) : null,
      body.decisionReason ?? null,
      JSON.stringify(findingsInput),
    ]);

    const seenControlIds = [];
    const upsertedFindings = [];
    for (const f of findingsInput) {
      const controlId = String(f.controlId).trim();
      seenControlIds.push(controlId);
      const { rows } = await dbPool.query(`
        INSERT INTO governance_finding (id, project_id, control_id, severity, status, gap, recommendation, owner_role, first_seen_at, last_seen_at)
        VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, NOW(), NOW())
        ON CONFLICT (project_id, control_id) DO UPDATE
          SET severity = EXCLUDED.severity,
              status = 'open',
              gap = EXCLUDED.gap,
              recommendation = EXCLUDED.recommendation,
              owner_role = EXCLUDED.owner_role,
              last_seen_at = NOW(),
              resolved_at = NULL
        RETURNING *
      `, [randomUUID(), projectId, controlId, String(f.severity), f.gap ?? null, f.recommendation ?? null, f.ownerRole ?? null]);
      upsertedFindings.push(rows[0]);
    }

    // Resolve findings that were open before this run but didn't reappear
    // -- and, if a backlog item exists for one, mark it done (decision 6:
    // a re-run that resolves a finding updates its backlog item's status
    // rather than leaving a stale duplicate).
    const resolvedResult = seenControlIds.length > 0
      ? await dbPool.query(`
          UPDATE governance_finding
          SET status = 'resolved', resolved_at = NOW()
          WHERE project_id = $1 AND status = 'open' AND NOT (control_id = ANY($2::text[]))
          RETURNING *
        `, [projectId, seenControlIds])
      : await dbPool.query(`
          UPDATE governance_finding
          SET status = 'resolved', resolved_at = NOW()
          WHERE project_id = $1 AND status = 'open'
          RETURNING *
        `, [projectId]);
    for (const resolved of resolvedResult.rows) {
      if (resolved.backlog_item_id) {
        await dbPool.query('UPDATE admin_backlog_items SET status = $2, updated_at = $3 WHERE id = $1', [resolved.backlog_item_id, 'done', Date.now()]);
      }
    }

    // Auto-create/update backlog items for Medium+ severity, still-open
    // findings (decision 7). De-dup by (projectId, controlId) via a
    // deterministic id (decision 6), so a re-run upserts the same row
    // instead of inserting a duplicate. Category is hard-coded 'security'
    // for now rather than a new 'governance' BacklogItem['category'] value
    // -- adding that value would also require updating BacklogTab.tsx's
    // CATEGORY_COLORS map (a Record keyed by every category), which is
    // frontend BacklogTab.tsx work (a separate, not-yet-done task), not a
    // backend-only change.
    for (const finding of upsertedFindings) {
      if (!BACKLOG_ELIGIBLE_SEVERITIES.has(finding.severity)) continue;
      const backlogId = `gov-${projectId}-${finding.control_id}`;
      const now = Date.now();
      await dbPool.query(`
        INSERT INTO admin_backlog_items (id, project_id, title, description, category, priority, status, source, notes, created_at, updated_at)
        VALUES ($1, $2::uuid, $3, $4, 'security', $5, 'open', 'governance', $6, $7, $7)
        ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title,
              description = EXCLUDED.description,
              priority = EXCLUDED.priority,
              updated_at = $7
      `, [
        backlogId,
        projectId,
        `Governance finding: ${finding.control_id}`,
        finding.gap || finding.recommendation || 'See AI Governance Assessment for detail.',
        finding.severity,
        finding.recommendation ?? null,
        now,
      ]);
      await dbPool.query('UPDATE governance_finding SET backlog_item_id = $2 WHERE id = $1', [finding.id, backlogId]);
    }

    return res.json({ ok: true, decisionId });
  });

  // POST /api/governance/:projectId/override -- App Admin or Project Owner
  // overrides a Blocked decision (decisions 1 and 5). Requires a
  // non-empty reason, always logged regardless of which role performed it.
  router.post('/:projectId/override', checkToken, async (req, res) => {
    const dbPool = requireGovernanceDb(res);
    if (!dbPool) return;
    const { projectId } = req.params;
    const auth = await authorizeGovernanceOverrideAction(req, res, { projectId });
    if (!auth.ok) return;

    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to override a Blocked governance decision.' });

    const { rows } = await dbPool.query(`
      SELECT * FROM governance_decision WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1
    `, [projectId]);
    const latestDecision = rows[0];
    if (!latestDecision) return res.status(404).json({ error: 'No governance decision found for this project.' });
    if (latestDecision.decision !== 'blocked') {
      return res.status(409).json({ error: 'Only a Blocked decision can be overridden.' });
    }

    const overrideId = randomUUID();
    await dbPool.query(`
      INSERT INTO governance_override (id, project_id, governance_decision_id, actor_email, actor_role, reason)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [overrideId, projectId, latestDecision.id, auth.callerEmail ?? actorEmail(req) ?? 'admin-bypass', auth.callerRole, reason]);

    return res.json({ ok: true, overrideId });
  });

  return router;
}

module.exports = { createGovernanceRouter };
