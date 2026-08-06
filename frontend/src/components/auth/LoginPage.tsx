/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 *
 * LoginPage - email + password sign-in, plus a self-service "forgot
 * password" mode (Supabase resetPasswordForEmail -> /reset-password, see
 * AuthContext.tsx's sendPasswordReset() and ResetPasswordPage.tsx).
 * Uses Supabase auth in production and keeps local admin bypass in development only.
 */
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ADMIN_BYPASS_ENABLED, ADMIN_EMAIL } from '@/lib/adminMode';
import AppLogo from '@/components/common/AppLogo';
import styles from './AuthPage.module.css';

interface Props {
  onSuccess: () => void;
  onSignUp: () => void;
}

type Mode = 'signin' | 'forgot';

export default function LoginPage({ onSuccess }: Props) {
  const { signIn, sendPasswordReset } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

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

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await sendPasswordReset(email);
    setLoading(false);
    // Always show the same confirmation regardless of error — Supabase
    // itself doesn't distinguish "no such account" from "sent" for this
    // call, and surfacing a different message here would defeat that.
    if (error) {
      console.error('[LoginPage] sendPasswordReset failed:', error.message);
    }
    setResetSent(true);
  }

  function switchToForgot() {
    setError(null);
    setResetSent(false);
    setMode('forgot');
  }

  function switchToSignIn() {
    setError(null);
    setResetSent(false);
    setMode('signin');
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <AppLogo wordmarkClassName={styles.logoText} />
        </div>

        {mode === 'signin' && (
          <>
            <h1 className={styles.heading}>Sign in</h1>
            <p className={styles.subheading}>Welcome back - let&apos;s build something.</p>
            {ADMIN_BYPASS_ENABLED && (
              <p className={styles.subheading}>Local admin sign-in is enabled for development as {ADMIN_EMAIL}.</p>
            )}

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
                  placeholder="........"
                  required
                />
              </label>

              {error && <p className={styles.error}>{error}</p>}

              <button className={styles.primaryBtn} type="submit" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <p className={styles.switchText}>
              <button type="button" className={styles.linkBtn} onClick={switchToForgot}>
                Forgot password?
              </button>
            </p>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <h1 className={styles.heading}>Reset your password</h1>
            <p className={styles.subheading}>
              Enter your email and we'll send you a link to set a new password.
            </p>

            {resetSent ? (
              <>
                <p className={styles.subheading}>
                  If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your inbox.
                </p>
                <button type="button" className={styles.primaryBtn} onClick={switchToSignIn}>
                  Back to sign in
                </button>
              </>
            ) : (
              <form onSubmit={handleForgotSubmit} className={styles.form}>
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

                {error && <p className={styles.error}>{error}</p>}

                <button className={styles.primaryBtn} type="submit" disabled={loading}>
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>

                <p className={styles.switchText}>
                  <button type="button" className={styles.linkBtn} onClick={switchToSignIn}>
                    Back to sign in
                  </button>
                </p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
