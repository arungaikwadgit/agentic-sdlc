// tests/unit/InviteAcceptPage-signin.test.tsx
// InviteAcceptPage now signs in directly with the default password emailed
// at invite time, instead of the old signUp()+email-confirmation flow.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteAcceptPage from '../../frontend/src/components/invite/InviteAcceptPage';

const signInWithPasswordMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock('../../frontend/src/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

vi.mock('../../frontend/src/db/projectRepository', () => ({
  buildApiUrl: (path: string) => `http://localhost:3001${path}`,
}));

const INVITE_INFO = {
  id: 'invite-1',
  role: 'Editor',
  invitedEmail: 'jane@example.com',
  expiresAt: null,
  project: { id: 'proj-1', name: 'Test Project', description: '' },
};

describe('InviteAcceptPage — sign in with default password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/invite?token=abc123');
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/accept')) {
        return { json: async () => ({ projectId: 'proj-1' }) } as Response;
      }
      return { json: async () => INVITE_INFO } as Response;
    }) as unknown as typeof fetch;
    signInWithPasswordMock.mockResolvedValue({ error: null });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'jwt-token' } } });
  });

  it('shows a single password field (no confirm-password / create-password fields)', async () => {
    render(<InviteAcceptPage />);

    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
  });

  it('requires a password before submitting', async () => {
    render(<InviteAcceptPage />);
    await screen.findByLabelText('Password');

    await userEvent.click(screen.getByRole('button', { name: /sign in & join project/i }));

    expect(await screen.findByText(/enter the password/i)).toBeInTheDocument();
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it('calls signInWithPassword with the invited email and entered password, then accepts', async () => {
    render(<InviteAcceptPage />);
    await screen.findByLabelText('Password');

    await userEvent.type(screen.getByLabelText('Password'), 'jane_090726a4c');
    await userEvent.click(screen.getByRole('button', { name: /sign in & join project/i }));

    await waitFor(() => expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'jane@example.com',
      password: 'jane_090726a4c',
    }));

    expect(await screen.findByText('Welcome aboard!')).toBeInTheDocument();
  });

  it('shows an error and does not accept when sign-in fails', async () => {
    signInWithPasswordMock.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    render(<InviteAcceptPage />);
    await screen.findByLabelText('Password');

    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in & join project/i }));

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
  });
});
