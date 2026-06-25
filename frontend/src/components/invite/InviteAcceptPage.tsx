/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * InviteAcceptPage — handles /invite?token=<hex> URLs.
 *
 * Flow:
 *  1. Fetch invite info from GET /api/invites/:token (no auth needed)
 *  2. If not logged in → show auth UI first, then resume
 *  3. POST /api/invites/:token/accept with the user's JWT
 *  4. Redirect to the project
 */
import { useEffect, useState } from 'react';
import styles from './InviteAcceptPage.module.css';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import LoginPage  from '@/components/auth/LoginPage';
import SignUpPage from '@/components/auth/SignUpPage';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined ?? 'http://localhost:3001');

type AuthView = 'login' | 'signup';

interface InviteInfo {
  id:           string;
  role:         string;
  invitedEmail: string | null;
  expiresAt:    string;
  project: {
    id:          string;
    name:        string;
    description: string;
  };
}

type State =
  | { status: 'loading' }
  | { status: 'ready';     invite: InviteInfo }
  | { status: 'needsAuth'; invite: InviteInfo; authView: AuthView }
  | { status: 'accepting' }
  | { status: 'done';      projectId: string; projectName: string }
  | { status: 'error';     message: string };

export default function InviteAcceptPage() {
  const { user } = useAuth();
  const params  = new URLSearchParams(window.location.search);
  const token   = params.get('token') ?? '';

  const [state, setState] = useState<State>({ status: 'loading' });

  // Step 1: load invite info
  useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: 'No invite token found in this link.' });
      return;
    }
    fetch(`${API_URL}/api/invites/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setState({ status: 'error', message: data.error });
        } else {
          setState({ status: 'ready', invite: data as InviteInfo });
        }
      })
      .catch(() => setState({ status: 'error', message: 'Could not connect to the server. Please try again.' }));
  }, [token]);

  // Step 2: if ready and user clicks Accept, check auth then call API
  async function accept() {
    if (state.status !== 'ready') return;
    const { invite } = state;

    // Require auth before accepting
    if (!user) {
      setState({ status: 'needsAuth', invite, authView: 'login' });
      return;
    }

    await doAccept(invite);
  }

  async function doAccept(invite: InviteInfo) {
    setState({ status: 'accepting' });

    const { data } = await supabase.auth.getSession();
    const token_jwt = data.session?.access_token;
    if (!token_jwt) {
      setState({ status: 'error', message: 'Not signed in — please sign in and try again.' });
      return;
    }

    const res = await fetch(`${API_URL}/api/invites/${token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token_jwt}`,
      },
    });
    const result = await res.json();
    if (result.error) {
      setState({ status: 'error', message: result.error });
    } else {
      setState({ status: 'done', projectId: result.projectId, projectName: invite.project.name });
    }
  }

  // After auth completes, auto-accept
  useEffect(() => {
    if (state.status === 'needsAuth' && user) {
      doAccept(state.invite);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Render auth gates ──────────────────────────────────────────────────────
  if (state.status === 'needsAuth') {
    if (state.authView === 'signup') {
      return (
        <SignUpPage
          onSuccess={() => setState({ ...state, authView: 'login' })}
          onSignIn={() => setState({ ...state, authView: 'login' })}
        />
      );
    }
    return (
      <LoginPage
        onSuccess={() => { /* user state change triggers the useEffect above */ }}
        onSignUp={() => setState({ ...state, authView: 'signup' })}
      />
    );
  }

  // ── Main invite card ───────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>⚡ Agentic SDLC</div>

        {state.status === 'loading' && (
          <div className={styles.center}>
            <div className={styles.spinner} />
            <p>Validating your invite…</p>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <h1 className={styles.heading}>You've been invited!</h1>
            <p className={styles.sub}>You've been invited to join</p>
            <div className={styles.projectName}>{state.invite.project.name}</div>
            <div className={styles.roleChip}>
              as <strong>{state.invite.role}</strong>
            </div>
            {state.invite.invitedEmail && (
              <p className={styles.emailNote}>
                Access will be linked to: <strong>{state.invite.invitedEmail}</strong>
              </p>
            )}
            <button className={styles.acceptBtn} onClick={accept}>
              Accept Invitation
            </button>
          </>
        )}

        {state.status === 'accepting' && (
          <div className={styles.center}>
            <div className={styles.spinner} />
            <p>Accepting…</p>
          </div>
        )}

        {state.status === 'done' && (
          <>
            <div className={styles.successIcon}>✓</div>
            <h1 className={styles.heading}>Welcome aboard!</h1>
            <p className={styles.sub}>
              You've joined <strong>{state.projectName}</strong>.
            </p>
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
