/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * InviteAcceptPage — handles /invite?token=<hex> URLs.
 *
 * Flow:
 *  1. Fetch invite info from GET /api/invite/validate (no auth needed)
 *  2. Activate a project-scoped invite session from POST /api/invite/accept
 *  3. Cache the invited project locally so the workspace can open immediately
 *  4. Redirect to the invited project only
 */
import { useEffect, useState } from 'react';
import styles from './InviteAcceptPage.module.css';
import { useAuth } from '@/contexts/AuthContext';
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

type State =
  | { status: 'loading' }
  | { status: 'ready'; invite: InviteInfo }
  | { status: 'accepting' }
  | { status: 'done'; projectId: string; projectName: string }
  | { status: 'error'; message: string };

export default function InviteAcceptPage() {
  const { user } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';

  const [state, setState] = useState<State>({ status: 'loading' });

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
          setState({ status: 'ready', invite: data as InviteInfo });
        }
      })
      .catch(() => setState({ status: 'error', message: 'Could not connect to the server. Please try again.' }));
  }, [token]);

  async function accept() {
    if (state.status !== 'ready') return;
    setState({ status: 'accepting' });

    try {
      const { data } = await supabase.auth.getSession();
      const jwt = data.session?.access_token;

      const res = await fetch(`${API_URL}/invite/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({
          token,
          email: user?.email ?? state.invite.invitedEmail ?? '',
        }),
      });

      const result = await res.json();
      if (result.error) {
        setState({ status: 'error', message: result.error });
        return;
      }

      const resolvedEmail = (result.email ?? user?.email ?? state.invite.invitedEmail ?? '').toLowerCase();

      setInviteSession({
        token: result.accessToken ?? token,
        projectId: result.projectId,
        email: resolvedEmail,
        appRole: result.appRole,
        name: result.name,
        expiresAt: typeof result.expiresAt === 'string'
          ? Date.parse(result.expiresAt)
          : (typeof result.expiresAt === 'number' ? result.expiresAt : undefined),
      });

      await getProject(result.projectId).catch(() => undefined);

      setState({
        status: 'done',
        projectId: result.projectId,
        projectName: state.invite.project.name,
      });
    } catch {
      setState({ status: 'error', message: 'Could not activate this invite. Please try again.' });
    }
  }

  useEffect(() => {
    if (state.status !== 'done') return;
    const timer = window.setTimeout(() => {
      window.location.href = `/?project=${encodeURIComponent(state.projectId)}`;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [state]);

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
                This link is reserved for: <strong>{state.invite.invitedEmail}</strong>
              </p>
            )}
            <p className={styles.sub}>
              Accepting this link gives access only to this project and only with the assigned role.
            </p>
            <button className={styles.acceptBtn} onClick={accept}>
              Accept Invitation
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