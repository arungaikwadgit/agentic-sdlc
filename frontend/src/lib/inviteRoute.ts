/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Shared detection for the invite-accept route (e.g. /invite?token=...&projectId=...&email=...,
 * built by resolveInviteBaseUrl()/POST /api/invite/send in backend/src/proxy.js).
 *
 * Used by both:
 *  - AuthGuard, to bypass the login gate for unauthenticated invitees (InviteAcceptPage
 *    handles its own auth: Supabase signUp/signIn + 6-digit OTP, and the backend
 *    independently re-verifies the invitee's email via requireVerifiedInviteeEmail()
 *    before granting access to the single invited project).
 *  - App, to render InviteAcceptPage instead of the dashboard/project views.
 *
 * Kept in one place so the two checks can't drift apart.
 */
export function isInviteRoute(): boolean {
  return window.location.pathname === '/invite' || window.location.search.includes('token=');
}
