/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { Router } = require('express');

// Wipes ALL application/user data back to a clean slate -- every project,
// team member, agent run/job, memory record, action proposal, rollback
// entry, and invite record. Used by the admin panel's "Reset Application
// Data" button to reset a demo/test environment without a fresh DB.
//
// Master reference data (master_phases, master_agents, master_domains,
// master_role_templates, etc. -- anything seeded by
// scripts/seedMasterData.js) is NEVER touched by this endpoint. None of
// the tables listed below are master_* tables, and master_* tables are
// only ever REFERENCED BY these tables, never the reverse -- so
// TRUNCATE ... CASCADE here cannot cascade backward into master data even
// if a future migration adds more application tables that reference these.
const APPLICATION_DATA_TABLES = [
  'agent_runs',
  'agent_jobs',
  'memory_records',
  'action_proposals',
  'rollback_log',
  'invite_log',
  'invite_sessions',
  'team_members',
  'projects',
];

/**
 * POST /api/admin/reset-application-data -- verbatim extraction from
 * proxy.js (architecture upgrade Phase 3). Admin-only (requireAdmin), AND
 * requires an explicit confirmation string in the body -- not just admin
 * auth -- since this is a fully destructive, irreversible action with no
 * soft-delete/undo path.
 *
 * getDb/getEnsureInviteSessionTable are passed as getters (not snapshots).
 * getDb is the standard "dbPool can be reassigned to null after startup"
 * reason every route module here already uses. getEnsureInviteSessionTable
 * is different: ensureInviteSessionTable is a `const` that's never
 * reassigned once set, but it's assigned later in proxy.js's top-level
 * execution order than this route used to be registered (destructured from
 * the invite router's exports) -- a plain by-value snapshot taken at mount
 * time would capture `undefined`. The original inline code worked because a
 * closure only reads the variable when a real request arrives, long after
 * the whole module has finished loading; a getter reproduces that same
 * lazy-read behavior across the module boundary.
 */
function createAdminResetRouter({ getDb, checkToken, requireAdmin, getEnsureInviteSessionTable }) {
  const router = Router();

  router.post('/reset-application-data', checkToken, requireAdmin, async (req, res) => {
    const dbPool = getDb();
    if (!dbPool) return res.status(503).json({ error: 'Database is unavailable.' });

    const { confirm } = req.body ?? {};
    if (confirm !== 'RESET') {
      return res.status(400).json({
        error:
          'Confirmation required. Send { "confirm": "RESET" } to proceed. This permanently deletes ' +
          'all projects, team members, agent runs/jobs, and invite data. Master reference data ' +
          '(domains, phases, agents, role templates) is not affected.',
      });
    }

    try {
      // Make sure invite_sessions exists before truncating it -- it's created
      // lazily on first invite-accept, so a fresh/unused environment may not
      // have it yet.
      const ensureInviteSessionTable = getEnsureInviteSessionTable();
      await ensureInviteSessionTable().catch(() => {});
      await dbPool.query(`TRUNCATE TABLE ${APPLICATION_DATA_TABLES.join(', ')} CASCADE`);
      const performedBy = req.authUser?.email ?? '(admin-bypass)';
      console.log(`[admin/reset-application-data] reset by ${performedBy} — tables: ${APPLICATION_DATA_TABLES.join(', ')}`);
      return res.json({ ok: true, tablesReset: APPLICATION_DATA_TABLES });
    } catch (err) {
      console.error('[admin/reset-application-data] failed:', err?.message ?? err);
      return res.status(500).json({ error: 'Reset failed: ' + (err?.message ?? String(err)) });
    }
  });

  return router;
}

module.exports = { createAdminResetRouter };
