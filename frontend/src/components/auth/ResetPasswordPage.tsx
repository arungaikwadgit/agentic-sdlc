/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * ResetPasswordPage — handles /reset-password, the landing page Supabase
 * redirects back to after a user clicks the link from
 * supabase.auth.resetPasswordForEmail() (see AuthContext.tsx's
 * sendPasswordReset() and LoginPage.tsx's "Forgot password?" flow).
 *
 * The Supabase client (detectSessionInUrl: true, see @/lib/supabase) parses
 * the recovery token out of the URL fragment at module-init time and
 * establishes a short-lived session before this component even mounts —
 * so by the time we render, supabase.auth.getSession() should already
 * resolve to that recovery session. If it doesn't (link expired, opened in
 * a browser with no matching client-side state, or Supabase not configured
 * for this build), show an error instead of a broken form.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import AppLogo from '@/components/common/AppLogo';
import styles from './AuthPage.module.css';

const MIN_LENGTH = 8;

type Status = 'checking' | 'ready' | 'no-session' | 'submitting' | 'done';

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<Status>('checking');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setStatus('no-session');
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setStatus(data.session ? 'ready' : 'no-session');
    });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setStatus('submitting');
    // Clears must_change_password too — a self-chosen reset password
    // doesn't need a forced-change step the way a default password does.
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
      data: { must_change_password: false },
    });
    if (updateError) {
      setStatus('ready');
      setError(updateError.message || 'Could not update your password. Please try again.');
      return;
    }
    setStatus('done');
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <AppLogo wordmarkClassName={styles.logoText} />
        </div>

        {status === 'checking' && (
          <>
            <h1 className={styles.heading}>Checking your link…</h1>
          </>
        )}

        {status === 'no-session' && (
          <>
            <h1 className={styles.heading}>This reset link isn't valid</h1>
            <p className={styles.subheading}>
              It may have expired or already been used. Request a new one from the sign-in page.
            </p>
            <a href="/" className={styles.linkBtn}>Back to sign in</a>
          </>
        )}

        {(status === 'ready' || status === 'submitting') && (
          <>
            <h1 className={styles.heading}>Set a new password</h1>
            <p className={styles.subheading}>Choose a new password for your account.</p>

            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                New password
                <input
                  className={styles.input}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={`At least ${MIN_LENGTH} characters`}
                  required
                  autoFocus
                  disabled={status === 'submitting'}
                />
              </label>

              <label className={styles.label}>
                Confirm new password
                <input
                  className={styles.input}
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  required
                  disabled={status === 'submitting'}
                />
              </label>

              {error && <p className={styles.error}>{error}</p>}

              <button className={styles.primaryBtn} type="submit" disabled={status === 'submitting'}>
                {status === 'submitting' ? 'Updating…' : 'Set new password'}
              </button>
            </form>
          </>
        )}

        {status === 'done' && (
          <>
            <h1 className={styles.heading}>Password updated</h1>
            <p className={styles.subheading}>You're signed in with your new password.</p>
            <a href="/" className={styles.primaryBtn} style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>
              Continue
            </a>
          </>
        )}
      </div>
    </div>
  );
}
