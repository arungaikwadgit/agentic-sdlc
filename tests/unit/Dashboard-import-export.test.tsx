// tests/unit/Dashboard-import-export.test.tsx
// Regression for the dashboard export-security contract.
// Import/export controls were removed from the dashboard; artifact exports are
// authorized in project workspace/admin settings instead.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const repoMocks = vi.hoisted(() => ({
  exportAllProjects: vi.fn(),
  importProjects: vi.fn(),
}));

vi.mock('../../frontend/src/contexts/ToastContext', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'owner-1', email: 'owner@example.com', user_metadata: {} },
    loading: false,
    signOut: vi.fn(async () => undefined),
  }),
}));
vi.mock('../../frontend/src/services/userPreferencesApi', () => ({
  getDashboardViewPreference: vi.fn(async () => 'tiles'),
  setDashboardViewPreference: vi.fn(async () => undefined),
}));
vi.mock('../../frontend/src/db/projectRepository', () => ({
  listVisibleProjects: vi.fn(async () => [{
    id: 'proj-1', name: 'Demo Project', domain: 'fintech', status: 'draft',
    createdAt: Date.now(), updatedAt: Date.now(), completedAgents: 3, totalAgents: 10,
  }]),
  deleteProject: vi.fn(), restoreProject: vi.fn(),
  exportAllProjects: repoMocks.exportAllProjects, importProjects: repoMocks.importProjects,
  checkIsAppAdmin: vi.fn(async () => true),
  subscribeProjectRepositoryChange: vi.fn(() => () => undefined),
}));
vi.mock('../../frontend/src/components/dashboard/NewProjectModal', () => ({ default: () => null }));
vi.mock('../../frontend/src/components/settings/AppSettingsModal', () => ({ default: () => null }));

import Dashboard from '../../frontend/src/components/dashboard/Dashboard';

describe('Dashboard - import/export security', () => {
  it('does not expose Import or Export actions, including to app admins', async () => {
    render(<Dashboard onOpenProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Import$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Export$/i })).not.toBeInTheDocument();
  });

  it('does not call repository import/export operations while rendering', async () => {
    render(<Dashboard onOpenProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    expect(repoMocks.exportAllProjects).not.toHaveBeenCalled();
    expect(repoMocks.importProjects).not.toHaveBeenCalled();
  });
});
