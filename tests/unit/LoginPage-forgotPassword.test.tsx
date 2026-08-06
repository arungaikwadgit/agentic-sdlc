// tests/unit/LoginPage-forgotPassword.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../../frontend/src/components/auth/LoginPage';

const signInMock = vi.fn(async () => ({ error: null }));
const sendPasswordResetMock = vi.fn(async () => ({ error: null }));

vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ signIn: signInMock, sendPasswordReset: sendPasswordResetMock }),
}));

vi.mock('../../frontend/src/lib/adminMode', () => ({
  ADMIN_BYPASS_ENABLED: false,
  ADMIN_EMAIL: 'admin@local',
}));

describe('LoginPage — forgot password mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInMock.mockResolvedValue({ error: null });
    sendPasswordResetMock.mockResolvedValue({ error: null });
  });

  it('starts in sign-in mode', () => {
    render(<LoginPage onSuccess={vi.fn()} onSignUp={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('switches to forgot-password mode via the link', async () => {
    render(<LoginPage onSuccess={vi.fn()} onSignUp={vi.fn()} />);

    await userEvent.click(screen.getByText('Forgot password?'));

    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('calls sendPasswordReset with the entered email and shows a generic confirmation', async () => {
    render(<LoginPage onSuccess={vi.fn()} onSignUp={vi.fn()} />);

    await userEvent.click(screen.getByText('Forgot password?'));
    await userEvent.type(screen.getByPlaceholderText('you@company.com'), 'jane@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(sendPasswordResetMock).toHaveBeenCalledWith('jane@example.com');
    expect(await screen.findByText(/reset link is on its way/i)).toBeInTheDocument();
  });

  it('shows the same confirmation even when sendPasswordReset errors (no account-existence leak)', async () => {
    sendPasswordResetMock.mockResolvedValueOnce({ error: { message: 'no such user' } });
    render(<LoginPage onSuccess={vi.fn()} onSignUp={vi.fn()} />);

    await userEvent.click(screen.getByText('Forgot password?'));
    await userEvent.type(screen.getByPlaceholderText('you@company.com'), 'ghost@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText(/reset link is on its way/i)).toBeInTheDocument();
  });

  it('returns to sign-in mode via "Back to sign in"', async () => {
    render(<LoginPage onSuccess={vi.fn()} onSignUp={vi.fn()} />);

    await userEvent.click(screen.getByText('Forgot password?'));
    await userEvent.click(screen.getByText('Back to sign in'));

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
