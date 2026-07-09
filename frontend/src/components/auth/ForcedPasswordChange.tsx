/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * ForcedPasswordChange — full-screen gate shown instead of the app whenever
 * the signed-in user's Supabase user_metadata.must_change_password is true.
 * Covers both paths that set that flag: a fresh invite accept and an
 * admin-triggered password reset (see AuthGuard.tsx for the gating check,
 * backend/src/proxy.js's provisionInviteeAccount() for where the flag is set).
 *
 * Clears the flag via supabase.auth.updateUser({ password, data: {...} }) —
 * a self-service call scoped to the caller's own session, no server route
 * needed. AuthContext's onAuthStateChange listener picks up the resulting
 * USER_UPDATED event and refreshes `user`, which lifts this gate
 * automatically once must_change_password flips to false.
 */
import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import AppLogo from '@/components/common/AppLogo';
import styles from './AuthPage.module.css';

const MIN_LENGTH = 8;

export default function ForcedPasswordChange() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
      data: { must_change_password: false },
    });
    setLoading(false);

    if (updateError) {
      setError(updateError.message || 'Could not update your password. Please try again.');
      return;
    }
    // No manual navigation needed — AuthContext's onAuthStateChange listener
    // updates `user` from the USER_UPDATED event, and AuthGuard re-renders
    // past this gate on its own once must_change_password is false.
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <AppLogo wordmarkClassName={styles.logoText} />
        </div>

        <h1 className={styles.heading}>Set a new password</h1>
        <p className={styles.subheading}>
          For security, you need to set your own password before continuing.
        </p>

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
              disabled={loading}
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
              disabled={loading}
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.primaryBtn} type="submit" disabled={loading}>
            {loading ? 'Updating…' : 'Set password & continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
