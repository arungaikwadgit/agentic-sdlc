/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { Router } = require('express');
const { createUserPreferenceHandlers } = require('../userPreferences');

/**
 * GET/PUT /api/user-preferences/dashboard-view -- verbatim extraction from
 * proxy.js (architecture upgrade Phase 3). The actual handler logic already
 * lived in ./userPreferences (createUserPreferenceHandlers); only the route
 * registration itself was still inline in proxy.js. getDb is a getter (not a
 * snapshot) since dbPool can be reassigned to null asynchronously after
 * startup -- matches the invite/app-state router convention. requireAppStateDb
 * is passed in rather than reimplemented, since it's the same fail-open-when-
 * dbPool-is-null check every app-state-backed route in this codebase already
 * shares (see appState.js).
 */
function createUserPreferenceRouter({ getDb, checkToken, requireAppStateDb }) {
  const router = Router();
  const handlers = createUserPreferenceHandlers({ getDb });

  router.get('/dashboard-view', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    return handlers.getDashboardView(req, res);
  });

  router.put('/dashboard-view', checkToken, async (req, res) => {
    if (!await requireAppStateDb(res)) return;
    return handlers.putDashboardView(req, res);
  });

  return router;
}

module.exports = { createUserPreferenceRouter };
