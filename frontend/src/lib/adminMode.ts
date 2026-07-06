/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Admin-mode flag — activated only in local development when signing in with
 * the local admin credentials.
 * Bypasses Supabase sign-in while still using the backend/Postgres data path.
 *
 * This bypass is intentionally local-development only. Production builds
 * must use Supabase authentication and never depend on browser-bundled
 * admin credentials.
 */

export const ADMIN_USER_ID = '__admin_local__';
export const ADMIN_EMAIL   = 'admin@local';
export const ADMIN_PASSWORD = 'admin';
export const ADMIN_BYPASS_ENABLED = import.meta.env.DEV;

/** Returns true when the current session is an admin bypass session. */
export function isAdminMode(): boolean {
  if (!ADMIN_BYPASS_ENABLED) return false;
  try {
    return sessionStorage.getItem('__admin_mode') === '1';
  } catch {
    return false;
  }
}

/** Activate or deactivate admin bypass mode. */
export function setAdminMode(active: boolean): void {
  if (!ADMIN_BYPASS_ENABLED) return;
  try {
    if (active) sessionStorage.setItem('__admin_mode', '1');
    else         sessionStorage.removeItem('__admin_mode');
  } catch { /* ignore — sessionStorage may be unavailable in some envs */ }
}
