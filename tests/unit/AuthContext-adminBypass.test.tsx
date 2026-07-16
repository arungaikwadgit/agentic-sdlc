/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../../frontend/src/contexts/AuthContext';

let adminModeActive = false;
let authStateCallback: ((event: string, session: null) => void) | undefined;

vi.mock('../../frontend/src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn((callback) => {
        authStateCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

vi.mock('../../frontend/src/lib/adminMode', () => ({
  isAdminMode: () => adminModeActive,
  setAdminMode: (active: boolean) => { adminModeActive = active; },
  ADMIN_USER_ID: '__admin_local__',
  ADMIN_EMAIL: 'admin@local',
  ADMIN_PASSWORD: 'admin',
  ADMIN_BYPASS_ENABLED: true,
}));

function Probe() {
  const { user, signIn } = useAuth();
  return (
    <div>
      <span>{user?.email ?? 'signed-out'}</span>
      <button onClick={() => void signIn('admin@local', 'admin')}>Sign in locally</button>
    </div>
  );
}

describe('AuthContext local admin bypass', () => {
  it('ignores a Supabase SIGNED_OUT event while the dev bypass session is active', async () => {
    adminModeActive = false;
    authStateCallback = undefined;
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('signed-out')).toBeVisible());

    await userEvent.click(screen.getByRole('button', { name: 'Sign in locally' }));
    await waitFor(() => expect(screen.getByText('admin@local')).toBeVisible());

    act(() => authStateCallback?.('SIGNED_OUT', null));
    expect(screen.getByText('admin@local')).toBeVisible();
  });
});
