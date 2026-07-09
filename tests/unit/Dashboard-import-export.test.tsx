// tests/unit/Dashboard-import-export.test.tsx
// Regression guard: Dashboard no longer exposes legacy global Import/Export buttons.
// Project artifact export is now permission-gated inside workspace/export surfaces.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../../frontend/src/types/project.types';

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (querier: () => Promise<unknown>, deps: unknown[] = []) => {
    const [value, setValue] = useState<unknown>(undefined);
    useEffect(() => {
      let cancelled = false;
      Promise.resolve(querier()).then((result) => {
        if (!cancelled) setValue(result);
      });
      return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return value;
  },
}));

let summariesStore: ProjectSummary[] = [];
const listProjectsMock = vi.fn(async () => summariesStore);
const checkIsAppAdminMock = vi.fn(async () => true);

vi.mock('../../frontend/src/db/projectRepository', () => ({
  listProjects: (...args: unknown[]) => listProjectsMock(...(args as [])),
  listVisibleProjects: (...args: unknown[]) => listProjectsMock(...(args as [])),
  checkIsAppAdmin: (...args: unknown[]) => checkIsAppAdminMock(...(args as [])),
  subscribeProjectRepositoryChange: vi.fn(() => () => {}),
  deleteProject: vi.fn(async () => undefined),
  restoreProject: vi.fn(async () => undefined),
}));

vi.mock('../../frontend/src/components/dashboard/NewProjectModal', () => ({ default: () => null }));
vi.mock('../../frontend/src/components/settings/AppSettingsModal', () => ({ default: () => null }));
vi.mock('../../frontend/src/components/createProject/CreateProjectPage', () => ({ default: () => null }));

import Dashboard from '../../frontend/src/components/dashboard/Dashboard';

function makeSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-1',
    name: 'Demo Project',
    domain: 'fintech',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAgents: 3,
    totalAgents: 10,
    ...overrides,
  };
}

describe('Dashboard - legacy import/export controls', () => {
  beforeEach(() => {
    summariesStore = [makeSummary()];
    listProjectsMock.mockClear();
    checkIsAppAdminMock.mockClear();
  });

  it('does not render legacy Dashboard Import/Export buttons for app admins', async () => {
    render(<Dashboard onOpenProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    expect(checkIsAppAdminMock).toHaveBeenCalled();
  });

  it('does not render legacy Dashboard Import/Export buttons for non-admin users', async () => {
    checkIsAppAdminMock.mockResolvedValue(false);
    render(<Dashboard onOpenProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });
});
