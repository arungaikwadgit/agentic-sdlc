/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * AuthContext — wraps Supabase Auth with an admin bypass mode for local dev.
 *
 * Admin bypass: sign in with admin@local / admin (or VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD).
 * In admin mode, a mock user is created locally and project data routes through Dexie.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isAdminMode, setAdminMode, ADMIN_USER_ID, ADMIN_EMAIL } from '@/lib/adminMode';

// ── Mock admin objects (no Supabase required) ──────────────────────────────────

const MOCK_ADMIN_USER = {
  id:            ADMIN_USER_ID,
  email:         ADMIN_EMAIL,
  app_metadata:  { provider: 'local', providers: ['local'] },
  user_metadata: { name: 'Admin', full_name: 'Arun Gaikwad' },
  aud:           'authenticated',
  role:          'authenticated',
  created_at:    new Date().toISOString(),
  updated_at:    new Date().toISOString(),
  identities:    [],
  factors:       [],
} as unknown as User;

const makeMockSession = (): Session => ({
  access_token:  'admin-local-bypass-token',
  refresh_token: 'admin-local-refresh',
  expires_at:    Math.floor(Date.now() / 1000) + 86400 * 365,
  expires_in:    86400 * 365,
  token_type:    'bearer',
  user:          MOCK_ADMIN_USER,
}) as unknown as Session;

// ── Admin credentials (override via .env) ─────────────────────────────────────
const ADMIN_BYPASS_EMAIL    = (import.meta.env.VITE_ADMIN_EMAIL    as string | undefined) ?? 'admin@local';
const ADMIN_BYPASS_PASSWORD = (import.meta.env.VITE_ADMIN_PASSWORD as string | undefined) ?? 'admin';

// ── Context types ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  user:          User | null;
  session:       Session | null;
  loading:       boolean;
  adminMode:     boolean;

  signUp:  (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signIn:  (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,      setUser]      = useState<User | null>(null);
  const [session,   setSession]   = useState<Session | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [adminMode, setAdminModeSt] = useState(false);

  useEffect(() => {
    // Restore admin bypass session from sessionStorage
    if (isAdminMode()) {
      const s = makeMockSession();
      setUser(s.user);
      setSession(s);
      setAdminModeSt(true);
      setLoading(false);
      return;
    }

    // Otherwise restore Supabase session from localStorage
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    // Admin bypass — works without Supabase configured
    if (email.trim() === ADMIN_BYPASS_EMAIL && password === ADMIN_BYPASS_PASSWORD) {
      const s = makeMockSession();
      setAdminMode(true);
      setAdminModeSt(true);
      setUser(s.user);
      setSession(s);
      return { error: null };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    if (adminMode) {
      setAdminMode(false);
      setAdminModeSt(false);
      setUser(null);
      setSession(null);
      return;
    }
    await supabase.auth.signOut();
  }, [adminMode]);

  return (
    <AuthContext.Provider value={{ user, session, loading, adminMode, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
