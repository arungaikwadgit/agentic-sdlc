// tests/unit/ResetPasswordPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResetPasswordPage from '../../frontend/src/components/auth/ResetPasswordPage';

const getSessionMock = vi.fn();
const updateUserMock = vi.fn(async () => ({ error: null }));

vi.mock('../../frontend/src/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
  },
}));

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserMock.mockResolvedValue({ error: null });
  });

  it('shows an expired-link message when there is no recovery session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    render(<ResetPasswordPage />);

    expect(await screen.findByText(/this link has expired/i)).toBeInTheDocument();
  });

  it('shows the new-password form when a recovery session is present', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'recovery-token' } } });
    render(<ResetPasswordPage />);

    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
  });

  it('submits the new password and clears must_change_password', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'recovery-token' } } });
    render(<ResetPasswordPage />);

    await screen.findByRole('heading', { name: 'Set a new password' });
    await userEvent.type(screen.getByLabelText('New password'), 'longenough1');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(updateUserMock).toHaveBeenCalledWith({
      password: 'longenough1',
      data: { must_change_password: false },
    });
    expect(await screen.findByText('Password updated')).toBeInTheDocument();
  });

  it('rejects a short password without calling supabase', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'recovery-token' } } });
    render(<ResetPasswordPage />);

    await screen.findByRole('heading', { name: 'Set a new password' });
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
