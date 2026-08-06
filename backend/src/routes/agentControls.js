// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// AI Governance MVP-0 (2026-07-21) -- see
// docs/architecture/govern-ai-gap-assessment-and-implementation-plan.md,
// decision 2 (kill-switch scope: global + per-project, per-project wins).
// Admin-only CRUD for both layers (matches the Admin Panel's new
// Governance tab -- there's no per-project self-service UI for this, it's
// an admin control), plus resolveAgentKillSwitch(), the one shared
// resolution helper backend/src/proxy.js's authorizeAgentRun() calls
// before dispatching any agent.
//
// Enforcement lives in authorizeAgentRun(), NOT backend/src/dispatch/
// agentDispatch.js as the plan doc's file table originally guessed --
// agentDispatch.js (see its own header comment) is pure LLM-provider
// routing (resolveDispatchTarget/dispatchAgentCall), synchronous and with
// no DB access at all. authorizeAgentRun() already receives
// projectId+agentId on every /api/agent and /api/agents/call request and
// already writes 403s for a near-identical case (per-agent access
// scoping) -- reusing that seam avoids inventing a second DB round-trip
// path and keeps kill-switch and access-scoping enforcement in one place.

function createAgentControlsRouter({ getDb, checkToken, requireAdmin }) {
  const { Router } = require('express');
  const router = Router();

  function requireDb(res) {
    const dbPool = getDb();
    if (!dbPool) {
      res.status(503).json({ error: 'Agent controls require a configured database connection (POSTGRES_URL). This deployment does not have one configured.' });
      return null;
    }
    return dbPool;
  }

  function actorEmail(req) {
    return req.authUser?.email ?? (req.authUser?.adminBypass ? 'admin-bypass' : null);
  }

  // GET /api/agent-controls/global -- every agent with an explicit global
  // row (absence of a row means enabled, mirroring modelCatalog.ts's
  // enabled-by-default pattern -- most agents will never have a row here).
  router.get('/global', checkToken, requireAdmin, async (req, res) => {
    const dbPool = requireDb(res);
    if (!dbPool) return;
    const { rows } = await dbPool.query('SELECT * FROM agent_global_settings ORDER BY agent_id ASC');
    return res.json({ items: rows });
  });

  router.post('/global/:agentId', checkToken, requireAdmin, async (req, res) => {
    const dbPool = requireDb(res);
    if (!dbPool) return;
    const agentId = String(req.params.agentId ?? '').trim();
    if (!agentId) return res.status(400).json({ error: 'agentId is required.' });
    const disabled = !!req.body?.disabled;
    const updatedBy = actorEmail(req);
    await dbPool.query(`
      INSERT INTO agent_global_settings (agent_id, disabled, updated_by, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (agent_id) DO UPDATE SET disabled = $2, updated_by = $3, updated_at = NOW()
    `, [agentId, disabled, updatedBy]);
    return res.json({ ok: true, agentId, disabled });
  });

  // GET /api/agent-controls/project/:projectId -- only the agents with an
  // explicit per-project override for this project (usually none/few).
  router.get('/project/:projectId', checkToken, requireAdmin, async (req, res) => {
    const dbPool = requireDb(res);
    if (!dbPool) return;
    const { rows } = await dbPool.query(
      'SELECT * FROM project_agent_overrides WHERE project_id = $1 ORDER BY agent_id ASC',
      [req.params.projectId],
    );
    return res.json({ items: rows });
  });

  router.post('/project/:projectId/:agentId', checkToken, requireAdmin, async (req, res) => {
    const dbPool = requireDb(res);
    if (!dbPool) return;
    const { projectId, agentId } = req.params;
    const disabled = !!req.body?.disabled;
    const updatedBy = actorEmail(req);
    await dbPool.query(`
      INSERT INTO project_agent_overrides (project_id, agent_id, disabled, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (project_id, agent_id) DO UPDATE SET disabled = $3, updated_by = $4, updated_at = NOW()
    `, [projectId, agentId, disabled, updatedBy]);
    return res.json({ ok: true, projectId, agentId, disabled });
  });

  // DELETE clears the per-project override entirely (falls back to
  // whatever the global flag says), as distinct from POST {disabled:false}
  // which leaves an explicit "enabled" override row in place. Both are
  // useful: DELETE for "stop having an opinion for this project", POST
  // false for "I want this project explicitly re-enabled even if someone
  // flips the global flag off later."
  router.delete('/project/:projectId/:agentId', checkToken, requireAdmin, async (req, res) => {
    const dbPool = requireDb(res);
    if (!dbPool) return;
    const { projectId, agentId } = req.params;
    await dbPool.query(
      'DELETE FROM project_agent_overrides WHERE project_id = $1 AND agent_id = $2',
      [projectId, agentId],
    );
    return res.json({ ok: true });
  });

  return router;
}

// Resolution order (decision 2): a per-project override row, if one
// exists for (projectId, agentId), wins outright -- even a `disabled:
// false` row wins, since its very presence means a human made an explicit
// per-project call. Otherwise fall back to the global flag. Absence of
// both rows means enabled (default-open, matching every existing
// enabled-by-default flag in this codebase). Exported standalone (not
// only reachable through this router) because the one caller that matters
// -- authorizeAgentRun() in proxy.js -- needs the answer BEFORE dispatching
// any agent call, not through an HTTP round-trip to this router.
async function resolveAgentKillSwitch({ getDb, projectId, agentId }) {
  const dbPool = getDb();
  if (!dbPool) return { disabled: false, source: 'no-db' };

  const projectRow = await dbPool.query(
    'SELECT disabled FROM project_agent_overrides WHERE project_id = $1 AND agent_id = $2',
    [projectId, agentId],
  );
  if (projectRow.rows[0]) {
    return { disabled: !!projectRow.rows[0].disabled, source: 'project' };
  }

  const globalRow = await dbPool.query(
    'SELECT disabled FROM agent_global_settings WHERE agent_id = $1',
    [agentId],
  );
  if (globalRow.rows[0]) {
    return { disabled: !!globalRow.rows[0].disabled, source: 'global' };
  }

  return { disabled: false, source: 'default' };
}

module.exports = { createAgentControlsRouter, resolveAgentKillSwitch };
