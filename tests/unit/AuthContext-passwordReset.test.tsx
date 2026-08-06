// tests/unit/AuthContext-passwordReset.test.tsx
// Real-component test for AuthContext.tsx's sendPasswordReset() — the
// self-service "forgot password" call that wraps
// supabase.auth.resetPasswordForEmail() with a redirectTo pointed at
// /reset-password (see lib/resetPasswordRoute.ts and ResetPasswordPage.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth, AuthProvider } from '../../frontend/src/contexts/AuthContext';

const resetPasswordForEmailMock = vi.fn(async () => ({ error: null }));
const getSessionMock = vi.fn(async () => ({ data: { session: null } }));
const onAuthStateChangeMock = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));

vi.mock('../../frontend/src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmailMock(...args),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('../../frontend/src/lib/adminMode', () => ({
  isAdminMode: () => false,
  setAdminMode: vi.fn(),
  ADMIN_USER_ID: '__admin_local__',
  ADMIN_EMAIL: 'admin@local',
  ADMIN_PASSWORD: 'admin',
  ADMIN_BYPASS_ENABLED: false,
}));

function Probe() {
  const { sendPasswordReset } = useAuth();
  return (
    <button onClick={() => sendPasswordReset('jane@example.com')}>
      Send reset
    </button>
  );
}

describe('AuthContext.sendPasswordReset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { session: null } });
    resetPasswordForEmailMock.mockResolvedValue({ error: null });
  });

  it('calls supabase.auth.resetPasswordForEmail with a /reset-password redirectTo', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await userEvent.click(screen.getByText('Send reset'));

    await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalledTimes(1));
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
      'jane@example.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('/reset-password') })
    );
  });

  it('returns the error from Supabase without throwing', async () => {
    resetPasswordForEmailMock.mockResolvedValueOnce({ error: { message: 'rate limited' } });
    let captured: { error: { message: string } | null } | undefined;

    function Capture() {
      const { sendPasswordReset } = useAuth();
      return (
        <button onClick={async () => { captured = await sendPasswordReset('jane@example.com'); }}>
          Go
        </button>
      );
    }

    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>
    );

    await userEvent.click(screen.getByText('Go'));

    await waitFor(() => expect(captured?.error?.message).toBe('rate limited'));
  });
});
