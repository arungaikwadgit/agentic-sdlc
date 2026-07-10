// tests/unit/AuthGuard-forcePasswordChange.test.tsx
// Tests AuthGuard.tsx's mustChangePassword gate: any real (non-admin-bypass)
// session with user_metadata.must_change_password === true should render
// ForcedPasswordChange instead of the app's children, on any route.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import AuthGuard from '../../frontend/src/components/auth/AuthGuard';

const useAuthMock = vi.fn();

vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../frontend/src/lib/inviteRoute', () => ({
  isInviteRoute: () => false,
}));

vi.mock('../../frontend/src/lib/resetPasswordRoute', () => ({
  isResetPasswordRoute: () => false,
}));

vi.mock('../../frontend/src/components/auth/ForcedPasswordChange', () => ({
  default: () => <div data-testid="forced-password-change">Set a new password</div>,
}));

vi.mock('../../frontend/src/components/auth/LoginPage', () => ({
  default: () => <div data-testid="login-page">Login</div>,
}));

vi.mock('../../frontend/src/components/auth/SignUpPage', () => ({
  default: () => <div data-testid="signup-page">Sign up</div>,
}));

function makeUser(mustChangePassword: boolean): User {
  return {
    id: 'u1',
    email: 'jane@example.com',
    user_metadata: { must_change_password: mustChangePassword },
    app_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  } as unknown as User;
}

describe('AuthGuard — forced password change gate', () => {
  it('renders ForcedPasswordChange when must_change_password is true', () => {
    useAuthMock.mockReturnValue({ user: makeUser(true), loading: false, adminMode: false });

    render(<AuthGuard><div>App content</div></AuthGuard>);

    expect(screen.getByTestId('forced-password-change')).toBeInTheDocument();
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
  });

  it('renders children when must_change_password is false', () => {
    useAuthMock.mockReturnValue({ user: makeUser(false), loading: false, adminMode: false });

    render(<AuthGuard><div>App content</div></AuthGuard>);

    expect(screen.getByText('App content')).toBeInTheDocument();
    expect(screen.queryByTestId('forced-password-change')).not.toBeInTheDocument();
  });

  it('renders children when there is no must_change_password flag at all', () => {
    const user = { id: 'u2', email: 'x@example.com', user_metadata: {}, app_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() } as unknown as User;
    useAuthMock.mockReturnValue({ user, loading: false, adminMode: false });

    render(<AuthGuard><div>App content</div></AuthGuard>);

    expect(screen.getByText('App content')).toBeInTheDocument();
  });

  it('does not gate an admin-bypass session even if must_change_password were somehow set', () => {
    useAuthMock.mockReturnValue({ user: makeUser(true), loading: false, adminMode: true });

    render(<AuthGuard><div>App content</div></AuthGuard>);

    expect(screen.getByText('App content')).toBeInTheDocument();
    expect(screen.queryByTestId('forced-password-change')).not.toBeInTheDocument();
  });

  it('renders LoginPage when there is no user', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false, adminMode: false });

    render(<AuthGuard><div>App content</div></AuthGuard>);

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });
});
