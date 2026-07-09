/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Production-safe admin check. The local dev admin-bypass (lib/adminMode.ts)
 * is intentionally disabled outside `npm run dev`, so a real signed-in
 * production user has no way to be recognized as an admin on the frontend
 * without this.
 *
 * Source of truth is the `server/` service's own ADMIN_EMAIL_ALLOWLIST
 * (server/src/middleware/auth.ts, isAppAdmin()) — NOT backend/src/proxy.js's
 * allowlist of the same name. `/api/admin/*` and `/api/projects/*` requests
 * are forwarded from proxy.js straight to `server/` (see proxy.js's
 * `app.use('/api/admin', forwardToServer)`), so any admin route added
 * directly to proxy.js is unreachable in a normal deployment — this reuses
 * the endpoint `server/` already exposes for exactly this check instead of
 * adding a new, effectively dead one.
 */

/**
 * Returns true only if the `server/` service confirms the current signed-in
 * user is a configured app admin (GET /api/projects/permissions/me). Never
 * throws — any error (network, 401, unconfigured backend) resolves to false
 * so callers can use this directly as a UI gate without extra try/catch.
 */
export async function checkIsAppAdmin(): Promise<boolean> {
  try {
    const { getAuthHeader } = await import('./api');
    const { buildApiUrl } = await import('@/db/projectRepository');
    const headers = await getAuthHeader();
    if (!headers.Authorization) return false; // no session at all — skip the round trip

    // buildApiUrl() normalizes VITE_API_URL regardless of whether it already
    // ends in "/api" — a bare-origin fetch here previously dropped the /api
    // prefix entirely whenever VITE_API_URL didn't already include it.
    const res = await fetch(buildApiUrl('/api/projects/permissions/me'), { headers });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.isAppAdmin === true;
  } catch {
    return false;
  }
}
