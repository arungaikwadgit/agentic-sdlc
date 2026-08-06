// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Extracted from backend/src/proxy.js (2026-07-19, architecture upgrade
// Phase 3 — see docs/architecture/architecture-upgrade-execution-plan.md).
// This is ONLY the browser-to-runtime forwarding route
// (POST /api/lifecycle-events on the legacy proxy app). It is unrelated to
// backend/src/routes/lifecycleEvents.ts, which is the *receiving* side
// mounted on the separate TypeScript durable-runtime app
// (backend/src/index.ts) at /api/v1/lifecycle-events — different file,
// different Express app, different concern; the naming here is deliberately
// distinct (lifecycleForwarding, not lifecycleEvents) to avoid confusing
// the two.
//
// proxy.js's own enqueueRuntimeLifecycleEvent()/fanOutRuntimeLifecycleEvent()
// helpers (near the top of proxy.js) also call RUNTIME_API_URL/
// RUNTIME_API_TOKEN, but are NOT part of this extraction — grepped and
// confirmed they're invoked from several other, unrelated routes
// (prompt-governance activation, app-state config PUT/batch) elsewhere in
// proxy.js, so they stay there as shared fire-and-forget helpers.
//
// Extraction discipline (plan Section 0.1): the function body below is a
// byte-for-byte verbatim copy from proxy.js.

function createLifecycleForwardingRouter({ RUNTIME_API_URL, RUNTIME_API_TOKEN, checkToken }) {
  const { Router } = require('express');
  const router = Router();

  // Authenticated browser-to-runtime bridge for durable background lifecycle work.
  router.post('/', checkToken, async (req, res) => {
    if (!RUNTIME_API_URL || !RUNTIME_API_TOKEN) {
      return res.status(503).json({ error: 'Background lifecycle runtime is not configured.' });
    }
    try {
      const response = await fetch(RUNTIME_API_URL + '/api/v1/lifecycle-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': RUNTIME_API_TOKEN,
        },
        body: JSON.stringify(req.body ?? {}),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      res.status(response.status);
      res.type(response.headers.get('content-type') ?? 'application/json');
      return res.send(text);
    } catch (error) {
      console.error('[lifecycle-events] runtime forwarding failed:', error instanceof Error ? error.message : error);
      return res.status(502).json({ error: 'Background lifecycle runtime is unavailable.' });
    }
  });

  return router;
}

module.exports = { createLifecycleForwardingRouter };
