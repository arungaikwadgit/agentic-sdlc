/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Admin-mode flag — activated when signing in with the local admin credentials.
 * Bypasses Supabase and routes all project data through local Dexie storage.
 * Intended for first-run testing before Supabase is configured.
 *
 * Change credentials via env vars:
 *   VITE_ADMIN_EMAIL    (default: admin@local)
 *   VITE_ADMIN_PASSWORD (default: admin)
 */

export const ADMIN_USER_ID = '__admin_local__';
export const ADMIN_EMAIL   = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined) ?? 'admin@local';

/** Returns true when the current session is an admin bypass session. */
export function isAdminMode(): boolean {
  try {
    return sessionStorage.getItem('__admin_mode') === '1';
  } catch {
    return false;
  }
}

/** Activate or deactivate admin bypass mode. */
export function setAdminMode(active: boolean): void {
  try {
    if (active) sessionStorage.setItem('__admin_mode', '1');
    else         sessionStorage.removeItem('__admin_mode');
  } catch { /* ignore — sessionStorage may be unavailable in some envs */ }
}
