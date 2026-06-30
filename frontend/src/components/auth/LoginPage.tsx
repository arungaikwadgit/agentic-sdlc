/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * LoginPage — email + password sign-in.
 * Supports both Supabase auth and the local admin bypass (admin@local / admin).
 */
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { ADMIN_EMAIL } from '@/lib/adminMode';
import styles from './AuthPage.module.css';

interface Props {
  onSuccess: () => void;
  onSignUp:  () => void;
}

export default function LoginPage({ onSuccess, onSignUp }: Props) {
  const { signIn } = useAuth();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      onSuccess();
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>⚡</span>
          <span className={styles.logoText}>Agentic SDLC</span>
        </div>

        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.subheading}>Welcome back — let's build something.</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
            <input
              className={styles.input}
              type="text"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
            />
          </label>

          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.primaryBtn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className={styles.adminHint}>
          {isSupabaseConfigured
            ? <>Admin access is configured for <code>{ADMIN_EMAIL}</code>.</>
            : <>Local access: <code>{ADMIN_EMAIL}</code> / <code>admin</code></>}
          {!isSupabaseConfigured && ' · Supabase not configured'}
        </p>

        <p className={styles.switchText}>
          Don't have an account?{' '}
          <button className={styles.linkBtn} onClick={onSignUp} disabled={!isSupabaseConfigured}>
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}
