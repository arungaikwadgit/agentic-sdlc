/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * AuthGuard — gates the app behind authentication.
 */
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isInviteRoute } from '@/lib/inviteRoute';
import { isResetPasswordRoute } from '@/lib/resetPasswordRoute';
import LoginPage  from './LoginPage';
import SignUpPage from './SignUpPage';
import ForcedPasswordChange from './ForcedPasswordChange';

interface Props { children: ReactNode }
type AuthView = 'login' | 'signup';

export default function AuthGuard({ children }: Props) {
  const { user, loading, adminMode } = useAuth();
  const [view, setView] = useState<AuthView>('login');

  // Invite links must work for unauthenticated invitees — don't gate this route behind
  // login. InviteAcceptPage handles its own auth (Supabase signUp/signIn + 6-digit OTP)
  // and the backend independently re-verifies the invitee's email (requireVerifiedInviteeEmail
  // in backend/src/proxy.js) before granting access to the single invited project. Bypassing
  // the login wall here does not weaken that — it's what lets the invitee reach the page
  // that does the real verification.
  if (isInviteRoute()) {
    return <>{children}</>;
  }

  // /reset-password must also work unauthenticated — Supabase's own
  // detectSessionInUrl establishes a short-lived recovery session for
  // ResetPasswordPage to act on, but that's not a normal login and
  // shouldn't be gated behind (or treated as) one.
  if (isResetPasswordRoute()) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg, #0f1117)' }}>
        <span style={{ color: 'var(--color-text-secondary, #8892a4)', fontSize: '0.9rem' }}>Loading…</span>
      </div>
    );
  }

  if (!user) {
    if (view === 'signup') {
      return (
        <div>
          <SignUpPage
            onSuccess={() => setView('login')}
            onSignIn={() => setView('login')}
          />
        </div>
      );
    }
    return (
      <div>
        <LoginPage
          onSuccess={() => { /* AuthContext re-renders with new user */ }}
          onSignUp={() => setView('signup')}
        />
      </div>
    );
  }

  // Any real (non-admin-bypass) session created with a default password —
  // fresh invite accept or an admin-triggered reset — carries
  // user_metadata.must_change_password until the user sets their own. Block
  // the entire app behind that instead of just the invite flow, since a
  // reset can happen to someone who's already deep into a normal session on
  // their next login. adminMode's mock session never has this flag, but the
  // check is explicit here anyway rather than relying on that by omission.
  const mustChangePassword = !adminMode && user.user_metadata?.must_change_password === true;
  if (mustChangePassword) {
    return <ForcedPasswordChange />;
  }

  // User is authenticated — render the app without the warning banner.
  return <>{children}</>;
}
