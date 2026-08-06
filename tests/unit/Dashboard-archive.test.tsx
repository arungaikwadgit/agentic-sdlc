// tests/unit/Dashboard-archive.test.tsx
// Real-component RTL test for Dashboard.tsx + ProjectCard.tsx, archived
// projects view. Covers TS-51 through TS-59 from
// docs/test-plans/project-lifecycle-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../../frontend/src/types/project.types';

// ── Mock dexie-react-hooks' useLiveQuery (see AppSettingsModal-projects.test.tsx
// for rationale) ──
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (querier: () => Promise<unknown>, deps: unknown[] = []) => {
    const [value, setValue] = useState<unknown>(undefined);
    useEffect(() => {
      let cancelled = false;
      Promise.resolve(querier()).then((result) => {
        if (!cancelled) setValue(result);
      });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return value;
  },
}));

// ── Mock db/projectRepository ───────────────────────────────────────────────
let summariesStore: ProjectSummary[] = [];

const listProjectsMock = vi.fn(async () => summariesStore);
const deleteProjectMock = vi.fn(async (id: string) => {
  summariesStore = summariesStore.filter((s) => s.id !== id);
});
const restoreProjectMock = vi.fn(async (id: string) => {
  const target = summariesStore.find((s) => s.id === id);
  if (target) {
    target.archived = false;
    target.archivedReason = undefined;
    target.archivedAt = undefined;
    target.archivedBy = undefined;
  }
});
const exportAllProjectsMock = vi.fn(async () => '{}');
const importProjectsMock = vi.fn(async () => 0);
// Dashboard.tsx only passes onDelete/onRestore to ProjectCard when the
// current user is an app admin (server-enforced via ADMIN_EMAIL_ALLOWLIST —
// see server/src/middleware/auth.ts requireAppAdmin). Default to true here so
// existing delete/restore-focused tests exercise the admin path; the
// non-admin path is covered separately below (TS-60).
let isAppAdminFlag = true;
const checkIsAppAdminMock = vi.fn(async () => isAppAdminFlag);
const subscribeProjectRepositoryChangeMock = vi.fn(() => () => {});

vi.mock('../../frontend/src/db/projectRepository', () => ({
  listProjects: (...args: unknown[]) => listProjectsMock(...(args as [])),
  // Dashboard.tsx calls listVisibleProjects (access-control aware), not
  // listProjects directly. For this archive-focused test there's no identity
  // to filter by, so route it through the same mock/store as listProjects.
  listVisibleProjects: (...args: unknown[]) => listProjectsMock(...(args as [])),
  deleteProject: (...args: Parameters<typeof deleteProjectMock>) => deleteProjectMock(...args),
  restoreProject: (...args: Parameters<typeof restoreProjectMock>) => restoreProjectMock(...args),
  checkIsAppAdmin: (...args: unknown[]) => checkIsAppAdminMock(...(args as [])),
  subscribeProjectRepositoryChange: (...args: Parameters<typeof subscribeProjectRepositoryChangeMock>) =>
    subscribeProjectRepositoryChangeMock(...args),
  exportAllProjects: (...args: unknown[]) => exportAllProjectsMock(...(args as [])),
  importProjects: (...args: Parameters<typeof importProjectsMock>) => importProjectsMock(...args),
}));

// ── Mock NewProjectModal and AppSettingsModal — Dashboard renders these
// conditionally; they pull in heavy dependencies (db, api, agents) that are
// out of scope for this archive-focused test. ──
vi.mock('../../frontend/src/components/dashboard/NewProjectModal', () => ({
  default: () => null,
}));
vi.mock('../../frontend/src/components/settings/AppSettingsModal', () => ({
  default: () => null,
}));

// ── Mock AuthContext/ToastContext — Dashboard.tsx calls useAuth()/useToast()
// directly, both of which throw outside their real Providers. Mocking the
// hooks (rather than wrapping with the real Providers) keeps this test
// focused on Dashboard's own archive/delete/restore logic.
const signOutMock = vi.fn(async () => {});
vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, session: null, loading: false, adminMode: false, signOut: signOutMock }),
}));
const toastMock = vi.fn();
vi.mock('../../frontend/src/contexts/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('../../frontend/src/services/userPreferencesApi', () => ({
  getDashboardViewPreference: vi.fn(async () => 'tiles'),
  setDashboardViewPreference: vi.fn(async () => undefined),
}));

// Import after mocks are registered.
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

describe('Dashboard — archived projects', () => {
  beforeEach(() => {
    summariesStore = [];
    isAppAdminFlag = true;
    listProjectsMock.mockClear();
    deleteProjectMock.mockClear();
    restoreProjectMock.mockClear();
    checkIsAppAdminMock.mockClear();
    toastMock.mockClear();
  });

  it('shows no "Archived" toggle and renders "✕" delete buttons when nothing is archived (TS-51)', async () => {
    summariesStore = [makeSummary({ id: 'p1', name: 'Project One' }), makeSummary({ id: 'p2', name: 'Project Two' })];
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Project One')).toBeInTheDocument());
    expect(screen.getByText('Project Two')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archived \(/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /delete project/i })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /restore project/i })).not.toBeInTheDocument();
  });

  it('shows "Archived (N)" toggle while still showing only active projects by default (TS-52)', async () => {
    summariesStore = [
      makeSummary({ id: 'active-1', name: 'Active Project' }),
      makeSummary({ id: 'archived-1', name: 'Old Project', archived: true, archivedAt: Date.now() }),
    ];
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Active Project')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument();
    expect(screen.queryByText('Old Project')).not.toBeInTheDocument();
  });

  it('switches to the archived view, relabels the toggle, and shows "↩ Restore" instead of "✕" (TS-53)', async () => {
    summariesStore = [
      makeSummary({ id: 'active-1', name: 'Active Project' }),
      makeSummary({ id: 'archived-1', name: 'Old Project', archived: true, archivedAt: Date.now() }),
    ];
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /archived \(1\)/i }));

    expect(screen.getByText('Old Project')).toBeInTheDocument();
    expect(screen.queryByText('Active Project')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /active projects/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore project/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete project/i })).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no projects at all (TS-54 — empty active list)', async () => {
    summariesStore = [];
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('No projects yet')).toBeInTheDocument());
    // Dashboard renders "+ New Project" in both the toolbar and the empty-state CTA
    const newProjectBtns = screen.getAllByRole('button', { name: /\+ new project/i });
    expect(newProjectBtns.length).toBeGreaterThan(0);
  });

  it('renders archived metadata ("{archivedBy}: {archivedReason}" and "Deleted {date}") on a card (TS-55)', async () => {
    const archivedDate = new Date('2026-03-10').getTime();
    summariesStore = [
      makeSummary({
        id: 'archived-1',
        name: 'Old Project',
        archived: true,
        archivedReason: 'Scope merged into Project X',
        archivedAt: archivedDate,
        archivedBy: 'Alice Admin',
      }),
    ];
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /archived \(1\)/i }));

    expect(screen.getByText('Alice Admin: "Scope merged into Project X"')).toBeInTheDocument();
    const expectedDateText = `Deleted ${new Date(archivedDate).toLocaleDateString()}`;
    expect(screen.getByText(expectedDateText)).toBeInTheDocument();
  });

  it('calls restoreProject(id) without a confirmation dialog on "↩ Restore" (TS-56)', async () => {
    summariesStore = [makeSummary({ id: 'archived-1', name: 'Old Project', archived: true, archivedAt: Date.now() })];
    const confirmSpy = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /archived \(1\)/i }));
    await user.click(screen.getByRole('button', { name: /restore project/i }));

    expect(restoreProjectMock).toHaveBeenCalledWith('archived-1');
    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('calls deleteProject(id, remarks) when "✕" is clicked, remarks entered, and Delete confirmed (TS-57)', async () => {
    // Delete now opens Dashboard's ConfirmDialog (requireInput) instead of
    // window.confirm — remarks are required and forwarded to deleteProject.
    summariesStore = [makeSummary({ id: 'p1', name: 'Demo Project' })];
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete project/i }));

    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirmBtn).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/reason for deleting/i), 'Duplicate project');
    expect(confirmBtn).toBeEnabled();
    await user.click(confirmBtn);

    expect(deleteProjectMock).toHaveBeenCalledWith('p1', 'Duplicate project');
  });

  it('does not call deleteProject when the confirm dialog is cancelled (TS-58)', async () => {
    summariesStore = [makeSummary({ id: 'p1', name: 'Demo Project' })];
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete project/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteProjectMock).not.toHaveBeenCalled();
  });

  it('the Delete confirm button stays disabled for blank/whitespace-only remarks (TS-58b)', async () => {
    summariesStore = [makeSummary({ id: 'p1', name: 'Demo Project' })];
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete project/i }));

    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete' });
    await user.type(within(dialog).getByLabelText(/reason for deleting/i), '   ');

    expect(confirmBtn).toBeDisabled();
    expect(deleteProjectMock).not.toHaveBeenCalled();
  });

  it('does not render Delete/Restore controls for non-admin users (TS-60)', async () => {
    isAppAdminFlag = false;
    summariesStore = [
      makeSummary({ id: 'p1', name: 'Demo Project' }),
      makeSummary({ id: 'archived-1', name: 'Old Project', archived: true, archivedAt: Date.now() }),
    ];
    render(<Dashboard onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /delete project/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /archived \(1\)/i }));
    expect(screen.queryByRole('button', { name: /restore project/i })).not.toBeInTheDocument();
  });

  it('stops propagation so clicking "✕" or "↩ Restore" does not trigger onOpen (TS-59)', async () => {
    const onOpenProject = vi.fn();

    // Active card: click "✕", enter remarks, confirm.
    summariesStore = [makeSummary({ id: 'p1', name: 'Demo Project' })];
    const user = userEvent.setup();
    const { unmount } = render(<Dashboard onOpenProject={onOpenProject} />);

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete project/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/reason for deleting/i), 'Duplicate project');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(deleteProjectMock).toHaveBeenCalledWith('p1', 'Duplicate project');
    expect(onOpenProject).not.toHaveBeenCalled();

    unmount();

    // Archived card: click "↩ Restore".
    summariesStore = [makeSummary({ id: 'archived-1', name: 'Old Project', archived: true, archivedAt: Date.now() })];
    const onOpenProject2 = vi.fn();
    const user2 = userEvent.setup();
    render(<Dashboard onOpenProject={onOpenProject2} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument());
    await user2.click(screen.getByRole('button', { name: /archived \(1\)/i }));
    await user2.click(screen.getByRole('button', { name: /restore project/i }));

    expect(restoreProjectMock).toHaveBeenCalledWith('archived-1');
    expect(onOpenProject2).not.toHaveBeenCalled();
  });
});

// ── Findings ────────────────────────────────────────────────────────────────
// TS-54 ("No archived projects." text in Dashboard.tsx, line 81): same
// reachability issue documented for AppSettingsModal — the "Archived (N)"
// toggle (the only way to set showArchived=true) requires archivedCount > 0,
// and whenever archivedCount > 0, the archived view's `projects` array is
// non-empty by construction. The `showArchived && projects.length === 0`
// branch is therefore effectively dead code under normal use. Not tested
// directly for that reason; TS-54 above instead verifies the equivalent
// empty-state branch for the (reachable) all-projects-empty case.
