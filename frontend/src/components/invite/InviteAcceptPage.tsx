/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * InviteAcceptPage — handles /invite?token=<hex> URLs.
 *
 * Flow (default-password model):
 *  1. Fetch invite info from GET /api/invites/:token (no auth needed).
 *  2. The invitee's Supabase Auth account was already created server-side
 *     when the invite was sent (provisionInviteeAccount() in
 *     backend/src/proxy.js), with a generated default password emailed to
 *     them and user_metadata.must_change_password: true — so there's no
 *     signUp()/email-confirmation step here anymore. The form just asks for
 *     that password and calls supabase.auth.signInWithPassword() directly.
 *  3. On successful sign-in, finishAccepting() POSTs the session JWT to
 *     /api/invite/:token/accept (which independently re-verifies the
 *     session's email server-side) to activate access scoped to exactly
 *     this one project.
 *  4. Once signed in with must_change_password still set, AuthGuard renders
 *     ForcedPasswordChange on every subsequent route until the invitee sets
 *     their own password — this page doesn't need to handle that itself.
 */
import { useEffect, useState } from 'react';
import styles from './InviteAcceptPage.module.css';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { buildApiUrl } from '@/db/projectRepository';
import AppLogo from '@/components/common/AppLogo';

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

type State =
  | { status: 'loading' }
  | { status: 'form'; invite: InviteInfo; error?: string }
  | { status: 'submitting'; invite: InviteInfo }
  | { status: 'accepting' }
  | { status: 'done'; projectId: string; projectName: string }
  | { status: 'error'; message: string };

const INVITE_TOKEN_STORAGE_KEY = 'sdlc:invite-accept-token';

export default function InviteAcceptPage() {
  // Persisted to sessionStorage the moment we first see it in the URL, and
  // read back from there if the URL's ?token=... is later missing (e.g. a
  // reload after Supabase touches the URL for an unrelated reason).
  const [token] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('token');
    if (fromUrl) {
      try { window.sessionStorage.setItem(INVITE_TOKEN_STORAGE_KEY, fromUrl); } catch { /* ignore */ }
      return fromUrl;
    }
    try { return window.sessionStorage.getItem(INVITE_TOKEN_STORAGE_KEY) ?? ''; } catch { return ''; }
  });

  const [state, setState] = useState<State>({ status: 'loading' });
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: 'No invite token found in this link.' });
      return;
    }
    // Signing in below needs a real Supabase client. Without
    // VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY set for this build,
    // @/lib/supabase falls back to a placeholder URL and signInWithPassword
    // fails as an opaque "Failed to fetch" — check this up front instead.
    if (!isSupabaseConfigured) {
      console.error(
        '[InviteAcceptPage] Supabase is not configured for this build (missing VITE_SUPABASE_URL ' +
        'and/or VITE_SUPABASE_ANON_KEY). The invite form cannot sign in without it.'
      );
      setState({
        status: 'error',
        message: 'Sign-in is not configured for this deployment yet. Please contact the project owner.',
      });
      return;
    }
    fetch(buildApiUrl(`/api/invite/validate?token=${encodeURIComponent(token)}`))
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setState({ status: 'error', message: data.error });
          return;
        }
        setState({ status: 'form', invite: data as InviteInfo });
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

      const res = await fetch(buildApiUrl('/api/invite/accept'), {
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

    if (!password) {
      setState({ ...state, error: 'Enter the password from your invite email.' });
      return;
    }

    setState({ status: 'submitting', invite });
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setState({
          status: 'form',
          invite,
          error: friendlyAuthError(error, 'Could not sign in. Please check your password and try again.'),
        });
        return;
      }
    } catch (err) {
      console.error('[InviteAcceptPage] signInWithPassword() network failure:', err);
      setState({
        status: 'form',
        invite,
        error: 'Could not reach the authentication service. Check your connection and try again.',
      });
      return;
    }
    void finishAccepting(invite);
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
              Use the password from your invite email — you'll be asked to set your own on first sign-in.
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

              <label className={styles.fieldLabel} htmlFor="invite-password">Password</label>
              <input
                id="invite-password"
                className={styles.fieldInput}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="e.g. jane_080726a4c"
                autoFocus
                disabled={state.status === 'submitting'}
              />

              {state.status === 'form' && state.error && (
                <p className={styles.errorMsg}>{state.error}</p>
              )}

              <button className={styles.acceptBtn} type="submit" disabled={state.status === 'submitting'}>
                {state.status === 'submitting' ? 'Signing in…' : 'Sign In & Join Project'}
              </button>
            </form>
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
