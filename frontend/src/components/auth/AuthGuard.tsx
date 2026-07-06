/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * AuthGuard — gates the app behind authentication.
 */
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isInviteRoute } from '@/lib/inviteRoute';
import LoginPage  from './LoginPage';
import SignUpPage from './SignUpPage';

interface Props { children: ReactNode }
type AuthView = 'login' | 'signup';

export default function AuthGuard({ children }: Props) {
  const { user, loading } = useAuth();
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

  // User is authenticated — render the app without the warning banner.
  return <>{children}</>;
}
