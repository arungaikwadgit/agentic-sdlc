/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// Table view's "Created by" column (project creator name + role) must only
// render for app admins — see attachCreatorMetadata() in
// server/src/routes/projects.ts, which populates creatorName/creatorRole for
// every viewer, and the isAppAdmin gate added around the <th>/<td> pair in
// Dashboard.tsx's ProjectTable. Regular members/editors/reviewers should
// never see who created a project they didn't create themselves.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDashboardViewPreference: vi.fn(),
  setDashboardViewPreference: vi.fn(),
  checkIsAppAdmin: vi.fn(),
}));

vi.mock('@/services/userPreferencesApi', () => ({
  getDashboardViewPreference: mocks.getDashboardViewPreference,
  setDashboardViewPreference: mocks.setDashboardViewPreference,
}));
vi.mock('@/db/projectRepository', () => ({
  listVisibleProjects: vi.fn().mockResolvedValue([{
    id: 'p1', name: 'Alpha Project', domain: 'fintech', status: 'running',
    createdAt: 1, updatedAt: 2, completedAgents: 4, totalAgents: 10,
    creatorName: 'Priya Owner', creatorRole: 'Project Owner',
  }]),
  deleteProject: vi.fn(), restoreProject: vi.fn(), checkIsAppAdmin: mocks.checkIsAppAdmin,
  subscribeProjectRepositoryChange: vi.fn(() => () => {}),
}));
vi.mock('@/services/legacyProjectImport', () => ({ importLegacyProjectsIfNeeded: vi.fn().mockResolvedValue(0) }));
vi.mock('@/services/inviteSession', () => ({ getInviteSession: vi.fn(() => null), clearInviteSession: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, loading: false, signOut: vi.fn() }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/dashboard/NewProjectModal', () => ({ default: () => null }));
vi.mock('@/components/createProject/CreateProjectPage', () => ({ default: () => null }));
vi.mock('@/components/settings/AppSettingsModal', () => ({ default: () => null }));

import Dashboard from '@/components/dashboard/Dashboard';

describe('Dashboard table view — Created by column (admin-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboardViewPreference.mockResolvedValue('table');
    mocks.setDashboardViewPreference.mockResolvedValue(undefined);
  });

  it('shows the Created by column and creator name/role for an app admin', async () => {
    mocks.checkIsAppAdmin.mockResolvedValue(true);
    render(<Dashboard onOpenProject={vi.fn()} />);

    await screen.findByRole('table', { name: /projects/i });
    expect(await screen.findByRole('columnheader', { name: /created by/i })).toBeInTheDocument();
    expect(screen.getByText('Priya Owner')).toBeInTheDocument();
    expect(screen.getByText('Project Owner')).toBeInTheDocument();
  });

  it('hides the Created by column entirely for a non-admin', async () => {
    mocks.checkIsAppAdmin.mockResolvedValue(false);
    render(<Dashboard onOpenProject={vi.fn()} />);

    await screen.findByRole('table', { name: /projects/i });
    expect(screen.queryByRole('columnheader', { name: /created by/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Priya Owner')).not.toBeInTheDocument();
  });
});
