/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * ForcedPasswordChange — full-screen gate rendered by AuthGuard whenever the
 * signed-in user's user_metadata.must_change_password is true (set by
 * provisionInviteeAccount() in backend/src/proxy.js on a fresh invite accept
 * or an admin-triggered reset). Blocks the entire app behind a new-password
 * form until the user sets their own password.
 *
 * On success, AuthContext's onAuthStateChange listener picks up the updated
 * user automatically — no manual navigation/redirect needed here.
 */
import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import AppLogo from '@/components/common/AppLogo';
import styles from './AuthPage.module.css';

export default function ForcedPasswordChange() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
      data: { must_change_password: false },
    });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
    }
    // On success, AuthContext's onAuthStateChange listener refreshes `user`
    // with the cleared flag and this gate stops rendering automatically.
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <AppLogo wordmarkClassName={styles.logoText} />
        </div>

        <h1 className={styles.heading}>Set a new password</h1>
        <p className={styles.subheading}>
          For your security, please set your own password before continuing.
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
              placeholder="At least 8 characters"
              required
              autoFocus
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
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.primaryBtn} type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  );
}
