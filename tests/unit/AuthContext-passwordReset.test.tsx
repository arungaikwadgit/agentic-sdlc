// tests/unit/AuthContext-passwordReset.test.tsx
// Tests the real AuthProvider/useAuth implementation's new sendPasswordReset()
// method — unmocks the global @/contexts/AuthContext stub from
// frontend/vitest.setup.ts (which every other test file relies on) so this
// file alone exercises the actual hook logic against a mocked Supabase client.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.unmock('@/contexts/AuthContext');

const resetPasswordForEmailMock = vi.fn(async () => ({ error: null }));
const getSessionMock = vi.fn(async () => ({ data: { session: null } }));
const onAuthStateChangeMock = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmailMock(...args),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('@/lib/adminMode', () => ({
  isAdminMode: () => false,
  setAdminMode: vi.fn(),
  ADMIN_USER_ID: 'admin-id',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'admin-pass',
  ADMIN_BYPASS_ENABLED: false,
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';

function Harness() {
  const { sendPasswordReset } = useAuth();
  return (
    <button onClick={() => void sendPasswordReset('jane@example.com')}>
      Send reset
    </button>
  );
}

describe('AuthContext.sendPasswordReset', () => {
  beforeEach(() => {
    resetPasswordForEmailMock.mockClear();
  });

  it('calls supabase.auth.resetPasswordForEmail with the email and a /reset-password redirect', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText('Send reset')).toBeInTheDocument());
    await user.click(screen.getByText('Send reset'));

    await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalledTimes(1));
    const [email, options] = resetPasswordForEmailMock.mock.calls[0];
    expect(email).toBe('jane@example.com');
    expect(options.redirectTo).toMatch(/\/reset-password$/);
  });

  it('resolves with the error Supabase returns, without throwing', async () => {
    resetPasswordForEmailMock.mockResolvedValueOnce({ error: { message: 'rate limited' } });
    let captured: { error: { message: string } | null } | undefined;

    function CaptureHarness() {
      const { sendPasswordReset } = useAuth();
      return (
        <button onClick={async () => { captured = await sendPasswordReset('jane@example.com'); }}>
          Send
        </button>
      );
    }

    const user = userEvent.setup();
    render(
      <AuthProvider>
        <CaptureHarness />
      </AuthProvider>
    );
    await user.click(screen.getByText('Send'));

    await waitFor(() => expect(captured?.error?.message).toBe('rate limited'));
  });
});
