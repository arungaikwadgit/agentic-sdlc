// tests/unit/LoginPage-forgotPassword.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const signInMock = vi.fn(async () => ({ error: null }));
const sendPasswordResetMock = vi.fn(async () => ({ error: null }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ signIn: signInMock, sendPasswordReset: sendPasswordResetMock }),
  AuthProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@/lib/adminMode', () => ({
  ADMIN_BYPASS_ENABLED: false,
  ADMIN_EMAIL: 'admin@example.com',
}));

import LoginPage from '@/components/auth/LoginPage';

describe('LoginPage — forgot password', () => {
  beforeEach(() => {
    signInMock.mockClear();
    sendPasswordResetMock.mockClear();
  });

  it('shows the sign-in form by default, no forgot-password fields', () => {
    render(<LoginPage onSuccess={vi.fn()} onSignUp={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
  });

  it('switches to the forgot-password form and sends a reset request', async () => {
    const user = userEvent.setup();
    render(<LoginPage onSuccess={vi.fn()} onSignUp={vi.fn()} />);

    await user.click(screen.getByText('Forgot password?'));
    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();

    const emailInputs = screen.getAllByPlaceholderText('you@company.com');
    await user.type(emailInputs[0], 'jane@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(sendPasswordResetMock).toHaveBeenCalledWith('jane@example.com'));
    expect(await screen.findByText(/reset link is on its way/i)).toBeInTheDocument();
  });

  it('shows the same confirmation message even when sendPasswordReset errors (no account-existence leak)', async () => {
    sendPasswordResetMock.mockResolvedValueOnce({ error: { message: 'boom' } });
    const user = userEvent.setup();
    render(<LoginPage onSuccess={vi.fn()} onSignUp={vi.fn()} />);

    await user.click(screen.getByText('Forgot password?'));
    const emailInputs = screen.getAllByPlaceholderText('you@company.com');
    await user.type(emailInputs[0], 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/reset link is on its way/i)).toBeInTheDocument();
  });

  it('"Back to sign in" returns to the sign-in form', async () => {
    const user = userEvent.setup();
    render(<LoginPage onSuccess={vi.fn()} onSignUp={vi.fn()} />);

    await user.click(screen.getByText('Forgot password?'));
    await user.click(screen.getByText('Back to sign in'));

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('sign-in still works unaffected by the new forgot-password mode', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} onSignUp={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('you@company.com'), 'jane@example.com');
    await user.type(screen.getByPlaceholderText('........'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith('jane@example.com', 'password123'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});
