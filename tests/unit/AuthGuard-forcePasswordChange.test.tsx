// tests/unit/AuthGuard-forcePasswordChange.test.tsx
// Tests AuthGuard.tsx's must-change-password gate: any signed-in,
// non-admin-bypass session with user_metadata.must_change_password === true
// renders ForcedPasswordChange instead of the app, and normal sessions pass
// through untouched.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseAuth = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@/lib/inviteRoute', () => ({ isInviteRoute: () => false }));
vi.mock('@/lib/resetPasswordRoute', () => ({ isResetPasswordRoute: () => false }));

// Real ForcedPasswordChange pulls in @/lib/supabase — stub it out since this
// test only cares whether AuthGuard chooses to render it, not its internals
// (covered by ForcedPasswordChange.test.tsx).
vi.mock('@/components/auth/ForcedPasswordChange', () => ({
  default: () => <div>FORCED_PASSWORD_CHANGE_SCREEN</div>,
}));

import AuthGuard from '@/components/auth/AuthGuard';

describe('AuthGuard — forced password-change gate', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('renders the forced password-change screen when must_change_password is true', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'jane@example.com', user_metadata: { must_change_password: true } },
      loading: false,
      adminMode: false,
    });

    render(<AuthGuard><div>APP CONTENT</div></AuthGuard>);

    expect(screen.getByText('FORCED_PASSWORD_CHANGE_SCREEN')).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument();
  });

  it('renders the app normally when must_change_password is false', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'jane@example.com', user_metadata: { must_change_password: false } },
      loading: false,
      adminMode: false,
    });

    render(<AuthGuard><div>APP CONTENT</div></AuthGuard>);

    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
    expect(screen.queryByText('FORCED_PASSWORD_CHANGE_SCREEN')).not.toBeInTheDocument();
  });

  it('renders the app normally when user_metadata has no must_change_password key at all', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'jane@example.com', user_metadata: {} },
      loading: false,
      adminMode: false,
    });

    render(<AuthGuard><div>APP CONTENT</div></AuthGuard>);

    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('never gates an admin-bypass session, even if user_metadata somehow has the flag set', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'admin', email: 'admin@example.com', user_metadata: { must_change_password: true } },
      loading: false,
      adminMode: true,
    });

    render(<AuthGuard><div>APP CONTENT</div></AuthGuard>);

    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
    expect(screen.queryByText('FORCED_PASSWORD_CHANGE_SCREEN')).not.toBeInTheDocument();
  });

  it('shows the login page (not the gate) when there is no user at all', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, adminMode: false });

    render(<AuthGuard><div>APP CONTENT</div></AuthGuard>);

    expect(screen.queryByText('FORCED_PASSWORD_CHANGE_SCREEN')).not.toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument();
  });
});
