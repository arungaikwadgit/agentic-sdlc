/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Shared detection for the self-service password-reset landing route
 * (/reset-password), which Supabase redirects back to after a user clicks
 * the link from supabase.auth.resetPasswordForEmail() (see
 * AuthContext.tsx's sendPasswordReset() for where redirectTo is set).
 *
 * Mirrors lib/inviteRoute.ts's pattern: used by both AuthGuard (to bypass
 * the login gate — Supabase's own detectSessionInUrl establishes a
 * short-lived "recovery" session for this page to act on) and App (to
 * render ResetPasswordPage instead of the dashboard/project views).
 */
export function isResetPasswordRoute(): boolean {
  return window.location.pathname === '/reset-password';
}
