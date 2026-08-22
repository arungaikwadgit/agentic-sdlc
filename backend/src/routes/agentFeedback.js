// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Item #18 (Step 6 prioritization matrix), 2026-08-22 -- user feedback
// capture on agent output (agent_feedback, migration
// 024_agent_feedback.sql). Genuinely new surface, no proxy.js precursor --
// same "new route group" convention as governance.js, not an extraction.
//
// POST / is intentionally checkToken-only (no requireAdmin): any
// authenticated user working in a project should be able to rate an
// agent's output, not just admins. GET / and GET /summary are admin-only
// -- they're the data source for the admin FeedbackTab, not something a
// regular project member needs.

function createAgentFeedbackRouter({ getDb, checkToken, requireAdmin }) {
  const { Router } = require('express');
  const { randomUUID } = require('crypto');
  const router = Router();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const RATINGS = new Set(['up', 'down']);
  const MAX_COMMENT_LENGTH = 2000;

  function requireFeedbackDb(res) {
    const dbPool = getDb();
    if (!dbPool) {
      res.status(503).json({ error: 'Feedback capture requires a configured database connection (POSTGRES_URL). This deployment does not have one configured.' });
      return null;
    }
    return dbPool;
  }

  function actorEmail(req) {
    return req.authUser?.email ?? (req.authUser?.adminBypass ? 'admin-bypass' : null);
  }

  // POST / -- record one feedback event. Body: { projectId, agentId, rating, comment? }.
  router.post('/', checkToken, async (req, res) => {
    const dbPool = requireFeedbackDb(res);
    if (!dbPool) return;

    const body = req.body ?? {};
    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
    const rating = typeof body.rating === 'string' ? body.rating : '';
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';

    if (!UUID_RE.test(projectId)) {
      return res.status(400).json({ error: 'projectId must be a valid project UUID.' });
    }
    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required.' });
    }
    if (!RATINGS.has(rating)) {
      return res.status(400).json({ error: "rating must be 'up' or 'down'." });
    }
    if (comment.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ error: `comment cannot exceed ${MAX_COMMENT_LENGTH} characters.` });
    }

    const id = randomUUID();
    try {
      await dbPool.query(`
        INSERT INTO agent_feedback (id, project_id, agent_id, rating, comment, created_by)
        VALUES ($1, $2::uuid, $3, $4, $5, $6)
      `, [id, projectId, agentId, rating, comment || null, actorEmail(req)]);
    } catch (error) {
      // Foreign key violation (23503) -- projectId doesn't reference a real
      // project row. Every other failure is a genuine 500.
      //
      // Responds explicitly rather than re-throwing: this app runs on
      // Express 4, which does not await async route handlers, so a thrown
      // error inside one becomes an unhandled promise rejection instead of
      // reaching any error-handling middleware -- the request would just
      // hang with no response ever sent. Confirmed by a test that hit
      // exactly this before this catch was added (re-throwing timed out
      // the client fetch at 5s with the connection still open).
      if (error && error.code === '23503') {
        return res.status(404).json({ error: 'Project not found.' });
      }
      console.error('[agent-feedback] insert failed:', error && error.message);
      return res.status(500).json({ error: 'Failed to record feedback.' });
    }

    return res.json({ ok: true, id });
  });

  // GET /?limit=&projectId= -- most recent feedback events, newest first.
  // Admin-only: this is the FeedbackTab's raw list, not a per-project widget.
  router.get('/', checkToken, requireAdmin, async (req, res) => {
    const dbPool = requireFeedbackDb(res);
    if (!dbPool) return;

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 500);
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';

    const { rows } = projectId && UUID_RE.test(projectId)
      ? await dbPool.query(`
          SELECT id, project_id, agent_id, rating, comment, created_by, created_at
          FROM agent_feedback
          WHERE project_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT $2
        `, [projectId, limit])
      : await dbPool.query(`
          SELECT id, project_id, agent_id, rating, comment, created_by, created_at
          FROM agent_feedback
          ORDER BY created_at DESC
          LIMIT $1
        `, [limit]);

    return res.json({
      items: rows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        agentId: row.agent_id,
        rating: row.rating,
        comment: row.comment,
        createdBy: row.created_by,
        createdAt: row.created_at,
      })),
    });
  });

  // GET /summary -- up/down counts per agent, across all projects. Admin-only.
  router.get('/summary', checkToken, requireAdmin, async (req, res) => {
    const dbPool = requireFeedbackDb(res);
    if (!dbPool) return;

    const { rows } = await dbPool.query(`
      SELECT
        agent_id,
        COUNT(*) FILTER (WHERE rating = 'up')   AS up_count,
        COUNT(*) FILTER (WHERE rating = 'down') AS down_count,
        MAX(created_at) AS last_feedback_at
      FROM agent_feedback
      GROUP BY agent_id
      ORDER BY (COUNT(*) FILTER (WHERE rating = 'up') + COUNT(*) FILTER (WHERE rating = 'down')) DESC
    `);

    return res.json({
      items: rows.map((row) => ({
        agentId: row.agent_id,
        upCount: Number(row.up_count),
        downCount: Number(row.down_count),
        lastFeedbackAt: row.last_feedback_at,
      })),
    });
  });

  return router;
}

module.exports = { createAgentFeedbackRouter };
