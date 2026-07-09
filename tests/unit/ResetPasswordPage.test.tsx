// tests/unit/ResetPasswordPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getSessionMock = vi.fn();
const updateUserMock = vi.fn(async () => ({ data: {}, error: null }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
  },
  isSupabaseConfigured: true,
}));

import ResetPasswordPage from '@/components/auth/ResetPasswordPage';

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    updateUserMock.mockClear();
    updateUserMock.mockResolvedValue({ data: {}, error: null });
  });

  it('shows an invalid-link message when there is no recovery session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    render(<ResetPasswordPage />);

    expect(await screen.findByText(/reset link isn't valid/i)).toBeInTheDocument();
  });

  it('shows the new-password form when a recovery session exists', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'recovery-token' } } });
    render(<ResetPasswordPage />);

    expect(await screen.findByRole('button', { name: /set new password/i })).toBeInTheDocument();
  });

  it('submits a new password and clears must_change_password', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'recovery-token' } } });
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await screen.findByRole('button', { name: /set new password/i });
    await user.type(screen.getByLabelText('New password'), 'freshPassword1');
    await user.type(screen.getByLabelText('Confirm new password'), 'freshPassword1');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({
      password: 'freshPassword1',
      data: { must_change_password: false },
    }));
    expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
  });

  it('rejects mismatched passwords without calling Supabase', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'recovery-token' } } });
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await screen.findByRole('button', { name: /set new password/i });
    await user.type(screen.getByLabelText('New password'), 'freshPassword1');
    await user.type(screen.getByLabelText('Confirm new password'), 'differentPassword');
    await user.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
