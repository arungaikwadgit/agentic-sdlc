/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * AuthGuard — gates the app behind authentication.
 * Shows a banner when Supabase is not configured.
 */
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import LoginPage  from './LoginPage';
import SignUpPage from './SignUpPage';

interface Props { children: ReactNode }
type AuthView = 'login' | 'signup';

const bannerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 9999,
  background: '#92400e',
  color: '#fef3c7',
  padding: '0.45rem 1rem',
  fontSize: '0.78rem',
  textAlign: 'center',
  letterSpacing: '0.01em',
};

export default function AuthGuard({ children }: Props) {
  const { user, loading } = useAuth();
  const [view, setView] = useState<AuthView>('login');

  const configBanner = !isSupabaseConfigured ? (
    <div style={bannerStyle}>
      ⚠️ Supabase not configured — running in local development mode.
      Contact your administrator to enable cloud authentication.
    </div>
  ) : null;

  if (loading) {
    return (
      <>
        {configBanner}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg, #0f1117)', paddingTop: configBanner ? '2rem' : 0 }}>
          <span style={{ color: 'var(--color-text-secondary, #8892a4)', fontSize: '0.9rem' }}>Loading…</span>
        </div>
      </>
    );
  }

  if (!user) {
    if (view === 'signup') {
      return (
        <>
          {configBanner}
          <div style={configBanner ? { paddingTop: '2rem' } : undefined}>
            <SignUpPage
              onSuccess={() => setView('login')}
              onSignIn={() => setView('login')}
            />
          </div>
        </>
      );
    }
    return (
      <>
        {configBanner}
        <div style={configBanner ? { paddingTop: '2rem' } : undefined}>
          <LoginPage
            onSuccess={() => { /* AuthContext re-renders with new user */ }}
            onSignUp={() => setView('signup')}
          />
        </div>
      </>
    );
  }

  // User is authenticated — render the app without the warning banner.
  return <>{children}</>;
}
