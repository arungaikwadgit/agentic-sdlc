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
  /**
   * True when the signed-in user is a real, production-recognized app admin
   * (the `server/` service's ADMIN_EMAIL_ALLOWLIST, via
   * GET /api/projects/permissions/me - see services/adminAuth.ts) - distinct
   * from `adminMode`, which is the local-dev-only bypass. Resolves
   * asynchronously after sign-in, so it starts false and flips true if
   * confirmed; treat it as "not yet known / not an admin" until then, same
   * as any other loading boolean. Bypass sessions are always treated as
   * admins (adminMode already grants that) and don't need this check.
   */
  isAppAdmin: boolean;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  /**
   * Self-service "forgot password" — sends Supabase's own reset email with
   * a redirect back to /reset-password (see ResetPasswordPage.tsx and
   * lib/resetPasswordRoute.ts). Distinct from the admin-triggered reset
   * (POST /api/invite/reset-password in backend/src/proxy.js), which
   * generates and emails a new default password directly.
   */
  sendPasswordReset: (email: string) => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminMode, setAdminModeState] = useState(false);
  const [isAppAdmin, setIsAppAdmin] = useState(false);

  // Checks the real production admin allowlist for the current session.
  // Never runs for bypass sessions (adminMode already implies admin access);
  // any failure just leaves isAppAdmin false.
  const refreshAppAdminStatus = useCallback(async (hasSession: boolean) => {
    if (!hasSession) {
      setIsAppAdmin(false);
      return;
    }
    try {
      const { checkIsAppAdmin } = await import('@/services/adminAuth');
      setIsAppAdmin(await checkIsAppAdmin());
    } catch {
      setIsAppAdmin(false);
    }
  }, []);

  useEffect(() => {
    // Supabase is the production source of truth. Check it first so a stale
    // local admin-bypass flag cannot shadow a real authenticated session.
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      console.log(
        '[auth] AuthProvider init: supabase.auth.getSession() -> ' + (data.session ? 'SESSION FOUND' : 'NO SESSION') +
        (data.session?.expires_at ? ', user=' + (data.session.user?.email ?? '(no email)') + ', expires_at=' + new Date(data.session.expires_at * 1000).toISOString() : '')
      );

      if (data.session) {
        setAdminMode(false);
        setAdminModeState(false);
        setSession(data.session);
        setUser(data.session.user ?? null);
        setLoading(false);
        void refreshAppAdminStatus(true);
        return;
      }

      if (isAdminMode()) {
        console.log('[auth] AuthProvider init: admin-bypass mode active (dev-mode only)');
        const mockSession = makeMockSession();
        setUser(mockSession.user);
        setSession(mockSession);
        setAdminModeState(true);
        setIsAppAdmin(true);
        setLoading(false);
        return;
      }

      setSession(null);
      setUser(null);
      setAdminModeState(false);
      setIsAppAdmin(false);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      console.log('[auth] onAuthStateChange: event=' + _event + ' session=' + (nextSession ? 'present' : 'null'));
      // Supabase can emit SIGNED_OUT while the dev-only bypass session is active.
      // That event describes Supabase state, not the independent local admin session.
      if (!nextSession && isAdminMode()) return;
      if (nextSession) {
        setAdminMode(false);
        setAdminModeState(false);
      }
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
      void refreshAppAdminStatus(Boolean(nextSession));
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [refreshAppAdminStatus]);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    console.log(`[auth] signUp(${email}) -> ${error ? `error: ${error.message}` : 'success'}`);
    return { error };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (ADMIN_BYPASS_ENABLED && email.trim() === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      console.log('[auth] signIn: admin-bypass credentials matched (dev-mode only, inert in production builds)');
      const mockSession = makeMockSession();
      setAdminMode(true);
      setAdminModeState(true);
      setUser(mockSession.user);
      setSession(mockSession);
      return { error: null };
    }

    // A real Supabase login must clear any previous local admin-bypass flag.
    // Otherwise API calls can keep sending the mock admin token to the server API,
    // which correctly rejects it as an invalid Supabase JWT.
    setAdminMode(false);
    setAdminModeState(false);

    console.log(`[auth] signIn: attempting supabase.auth.signInWithPassword(${email})`);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.log(`[auth] signIn(${email}) -> error: ${error.message}`);
      return { error };
    }

    const { data } = await supabase.auth.getSession();
    setUser(data.session?.user ?? null);
    setSession(data.session ?? null);
    console.log(`[auth] signIn(${email}) -> success, session established`);
    return { error: null };
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    console.log(`[auth] sendPasswordReset(${email}) -> ${error ? `error: ${error.message}` : 'sent (or silently no-op if no account exists — Supabase does not disclose which)'}`);
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
      setIsAppAdmin(false);
      return;
    }

    await supabase.auth.signOut();
  }, [adminMode]);

  return (
    <AuthContext.Provider value={{ user, session, loading, adminMode, isAppAdmin, signUp, signIn, signOut, sendPasswordReset }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
