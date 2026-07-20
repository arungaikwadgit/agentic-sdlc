/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { Router } = require('express');

/**
 * GET /api/health -- verbatim extraction from proxy.js (architecture upgrade
 * Phase 3). All values are module-level `const`s in proxy.js, set once at
 * startup from env vars and never reassigned, so they're passed by value
 * here rather than through a getter (unlike dbPool, which can be reassigned
 * to null after startup -- see the invite/app-state router mounts for that
 * pattern).
 */
function createHealthRouter({ openaiModel, anthropicEnabled, anthropicModel, defaultLlmProvider, corpProxy }) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      model: openaiModel,
      claudeEnabled: anthropicEnabled,
      claudeModel: anthropicEnabled ? anthropicModel : null,
      defaultProvider: defaultLlmProvider,
      proxy: corpProxy || null,
      ts: Date.now(),
    });
  });

  return router;
}

module.exports = { createHealthRouter };
