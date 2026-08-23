/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Shared-secret auth middleware for the Agent Runtime API (Finding #3).
 *
 * Mirrors the existing `checkToken` pattern in proxy.js (compares an
 * `x-api-token` header against an env-configured secret), but FAILS CLOSED:
 * unlike proxy.js's checkToken — which silently no-ops if PROXY_TOKEN is
 * unset — this middleware refuses all requests with a 500 if
 * RUNTIME_API_TOKEN isn't configured. The Agent Runtime routes (agent runs,
 * agent jobs) can create/mutate state and weren't gated by anything at all
 * before this, so an accidental "auth disabled because someone forgot to
 * set an env var" failure mode is worse than refusing to start serving.
 *
 * This is a minimal, single-shared-secret scheme — it does not identify
 * *who* is calling, only *that* the caller knows the token. It does not
 * replace real per-user authentication (there is no user/session model
 * anywhere in this codebase yet). Treat it as a stopgap that closes the
 * "anyone on the network can call these routes" gap, not as access control
 * between trusted callers.
 *
 * Item #5 Phase 3 (2026-08-23): also accepts RUNTIME_API_TOKEN_INTERNAL, a
 * SEPARATE secret for server/src's new server-to-server call into
 * GET /api/v1/memory-records/similar (see routes/memoryRecords.ts). This is
 * deliberately a second, independent env var rather than reusing
 * RUNTIME_API_TOKEN itself: RUNTIME_API_TOKEN is already live, shared with
 * backend/src/proxy.js for the existing background-lifecycle-worker
 * integration (see ARCHITECTURE.md's Background Optimization diagram), and
 * rotating a secret that's already load-bearing elsewhere risks breaking
 * that working integration if any one of the (currently 2, now 3) copies
 * gets out of sync. Adding a second accepted token has zero effect on
 * existing callers using RUNTIME_API_TOKEN -- both are checked, either
 * grants access, neither is required to match the other.
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction): void {
  const primary = process.env.RUNTIME_API_TOKEN;
  const internal = process.env.RUNTIME_API_TOKEN_INTERNAL;

  if (!primary && !internal) {
    res.status(500).json({ error: 'RUNTIME_API_TOKEN not configured' });
    return;
  }

  const presented = req.header('x-api-token');
  const authorized = (!!primary && presented === primary) || (!!internal && presented === internal);
  if (!authorized) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
