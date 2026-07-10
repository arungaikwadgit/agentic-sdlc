// tests/unit/ForcedPasswordChange.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForcedPasswordChange from '../../frontend/src/components/auth/ForcedPasswordChange';

const updateUserMock = vi.fn(async () => ({ error: null }));

vi.mock('../../frontend/src/lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
  },
}));

describe('ForcedPasswordChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserMock.mockResolvedValue({ error: null });
  });

  it('rejects a password shorter than 8 characters without calling supabase', async () => {
    render(<ForcedPasswordChange />);

    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords without calling supabase', async () => {
    render(<ForcedPasswordChange />);

    await userEvent.type(screen.getByLabelText('New password'), 'longenough1');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'longenough2');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('calls supabase.auth.updateUser with the new password and clears must_change_password', async () => {
    render(<ForcedPasswordChange />);

    await userEvent.type(screen.getByLabelText('New password'), 'longenough1');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(updateUserMock).toHaveBeenCalledWith({
      password: 'longenough1',
      data: { must_change_password: false },
    });
  });

  it('shows the error message when supabase.auth.updateUser fails', async () => {
    updateUserMock.mockResolvedValueOnce({ error: { message: 'Network error' } });
    render(<ForcedPasswordChange />);

    await userEvent.type(screen.getByLabelText('New password'), 'longenough1');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });
});
