// tests/unit/InviteAcceptPage-signin.test.tsx
// Covers the reworked InviteAcceptPage.tsx flow: the invitee signs in with
// the default password emailed at invite-send time (no more signUp/email
// confirmation round trip — see backend/src/proxy.js's provisionInviteeAccount()).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const signInWithPasswordMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
  isSupabaseConfigured: true,
}));

const setInviteSessionMock = vi.fn();
vi.mock('@/services/inviteSession', () => ({
  setInviteSession: (...args: unknown[]) => setInviteSessionMock(...args),
}));

const getProjectMock = vi.fn(async () => undefined);
vi.mock('@/db/projectRepository', () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
  buildApiUrl: (path: string) => `https://api.example.com${path.startsWith('/api') ? path : '/api' + path}`,
}));

const INVITE_INFO = {
  id: 'invite-1',
  role: 'Editor',
  invitedEmail: 'jane@example.com',
  expiresAt: null,
  project: { id: 'proj-1', name: 'Demo Project', description: '' },
};

import InviteAcceptPage from '@/components/invite/InviteAcceptPage';

function withToken(url: string) {
  window.history.pushState({}, '', `/invite?token=abc123&projectId=proj-1&email=jane%40example.com`);
  return url;
}

describe('InviteAcceptPage — sign in with default password', () => {
  beforeEach(() => {
    signInWithPasswordMock.mockReset();
    getSessionMock.mockReset();
    setInviteSessionMock.mockClear();
    getProjectMock.mockClear();
    window.sessionStorage.clear();
    withToken('/invite');

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/invite/validate')) {
        return { json: async () => INVITE_INFO } as Response;
      }
      if (String(url).includes('/invite/accept')) {
        return {
          json: async () => ({
            accessToken: 'session-token',
            projectId: 'proj-1',
            email: 'jane@example.com',
            appRole: 'editor',
            name: 'Jane Doe',
            expiresAt: Date.now() + 100000,
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  it('shows a single password field (no create-password / confirm-password fields)', async () => {
    render(<InviteAcceptPage />);

    expect(await screen.findByText("You've been invited!")).toBeInTheDocument();
    expect(screen.getByLabelText(/password \(from your invite email\)/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
  });

  it('signs in directly with the emailed password, then accepts the invite', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });

    const user = userEvent.setup();
    render(<InviteAcceptPage />);

    await screen.findByText("You've been invited!");
    await user.type(screen.getByLabelText(/password \(from your invite email\)/i), 'jane_080726a4c');
    await user.click(screen.getByRole('button', { name: /sign in & join project/i }));

    await waitFor(() => expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'jane@example.com',
      password: 'jane_080726a4c',
    }));

    expect(await screen.findByText('Welcome aboard!')).toBeInTheDocument();
    expect(setInviteSessionMock).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1' }));
  });

  it('shows an error and does not call accept when the password is wrong', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } });

    const user = userEvent.setup();
    render(<InviteAcceptPage />);

    await screen.findByText("You've been invited!");
    await user.type(screen.getByLabelText(/password \(from your invite email\)/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in & join project/i }));

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
    expect(setInviteSessionMock).not.toHaveBeenCalled();
  });

  it('requires a password before submitting', async () => {
    const user = userEvent.setup();
    render(<InviteAcceptPage />);

    await screen.findByText("You've been invited!");
    await user.click(screen.getByRole('button', { name: /sign in & join project/i }));

    expect(await screen.findByText(/enter the password/i)).toBeInTheDocument();
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });
});
