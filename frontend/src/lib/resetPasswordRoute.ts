/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Shared detection for the /reset-password route (the redirectTo target for
 * both AuthContext.tsx's sendPasswordReset() and Supabase's own
 * resetPasswordForEmail() email link).
 *
 * Used by both:
 *  - AuthGuard, to bypass the login gate — Supabase's detectSessionInUrl
 *    establishes a short-lived recovery session for ResetPasswordPage to act
 *    on, which is not a normal login and shouldn't be gated behind one.
 *  - App, to render ResetPasswordPage instead of the dashboard/project views.
 *
 * Kept in one place (mirroring lib/inviteRoute.ts) so the two checks can't
 * drift apart.
 */
export function isResetPasswordRoute(): boolean {
  return window.location.pathname === '/reset-password';
}
