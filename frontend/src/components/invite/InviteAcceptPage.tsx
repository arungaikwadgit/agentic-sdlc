/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * InviteAcceptPage — handles /invite?token=<hex> URLs.
 *
 * Flow:
 *  1. Fetch invite info from GET /api/invite/validate (no auth needed)
 *  2. Show a form with the invited email pre-filled and read-only, and a
 *     password field. "Verify My Email" calls supabase.auth.signUp(), which
 *     — with Supabase's "Confirm signup" email template configured to
 *     include {{ .Token }} — emails a 6-digit code (not just a magic link).
 *  3. The user enters that code here; supabase.auth.verifyOtp() checks it.
 *     Supabase owns the code generation, expiry, and rate-limiting, so none
 *     of that security-sensitive logic is custom code we have to maintain.
 *  4. On success the user is signed in with a confirmed session. A final
 *     "Sign In & Join Project" click calls POST /api/invite/accept (which
 *     independently re-verifies the confirmed email server-side) to
 *     activate access scoped to exactly this one project.
 *  5. If the email already belongs to a confirmed account (e.g. invited to
 *     a second project), signUp() reports that without leaking whether the
 *     account exists via an error — we detect it and switch to a plain
 *     sign-in form instead, since no new code is needed for an account
 *     that's already confirmed.
 */
import { useEffect, useState } from 'react';
import styles from './InviteAcceptPage.module.css';
import { supabase } from '@/lib/supabase';
import { setInviteSession } from '@/services/inviteSession';
import { getProject } from '@/db/projectRepository';
import AppLogo from '@/components/common/AppLogo';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined ?? 'http://localhost:3001').replace(/\/$/, '');

interface InviteInfo {
  id: string;
  role: string;
  invitedEmail: string | null;
  expiresAt: string | null;
  project: {
    id: string;
    name: string;
    description: string;
  };
}

type FormMode = 'signup' | 'signin';

type State =
  | { status: 'loading' }
  | { status: 'form'; invite: InviteInfo; mode: FormMode; error?: string }
  | { status: 'submitting'; invite: InviteInfo; mode: FormMode }
  | { status: 'verify-code'; invite: InviteInfo; error?: string }
  | { status: 'verifying-code'; invite: InviteInfo }
  | { status: 'verified'; invite: InviteInfo }
  | { status: 'accepting' }
  | { status: 'done'; projectId: string; projectName: string }
  | { status: 'error'; message: string };

export default function InviteAcceptPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';

  const [state, setState] = useState<State>({ status: 'loading' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [resendMsg, setResendMsg] = useState('');

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: 'No invite token found in this link.' });
      return;
    }
    fetch(`${API_URL}/invite/validate?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setState({ status: 'error', message: data.error });
        } else {
          setState({ status: 'form', invite: data as InviteInfo, mode: 'signup' });
        }
      })
      .catch(() => setState({ status: 'error', message: 'Could not connect to the server. Please try again.' }));
  }, [token]);

  async function finishAccepting(invite: InviteInfo) {
    setState({ status: 'accepting' });
    try {
      const { data } = await supabase.auth.getSession();
      const jwt = data.session?.access_token;
      if (!jwt) {
        setState({ status: 'error', message: 'Your session expired before access could be activated. Please refresh and try again.' });
        return;
      }

      const res = await fetch(`${API_URL}/invite/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ token }),
      });

      const result = await res.json();
      if (result.error) {
        setState({ status: 'error', message: result.error });
        return;
      }

      setInviteSession({
        token: result.accessToken ?? token,
        projectId: result.projectId,
        email: (result.email ?? invite.invitedEmail ?? '').toLowerCase(),
        appRole: result.appRole,
        name: result.name,
        expiresAt: typeof result.expiresAt === 'string'
          ? Date.parse(result.expiresAt)
          : (typeof result.expiresAt === 'number' ? result.expiresAt : undefined),
      });

      await getProject(result.projectId).catch(() => undefined);

      setState({ status: 'done', projectId: result.projectId, projectName: invite.project.name });
    } catch {
      setState({ status: 'error', message: 'Could not activate this invite. Please try again.' });
    }
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (state.status !== 'form') return;
    const invite = state.invite;
    const email = invite.invitedEmail ?? '';

    if (state.mode === 'signup') {
      if (password.length < 8) {
        setState({ ...state, error: 'Password must be at least 8 characters.' });
        return;
      }
      if (password !== confirmPassword) {
        setState({ ...state, error: 'Passwords do not match.' });
        return;
      }

      setState({ status: 'submitting', invite, mode: 'signup' });
      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        setState({ status: 'form', invite, mode: 'signup', error: error.message });
        return;
      }

      // Supabase returns an empty identities array (no error, to avoid leaking
      // account existence) when signUp() targets an email that's already
      // registered and confirmed. That account has already verified its
      // email, so route straight to sign-in instead of a fresh code.
      const identities = (data.user as unknown as { identities?: unknown[] } | null)?.identities;
      if (data.user && Array.isArray(identities) && identities.length === 0) {
        setState({
          status: 'form',
          invite,
          mode: 'signin',
          error: 'An account already exists for this email. Sign in with your existing password to continue.',
        });
        return;
      }

      if (data.session) {
        // Email confirmation is disabled on this Supabase project — the
        // account is already active and signed in, so skip the code step.
        void finishAccepting(invite);
        return;
      }

      setState({ status: 'verify-code', invite });
    } else {
      if (!password) {
        setState({ ...state, error: 'Enter your password.' });
        return;
      }
      setState({ status: 'submitting', invite, mode: 'signin' });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setState({ status: 'form', invite, mode: 'signin', error: error.message });
        return;
      }
      void finishAccepting(invite);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (state.status !== 'verify-code') return;
    const invite = state.invite;
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setState({ status: 'verify-code', invite, error: 'Enter the 6-digit code from your email.' });
      return;
    }

    setState({ status: 'verifying-code', invite });
    const { error } = await supabase.auth.verifyOtp({
      email: invite.invitedEmail ?? '',
      token: trimmed,
      type: 'signup',
    });

    if (error) {
      setState({ status: 'verify-code', invite, error: error.message || 'That code is incorrect or has expired.' });
      return;
    }

    setState({ status: 'verified', invite });
  }

  async function resendCode() {
    if (state.status !== 'verify-code') return;
    setResendMsg('Sending…');
    const { error } = await supabase.auth.resend({ type: 'signup', email: state.invite.invitedEmail ?? '' });
    setResendMsg(error ? (error.message || 'Could not resend the code.') : 'A new code is on its way.');
  }

  function switchMode(mode: FormMode) {
    if (state.status !== 'form') return;
    setPassword('');
    setConfirmPassword('');
    setState({ status: 'form', invite: state.invite, mode });
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <AppLogo wordmarkClassName={styles.logoText} />
        </div>

        {state.status === 'loading' && (
          <div className={styles.center}>
            <div className={styles.spinner} />
            <p>Validating your invite…</p>
          </div>
        )}

        {(state.status === 'form' || state.status === 'submitting') && (
          <>
            <h1 className={styles.heading}>You've been invited!</h1>
            <p className={styles.sub}>You've been invited to join</p>
            <div className={styles.projectName}>{state.invite.project.name}</div>
            <div className={styles.roleChip}>
              as <strong>{state.invite.role}</strong>
            </div>
            <p className={styles.sub}>
              Accepting this invite gives access only to this project and only with the assigned role.
            </p>

            <form className={styles.form} onSubmit={submitForm}>
              <label className={styles.fieldLabel} htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                className={styles.fieldInput}
                type="email"
                value={state.invite.invitedEmail ?? ''}
                readOnly
                title="This invite is locked to this email address"
              />

              <label className={styles.fieldLabel} htmlFor="invite-password">
                {state.mode === 'signup' ? 'Create a password' : 'Password'}
              </label>
              <input
                id="invite-password"
                className={styles.fieldInput}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={state.mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                autoFocus
                disabled={state.status === 'submitting'}
              />

              {state.mode === 'signup' && (
                <>
                  <label className={styles.fieldLabel} htmlFor="invite-password-confirm">Confirm password</label>
                  <input
                    id="invite-password-confirm"
                    className={styles.fieldInput}
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    disabled={state.status === 'submitting'}
                  />
                </>
              )}

              {state.status === 'form' && state.error && (
                <p className={styles.errorMsg}>{state.error}</p>
              )}

              <button className={styles.acceptBtn} type="submit" disabled={state.status === 'submitting'}>
                {state.status === 'submitting'
                  ? (state.mode === 'signup' ? 'Sending code…' : 'Signing in…')
                  : (state.mode === 'signup' ? 'Verify My Email' : 'Sign In & Join Project')}
              </button>
            </form>

            <p className={styles.switchModeText}>
              {state.mode === 'signup' ? (
                <>Already have an account? <button type="button" className={styles.linkBtn} onClick={() => switchMode('signin')}>Sign in instead</button></>
              ) : (
                <>New here? <button type="button" className={styles.linkBtn} onClick={() => switchMode('signup')}>Create a password</button></>
              )}
            </p>
          </>
        )}

        {(state.status === 'verify-code' || state.status === 'verifying-code') && (
          <>
            <div className={styles.successIcon}>✉</div>
            <h1 className={styles.heading}>Check your email</h1>
            <p className={styles.sub}>
              We sent a 6-digit code to <strong>{state.invite.invitedEmail}</strong>. Enter it below to confirm your email.
            </p>

            <form className={styles.form} onSubmit={submitCode}>
              <label className={styles.fieldLabel} htmlFor="invite-code">6-digit code</label>
              <input
                id="invite-code"
                className={`${styles.fieldInput} ${styles.codeInput}`}
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
                disabled={state.status === 'verifying-code'}
              />

              {state.status === 'verify-code' && state.error && (
                <p className={styles.errorMsg}>{state.error}</p>
              )}

              <button className={styles.acceptBtn} type="submit" disabled={state.status === 'verifying-code'}>
                {state.status === 'verifying-code' ? 'Verifying…' : 'Confirm Code'}
              </button>
            </form>

            <p className={styles.switchModeText}>
              Didn't get it? <button type="button" className={styles.linkBtn} onClick={resendCode}>Resend code</button>
              {resendMsg && <> — {resendMsg}</>}
            </p>
          </>
        )}

        {state.status === 'verified' && (
          <>
            <div className={styles.successIcon}>✓</div>
            <h1 className={styles.heading}>Email confirmed</h1>
            <p className={styles.sub}>
              You're verified. Click below to finish joining <strong>{state.invite.project.name}</strong>.
            </p>
            <button className={styles.acceptBtn} onClick={() => finishAccepting(state.invite)}>
              Sign In &amp; Join Project
            </button>
          </>
        )}

        {state.status === 'accepting' && (
          <div className={styles.center}>
            <div className={styles.spinner} />
            <p>Activating your project access…</p>
          </div>
        )}

        {state.status === 'done' && (
          <>
            <div className={styles.successIcon}>✓</div>
            <h1 className={styles.heading}>Welcome aboard!</h1>
            <p className={styles.sub}>
              You've joined <strong>{state.projectName}</strong>.
            </p>
            <p className={styles.sub}>Taking you into the project…</p>
            <a href={`/?project=${state.projectId}`} className={styles.acceptBtn}>
              Open Project
            </a>
          </>
        )}

        {state.status === 'error' && (
          <>
            <div className={styles.errorIcon}>⚠</div>
            <h1 className={styles.heading}>Invite problem</h1>
            <p className={styles.errorMsg}>{state.message}</p>
            <a href="/" className={styles.secondaryBtn}>Go to home</a>
          </>
        )}
      </div>
    </div>
  );
}
