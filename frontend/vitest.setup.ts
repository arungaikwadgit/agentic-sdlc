// frontend/vitest.setup.ts
// Extends Vitest's expect with jest-dom matchers (toBeInTheDocument, etc.)
import '@testing-library/jest-dom';

import { vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user', email: 'owner@example.com' },
    session: { access_token: 'test-token' },
    loading: false,
    adminMode: false,
    signOut: vi.fn(async () => {}),
  }),
  AuthProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ toast: vi.fn() }),
  ToastProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/contexts/AlertContext', () => ({
  useAlert: () => ({
    showAlert: vi.fn(),
    showConfirm: vi.fn(async () => true),
  }),
  AlertProvider: ({ children }: { children: unknown }) => children,
}));