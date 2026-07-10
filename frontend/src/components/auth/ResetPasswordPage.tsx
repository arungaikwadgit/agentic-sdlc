/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * ResetPasswordPage — landing page for /reset-password, the redirectTo
 * target of both AuthContext.tsx's sendPasswordReset() (self-service
 * "forgot password") and Supabase's own password-recovery email link.
 *
 * Supabase's client (detectSessionInUrl: true, see @/lib/supabase) parses
 * the recovery tokens from the URL and establishes a short-lived session
 * before this component's effect runs — no manual token handling needed
 * here, just a getSession() check.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import AppLogo from '@/components/common/AppLogo';
import styles from './AuthPage.module.css';

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

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setStatus('submitting');
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
      data: { must_change_password: false },
    });

    if (updateError) {
      setError(updateError.message);
      setStatus('ready');
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
            <h1 className={styles.heading}>Checking your link...</h1>
            <p className={styles.subheading}>One moment.</p>
          </>
        )}

        {status === 'no-session' && (
          <>
            <h1 className={styles.heading}>This link has expired</h1>
            <p className={styles.subheading}>
              Password reset links are only valid for a short time. Please request a new one from the sign-in page.
            </p>
            <a href="/" className={styles.primaryBtn} style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Back to sign in
            </a>
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
                  placeholder="At least 8 characters"
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
                {status === 'submitting' ? 'Saving...' : 'Set password'}
              </button>
            </form>
          </>
        )}

        {status === 'done' && (
          <>
            <h1 className={styles.heading}>Password updated</h1>
            <p className={styles.subheading}>Your password has been changed. You can now sign in.</p>
            <a href="/" className={styles.primaryBtn} style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Back to sign in
            </a>
          </>
        )}
      </div>
    </div>
  );
}
