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
 *     password field. "Verify My Email" calls supabase.auth.signUp() with
 *     emailRedirectTo pointed back at this exact invite URL. Supabase's
 *     Auth email templates cannot be customized without configuring
 *     custom SMTP (a Supabase platform restriction on the default/shared
 *     mailer), so this flow deliberately uses Supabase's *default*
 *     link-based "Confirm signup" template rather than a typed 6-digit
 *     code (which would need a customized {{ .Token }} template).
 *  3. The user clicks the confirmation link in their email. Supabase
 *     verifies it server-side and redirects back to emailRedirectTo with
 *     the new session's tokens in the URL fragment. The Supabase client
 *     (detectSessionInUrl: true, see @/lib/supabase) picks this up
 *     automatically — no code for us to parse. Supabase owns the token
 *     generation, expiry, and rate-limiting, so none of that
 *     security-sensitive logic is custom code we have to maintain.
 *  4. On mount, we check for an existing, confirmed session matching the
 *     invited email (covers both the redirect-back case and a same-tab
 *     reload after clicking the link). If found, we skip straight to the
 *     "verified" screen. Until then, the team member stays 'pending' —
 *     nothing marks them 'accepted' before this confirmation happens.
 *  5. A final "Sign In & Join Project" click calls POST /api/invite/accept
 *     (which independently re-verifies the confirmed email server-side)
 *     to activate access scoped to exactly this one project.
 *  6. If the email already belongs to a confirmed account (e.g. invited to
 *     a second project), signUp() reports that without leaking whether the
 *     account exists via an error — we detect it and switch to a plain
 *     sign-in form instead, since no new confirmation is needed for an
 *     account that's already confirmed.
 */
import { useEffect, useState } from 'react';
import styles from './InviteAcceptPage.module.css';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { setInviteSession } from '@/services/inviteSession';
import { getProject } from '@/db/projectRepository';
import AppLogo from '@/components/common/AppLogo';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined ?? 'http://localhost:3001').replace(/\/$/, '');

/**
 * Supabase's auth client sometimes falls back to stringifying a raw,
 * non-standard error body as `.message` (e.g. when the Auth server 500s
 * instead of returning a proper 4xx with a message field) -- that produces
 * unreadable text like "{}" on screen. Detect that case and show a fallback
 * that actually tells the user (and us) something useful instead.
 */
function friendlyAuthError(
  error: { message?: string; status?: number } | null | undefined,
  fallback: string
): string {
  const msg = error?.message?.trim();
  const looksUnreadable = !msg || msg.startsWith('{') || msg.startsWith('[');
  if (looksUnreadable) {
    return error?.status
      ? `${fallback} (server error ${error.status}). This usually means email delivery isn't configured for this project yet — please contact the project owner.`
      : fallback;
  }
  return msg;
}

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
  | { status: 'awaiting-confirmation'; invite: InviteInfo; error?: string }
  | { status: 'checking-confirmation'; invite: InviteInfo }
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
  const [resendMsg, setResendMsg] = useState('');

  // The exact URL Supabase should redirect back to once the invitee clicks
  // the confirmation link in their email — this same invite page, so the
  // effect below can pick up the now-confirmed session and continue.
  function buildInviteRedirectUrl(): string {
    return window.location.origin + window.location.pathname + window.location.search;
  }

  // True when the current Supabase session (if any) belongs to this exact
  // invited email and has actually completed email confirmation. Used both
  // on mount (redirect-back / same-tab-reload case) and from the manual
  // "I've confirmed" button (different-tab case).
  async function getConfirmedSessionForInvite(invitedEmail: string | null): Promise<boolean> {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user || !invitedEmail) return false;
    return (
      user.email?.toLowerCase() === invitedEmail.toLowerCase() &&
      Boolean(user.email_confirmed_at)
    );
  }

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: 'No invite token found in this link.' });
      return;
    }
    // Everything past this point (signUp, signInWithPassword, resend, session checks) needs
    // a real Supabase client. Without VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY set for this
    // build, @/lib/supabase falls back to a placeholder URL and every one of those calls
    // fails as an opaque "Failed to fetch" — so check this up front and fail with a message
    // that actually says what's wrong, the same way SignUpPage already does.
    if (!isSupabaseConfigured) {
      console.error(
        '[InviteAcceptPage] Supabase is not configured for this build (missing VITE_SUPABASE_URL ' +
        'and/or VITE_SUPABASE_ANON_KEY). The invite form cannot verify an email without it.'
      );
      setState({
        status: 'error',
        message: 'Email verification is not configured for this deployment yet. Please contact the project owner.',
      });
      return;
    }
    fetch(`${API_URL}/invite/validate?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(async (data) => {
        if (data.error) {
          setState({ status: 'error', message: data.error });
          return;
        }
        const invite = data as InviteInfo;
        // Covers returning from the confirmation link (Supabase redirected back
        // here with tokens in the URL, auto-detected by the client) as well as
        // a plain reload after confirming earlier in the same browser.
        const alreadyConfirmed = await getConfirmedSessionForInvite(invite.invitedEmail);
        setState(alreadyConfirmed ? { status: 'verified', invite } : { status: 'form', invite, mode: 'signup' });
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
      let data: Awaited<ReturnType<typeof supabase.auth.signUp>>['data'];
      let error: Awaited<ReturnType<typeof supabase.auth.signUp>>['error'];
      try {
        ({ data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: buildInviteRedirectUrl() },
        }));
      } catch (err) {
        // A thrown (not returned) error here means the request never completed at the
        // network layer — CSP blocking the Supabase domain, the Supabase project being
        // paused, or connectivity issues. Surface it instead of leaving the button stuck
        // on "Sending confirmation email..." forever.
        console.error('[InviteAcceptPage] signUp() network failure:', err);
        setState({
          status: 'form',
          invite,
          mode: 'signup',
          error: 'Could not reach the authentication service. Check your connection and try again, or contact the project owner if this keeps happening.',
        });
        return;
      }

      if (error) {
        setState({
          status: 'form',
          invite,
          mode: 'signup',
          error: friendlyAuthError(error, 'Could not send the verification email. Please try again.'),
        });
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
        // account is already active and signed in, so skip the confirmation step.
        void finishAccepting(invite);
        return;
      }

      setState({ status: 'awaiting-confirmation', invite });
    } else {
      if (!password) {
        setState({ ...state, error: 'Enter your password.' });
        return;
      }
      setState({ status: 'submitting', invite, mode: 'signin' });
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setState({
            status: 'form',
            invite,
            mode: 'signin',
            error: friendlyAuthError(error, 'Could not sign in. Please check your password and try again.'),
          });
          return;
        }
      } catch (err) {
        console.error('[InviteAcceptPage] signInWithPassword() network failure:', err);
        setState({
          status: 'form',
          invite,
          mode: 'signin',
          error: 'Could not reach the authentication service. Check your connection and try again.',
        });
        return;
      }
      void finishAccepting(invite);
    }
  }

  // For the case where the confirmation link was opened in a different tab
  // or device than the one showing this form — there's no automatic signal
  // that confirmation happened elsewhere, so this lets the invitee manually
  // re-check once they've clicked the link.
  async function checkConfirmation() {
    if (state.status !== 'awaiting-confirmation') return;
    const invite = state.invite;
    setState({ status: 'checking-confirmation', invite });
    const confirmed = await getConfirmedSessionForInvite(invite.invitedEmail).catch(() => false);
    if (confirmed) {
      setState({ status: 'verified', invite });
    } else {
      setState({
        status: 'awaiting-confirmation',
        invite,
        error: "Not confirmed yet — click the link in your email first, using the same browser you're viewing this page in.",
      });
    }
  }

  async function resendCode() {
    if (state.status !== 'awaiting-confirmation') return;
    setResendMsg('Sending…');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: state.invite.invitedEmail ?? '',
        options: { emailRedirectTo: buildInviteRedirectUrl() },
      });
      setResendMsg(error ? friendlyAuthError(error, 'Could not resend the confirmation email.') : 'A new confirmation email is on its way.');
    } catch (err) {
      console.error('[InviteAcceptPage] resend() network failure:', err);
      setResendMsg('Could not reach the authentication service. Check your connection and try again.');
    }
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
                  ? (state.mode === 'signup' ? 'Sending confirmation email…' : 'Signing in…')
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

        {(state.status === 'awaiting-confirmation' || state.status === 'checking-confirmation') && (
          <>
            <div className={styles.successIcon}>✉</div>
            <h1 className={styles.heading}>Check your email</h1>
            <p className={styles.sub}>
              We sent a confirmation link to <strong>{state.invite.invitedEmail}</strong>. Click it to confirm your
              email — you'll be brought right back here to finish joining the project. Until you confirm, you
              won't be added as an active team member.
            </p>

            {state.status === 'awaiting-confirmation' && state.error && (
              <p className={styles.errorMsg}>{state.error}</p>
            )}

            <button
              className={styles.acceptBtn}
              type="button"
              onClick={checkConfirmation}
              disabled={state.status === 'checking-confirmation'}
            >
              {state.status === 'checking-confirmation' ? 'Checking…' : "I've confirmed — Continue"}
            </button>

            <p className={styles.switchModeText}>
              Didn't get it? <button type="button" className={styles.linkBtn} onClick={resendCode} disabled={state.status === 'checking-confirmation'}>Resend email</button>
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
