/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
const crypto = require('crypto');

const DASHBOARD_VIEWS = new Set(['tiles', 'table']);

function actorKeyForRequest(req) {
  const userId = String(req?.authUser?.user?.id ?? '').trim();
  if (userId) return `auth:${userId}`;
  const email = String(req?.authUser?.email ?? '').trim().toLowerCase();
  if (email) return `email:${crypto.createHash('sha256').update(email).digest('hex')}`;
  if (req?.authUser?.adminBypass === true) return 'admin:local';
  return null;
}

function createUserPreferenceHandlers({ getDb }) {
  async function getDashboardView(req, res) {
    const actorKey = actorKeyForRequest(req);
    if (!actorKey) return res.status(401).json({ error: 'Authentication is required.' });
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Postgres is unavailable.' });
    try {
      const result = await db.query(
        'SELECT preferences FROM user_preferences WHERE user_key = $1',
        [actorKey],
      );
      const saved = result.rows[0]?.preferences?.dashboardView;
      return res.json({ dashboardView: DASHBOARD_VIEWS.has(saved) ? saved : 'tiles' });
    } catch (error) {
      console.error('[user-preferences] read failed');
      return res.status(500).json({ error: 'Could not load user preferences.' });
    }
  }

  async function putDashboardView(req, res) {
    const actorKey = actorKeyForRequest(req);
    if (!actorKey) return res.status(401).json({ error: 'Authentication is required.' });
    const dashboardView = String(req.body?.dashboardView ?? '');
    if (!DASHBOARD_VIEWS.has(dashboardView)) {
      return res.status(400).json({ error: 'dashboardView must be tiles or table.' });
    }
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Postgres is unavailable.' });
    try {
      const result = await db.query(
        `INSERT INTO user_preferences (user_key, preferences, updated_at)
         VALUES ($1, jsonb_build_object('dashboardView', $2::text), NOW())
         ON CONFLICT (user_key) DO UPDATE
           SET preferences = user_preferences.preferences || EXCLUDED.preferences,
               updated_at = NOW()
         RETURNING preferences`,
        [actorKey, dashboardView],
      );
      return res.json({ dashboardView: result.rows[0]?.preferences?.dashboardView ?? dashboardView });
    } catch (error) {
      console.error('[user-preferences] write failed');
      return res.status(500).json({ error: 'Could not save user preferences.' });
    }
  }

  return { getDashboardView, putDashboardView };
}

module.exports = { DASHBOARD_VIEWS, actorKeyForRequest, createUserPreferenceHandlers };
