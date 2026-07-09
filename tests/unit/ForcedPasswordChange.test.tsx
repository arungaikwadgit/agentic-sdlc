// tests/unit/ForcedPasswordChange.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updateUserMock = vi.fn(async () => ({ data: {}, error: null }));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { updateUser: (...args: unknown[]) => updateUserMock(...args) } },
}));

import ForcedPasswordChange from '@/components/auth/ForcedPasswordChange';

describe('ForcedPasswordChange', () => {
  beforeEach(() => {
    updateUserMock.mockClear();
    updateUserMock.mockResolvedValue({ data: {}, error: null });
  });

  it('rejects a password shorter than 8 characters without calling Supabase', async () => {
    const user = userEvent.setup();
    render(<ForcedPasswordChange />);

    await user.type(screen.getByLabelText('New password'), 'short1');
    await user.type(screen.getByLabelText('Confirm new password'), 'short1');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords without calling Supabase', async () => {
    const user = userEvent.setup();
    render(<ForcedPasswordChange />);

    await user.type(screen.getByLabelText('New password'), 'longenough1');
    await user.type(screen.getByLabelText('Confirm new password'), 'longenough2');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('calls supabase.auth.updateUser with the new password and clears must_change_password', async () => {
    const user = userEvent.setup();
    render(<ForcedPasswordChange />);

    await user.type(screen.getByLabelText('New password'), 'brandNewPassword1');
    await user.type(screen.getByLabelText('Confirm new password'), 'brandNewPassword1');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({
      password: 'brandNewPassword1',
      data: { must_change_password: false },
    }));
  });

  it('shows an error message and does not crash when Supabase rejects the update', async () => {
    updateUserMock.mockResolvedValueOnce({ data: null, error: { message: 'Session expired' } });
    const user = userEvent.setup();
    render(<ForcedPasswordChange />);

    await user.type(screen.getByLabelText('New password'), 'brandNewPassword1');
    await user.type(screen.getByLabelText('Confirm new password'), 'brandNewPassword1');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Session expired')).toBeInTheDocument();
  });
});
