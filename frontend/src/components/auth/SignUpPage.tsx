/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * SignUpPage — email + password account creation.
 * Disabled when Supabase is not configured — use admin@local / admin instead.
 */
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { ADMIN_EMAIL } from '@/lib/adminMode';
import styles from './AuthPage.module.css';

interface Props {
  onSuccess: () => void;
  onSignIn:  () => void;
}

export default function SignUpPage({ onSuccess, onSignIn }: Props) {
  const { signUp } = useAuth();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isSupabaseConfigured) {
      setError(`Supabase is not configured. Use ${ADMIN_EMAIL} on the sign-in page for admin access.`);
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error } = await signUp(email, password);
    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      setDone(true);
      setTimeout(() => onSuccess(), 1200);
    }
  }

  if (done) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}>⚡</span>
            <span className={styles.logoText}>Agentic SDLC</span>
          </div>
          <h1 className={styles.heading}>Check your inbox</h1>
          <p className={styles.subheading}>
            We sent a confirmation link to <strong>{email}</strong>.<br />
            Click it to activate your account, then come back and sign in.
          </p>
          <button className={styles.primaryBtn} onClick={onSignIn} style={{ marginTop: '1.5rem' }}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>⚡</span>
          <span className={styles.logoText}>Agentic SDLC</span>
        </div>

        <h1 className={styles.heading}>Create an account</h1>
        <p className={styles.subheading}>Free forever for personal projects.</p>

        {!isSupabaseConfigured && (
          <div className={styles.configWarning}>
            ⚠️ Supabase not configured. Sign-up unavailable.{' '}
            <button className={styles.linkBtn} onClick={onSignIn}>Sign in with {ADMIN_EMAIL}</button> instead.
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
              disabled={!isSupabaseConfigured}
            />
          </label>

          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              disabled={!isSupabaseConfigured}
            />
          </label>

          <label className={styles.label}>
            Confirm password
            <input
              className={styles.input}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Same password again"
              required
              disabled={!isSupabaseConfigured}
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <button
            className={styles.primaryBtn}
            type="submit"
            disabled={loading || !isSupabaseConfigured}
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className={styles.switchText}>
          Already have an account?{' '}
          <button className={styles.linkBtn} onClick={onSignIn}>
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
