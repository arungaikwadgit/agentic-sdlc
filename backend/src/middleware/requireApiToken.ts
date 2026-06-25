/**
 * © 2025 Arun Gaikwad. All rights reserved.
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
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.RUNTIME_API_TOKEN;

  if (!token) {
    res.status(500).json({ error: 'RUNTIME_API_TOKEN not configured' });
    return;
  }

  if (req.header('x-api-token') !== token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
