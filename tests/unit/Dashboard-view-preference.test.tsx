/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDashboardViewPreference: vi.fn(),
  setDashboardViewPreference: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/services/userPreferencesApi', () => ({
  getDashboardViewPreference: mocks.getDashboardViewPreference,
  setDashboardViewPreference: mocks.setDashboardViewPreference,
}));
vi.mock('@/db/projectRepository', () => ({
  listVisibleProjects: vi.fn().mockResolvedValue([{
    id: 'p1', name: 'Alpha Project', domain: 'fintech', status: 'running',
    createdAt: 1, updatedAt: 2, completedAgents: 4, totalAgents: 10,
  }]),
  deleteProject: vi.fn(), restoreProject: vi.fn(), checkIsAppAdmin: vi.fn().mockResolvedValue(false),
  subscribeProjectRepositoryChange: vi.fn(() => () => {}),
}));
vi.mock('@/services/legacyProjectImport', () => ({ importLegacyProjectsIfNeeded: vi.fn().mockResolvedValue(0) }));
vi.mock('@/services/inviteSession', () => ({ getInviteSession: vi.fn(() => null), clearInviteSession: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, loading: false, signOut: vi.fn() }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/dashboard/NewProjectModal', () => ({ default: () => null }));
vi.mock('@/components/createProject/CreateProjectPage', () => ({ default: () => null }));
vi.mock('@/components/settings/AppSettingsModal', () => ({ default: () => null }));

import Dashboard from '@/components/dashboard/Dashboard';

describe('Dashboard persisted view preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboardViewPreference.mockResolvedValue('table');
    mocks.setDashboardViewPreference.mockResolvedValue(undefined);
  });

  it('restores the signed-in user table view from Postgres', async () => {
    render(<Dashboard onOpenProject={vi.fn()} />);
    expect(await screen.findByRole('table', { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /table view/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reverts the view and reports an error when Postgres persistence fails', async () => {
    mocks.setDashboardViewPreference.mockRejectedValueOnce(new Error('database unavailable'));
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);
    await screen.findByRole('table', { name: /projects/i });
    await user.click(screen.getByRole('button', { name: /tiles view/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(
      'Could not save the dashboard view preference.',
      'error',
    ));
    expect(screen.getByRole('table', { name: /projects/i })).toBeInTheDocument();
  });

  it('persists a view change and renders tiles for every user role', async () => {
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);
    await screen.findByRole('table', { name: /projects/i });
    await user.click(screen.getByRole('button', { name: /tiles view/i }));

    await waitFor(() => expect(mocks.setDashboardViewPreference).toHaveBeenCalledWith('tiles'));
    expect(screen.queryByRole('table', { name: /projects/i })).not.toBeInTheDocument();
    expect(screen.getByText('Alpha Project')).toBeInTheDocument();
  });
});

