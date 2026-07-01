/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * AuthGuard — gates the app behind authentication.
 */
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import LoginPage  from './LoginPage';
import SignUpPage from './SignUpPage';

interface Props { children: ReactNode }
type AuthView = 'login' | 'signup';

export default function AuthGuard({ children }: Props) {
  const { user, loading } = useAuth();
  const [view, setView] = useState<AuthView>('login');

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
