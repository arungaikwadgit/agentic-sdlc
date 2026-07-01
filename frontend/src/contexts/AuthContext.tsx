/**
 * Copyright 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 *
 * AuthContext wraps Supabase authentication with a local-development-only
 * admin bypass. Production builds must authenticate through Supabase.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  isAdminMode,
  setAdminMode,
  ADMIN_USER_ID,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_BYPASS_ENABLED,
} from '@/lib/adminMode';

const MOCK_ADMIN_USER = {
  id: ADMIN_USER_ID,
  email: ADMIN_EMAIL,
  app_metadata: { provider: 'local', providers: ['local'] },
  user_metadata: { name: 'Admin', full_name: 'Arun Gaikwad' },
  aud: 'authenticated',
  role: 'authenticated',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  identities: [],
  factors: [],
} as unknown as User;

const makeMockSession = (): Session => ({
  access_token: 'admin-local-bypass-token',
  refresh_token: 'admin-local-refresh',
  expires_at: Math.floor(Date.now() / 1000) + 86400 * 365,
  expires_in: 86400 * 365,
  token_type: 'bearer',
  user: MOCK_ADMIN_USER,
}) as unknown as Session;

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  adminMode: boolean;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminMode, setAdminModeState] = useState(false);

  useEffect(() => {
    if (isAdminMode()) {
      const mockSession = makeMockSession();
      setUser(mockSession.user);
      setSession(mockSession);
      setAdminModeState(true);
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (ADMIN_BYPASS_ENABLED && email.trim() === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      const mockSession = makeMockSession();
      setAdminMode(true);
      setAdminModeState(true);
      setUser(mockSession.user);
      setSession(mockSession);
      return { error: null };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    try {
      const { clearInviteSession } = await import('@/services/inviteSession');
      clearInviteSession();
    } catch {
      // ignore
    }

    if (adminMode) {
      setAdminMode(false);
      setAdminModeState(false);
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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
