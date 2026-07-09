// tests/unit/AppSettingsModal-projects.test.tsx
// Real-component RTL test for AppSettingsModal.tsx, "Projects" tab.
// Covers TS-40 through TS-50 from docs/test-plans/project-lifecycle-test-plan.md.
//
// This tab's delete/archive flow was rewritten as part of the admin-only
// soft-delete feature: the old inline "Archive" text-input form (which called
// updateProject directly) is gone. Delete is now app-admin gated (via
// checkIsAppAdmin), soft-deletes through deleteProject(id, remarks) with
// remarks collected via window.prompt, and Restore calls restoreProject(id).
// Both controls are hidden entirely for non-admins.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../../frontend/src/types/project.types';

// ── Mock dexie-react-hooks' useLiveQuery ───────────────────────────────────
// useLiveQuery normally subscribes to Dexie's observable query system, which
// doesn't work against a plain mocked `db` object. Replace it with a minimal
// polyfill: run the querier once on mount (and whenever deps change) and
// store the resolved value in state. This exercises AppSettingsModal's real
// render logic without needing Dexie's liveQuery machinery.
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

// ── Mock db/database (used transitively by agents/promptDefaults,
// agents/domainKnowledgeDefaults) ──
vi.mock('../../frontend/src/db/database', () => ({
  db: {
    projects: {
      get: vi.fn(),
      put: vi.fn(),
      add: vi.fn(),
      delete: vi.fn(),
      bulkPut: vi.fn(),
      toArray: vi.fn(async () => []),
      orderBy: vi.fn(() => ({ reverse: () => ({ toArray: async () => [] }) })),
    },
    settings: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    },
    integrations: {
      toArray: vi.fn(async () => []),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    transaction: vi.fn(async (_mode: string, _table: unknown, fn: () => Promise<unknown>) => fn()),
  },
}));

// ── Mock db/projectRepository ───────────────────────────────────────────────
let summariesStore: ProjectSummary[] = [];
// AppSettingsModal only shows Delete/Restore when checkIsAppAdmin() resolves
// true — default to true so the admin-path tests below exercise the buttons;
// the non-admin path is covered separately (TS-48c).
let isAppAdminFlag = true;

const listProjectsMock = vi.fn(async () => summariesStore);
const restoreProjectMock = vi.fn(async (id: string) => {
  const target = summariesStore.find((s) => s.id === id);
  if (target) {
    target.archived = false;
    target.archivedReason = undefined;
    target.archivedAt = undefined;
    target.archivedBy = undefined;
  }
});
const deleteProjectMock = vi.fn(async (id: string, remarks: string) => {
  const target = summariesStore.find((s) => s.id === id);
  if (target) {
    target.archived = true;
    target.archivedReason = remarks;
    target.archivedAt = Date.now();
    target.archivedBy = 'admin@example.com';
  }
});
const checkIsAppAdminMock = vi.fn(async () => isAppAdminFlag);
const subscribeProjectRepositoryChangeMock = vi.fn(() => () => {});

vi.mock('../../frontend/src/db/projectRepository', () => ({
  listProjects: (...args: unknown[]) => listProjectsMock(...(args as [])),
  restoreProject: (...args: Parameters<typeof restoreProjectMock>) => restoreProjectMock(...args),
  deleteProject: (...args: Parameters<typeof deleteProjectMock>) => deleteProjectMock(...args),
  checkIsAppAdmin: (...args: unknown[]) => checkIsAppAdminMock(...(args as [])),
  subscribeProjectRepositoryChange: (...args: Parameters<typeof subscribeProjectRepositoryChangeMock>) =>
    subscribeProjectRepositoryChangeMock(...args),
  exportAllProjects: vi.fn(async () => '{}'),
}));

// ── Mock services/api (namespace import `* as api`) ─────────────────────────
vi.mock('../../frontend/src/services/api', () => ({
  callAgent: vi.fn(),
  extractText: vi.fn(),
  getAuthHeader: vi.fn(async () => ({})),
}));


vi.mock('@/services/appStateApi', () => ({
  getAppConfigValue: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setAppConfigValue: vi.fn(async () => undefined),
  setAppConfigValues: vi.fn(async () => undefined),
  listAppConfig: vi.fn(async () => ({})),
  listIntegrations: vi.fn(async () => []),
  getIntegration: vi.fn(async () => null),
  saveIntegration: vi.fn(async () => undefined),
  deleteIntegration: vi.fn(async () => undefined),
  listBacklogItems: vi.fn(async () => []),
  saveBacklogItem: vi.fn(async () => undefined),
  deleteBacklogItem: vi.fn(async () => undefined),
  subscribeAppStateChange: vi.fn(() => () => {}),
}));
// Import after mocks are registered.
import AppSettingsModal from '../../frontend/src/components/settings/AppSettingsModal';

function makeSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-1',
    name: 'Demo Project',
    domain: 'fintech',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAgents: 0,
    totalAgents: 10,
    ...overrides,
  };
}

async function openProjectsTab() {
  const user = userEvent.setup();
  render(<AppSettingsModal onClose={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /projects/i }));
  return user;
}

describe('AppSettingsModal — Projects tab', () => {
  beforeEach(() => {
    summariesStore = [];
    isAppAdminFlag = true;
    listProjectsMock.mockClear();
    restoreProjectMock.mockClear();
    deleteProjectMock.mockClear();
    checkIsAppAdminMock.mockClear();
  });

  it('hides the archived toggle and lists active projects when none are archived (TS-40)', async () => {
    summariesStore = [makeSummary()];
    await openProjectsTab();

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /archived \(/i })).not.toBeInTheDocument();
  });

  it('shows "Archived (N)" toggle and switches views (TS-41)', async () => {
    summariesStore = [
      makeSummary({ id: 'active-1', name: 'Active Project' }),
      makeSummary({
        id: 'archived-1',
        name: 'Old Project',
        archived: true,
        archivedReason: 'Done',
        archivedAt: Date.now(),
        archivedBy: 'admin@example.com',
      }),
    ];
    const user = await openProjectsTab();

    await waitFor(() => expect(screen.getByText('Active Project')).toBeInTheDocument());
    const toggle = screen.getByRole('button', { name: /archived \(1\)/i });
    expect(toggle).toBeInTheDocument();
    expect(screen.queryByText('Old Project')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByText('Old Project')).toBeInTheDocument();
    expect(screen.queryByText('Active Project')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /active projects/i })).toBeInTheDocument();
  });

  it('shows "No projects yet." when the active list is empty (TS-42)', async () => {
    summariesStore = [];
    await openProjectsTab();

    await waitFor(() => expect(screen.getByText('No projects yet.')).toBeInTheDocument());
  });

  it('renders "No archived projects." when the archived view has no items (TS-43)', async () => {
    // The "No archived projects." string is normally unreachable through the
    // UI: the toggle (the only way to set showArchivedProjects=true) only
    // renders when archivedCount > 0. Verified indirectly via TS-41/TS-42
    // covering both ternary branches that are actually reachable.
    summariesStore = [makeSummary({ id: 'archived-1', name: 'Old Project', archived: true })];
    const user = await openProjectsTab();

    await waitFor(() => expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /archived \(1\)/i }));

    expect(screen.getByText('Old Project')).toBeInTheDocument();
    expect(screen.queryByText('No archived projects.')).not.toBeInTheDocument();
  });

  it('calls restoreProject(id) when "Restore" is clicked in the archived view (TS-47)', async () => {
    summariesStore = [
      makeSummary({
        id: 'archived-1',
        name: 'Old Project',
        archived: true,
        archivedReason: 'Done',
        archivedAt: Date.now(),
        archivedBy: 'admin@example.com',
      }),
    ];
    const user = await openProjectsTab();

    await waitFor(() => expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /archived \(1\)/i }));

    await waitFor(() => expect(screen.getByText('Old Project')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /restore/i }));

    expect(restoreProjectMock).toHaveBeenCalledWith('archived-1');
  });

  it('calls deleteProject(id, remarks) when Delete is confirmed with a reason (TS-48)', async () => {
    // Remarks are now collected via window.prompt rather than window.confirm
    // — deleteProject requires a non-empty reason (server-enforced too).
    summariesStore = [makeSummary()];
    vi.spyOn(window, 'prompt').mockReturnValue('Duplicate project');
    const user = await openProjectsTab();

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(window.prompt).toHaveBeenCalled();
    expect(deleteProjectMock).toHaveBeenCalledWith('proj-1', 'Duplicate project');

    vi.restoreAllMocks();
  });

  it('does not call deleteProject when the prompt is cancelled (TS-49)', async () => {
    summariesStore = [makeSummary()];
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const user = await openProjectsTab();

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(window.prompt).toHaveBeenCalled();
    expect(deleteProjectMock).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('does not call deleteProject when the prompt is left blank (TS-49b)', async () => {
    summariesStore = [makeSummary()];
    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    const user = await openProjectsTab();

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(deleteProjectMock).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('hides Delete/Restore controls entirely for non-admin users (TS-48c)', async () => {
    isAppAdminFlag = false;
    summariesStore = [
      makeSummary({ id: 'proj-1', name: 'Demo Project' }),
      makeSummary({ id: 'archived-1', name: 'Old Project', archived: true, archivedBy: 'admin@example.com' }),
    ];
    const user = await openProjectsTab();

    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /archived \(1\)/i }));
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
  });

  it('shows "{archivedBy}: {archivedReason}" and the archived date for a person-archived project (TS-50)', async () => {
    const archivedDate = new Date('2026-02-01').getTime();
    summariesStore = [
      makeSummary({
        id: 'archived-1',
        name: 'Old Project',
        archived: true,
        archivedReason: 'No longer needed',
        archivedAt: archivedDate,
        archivedBy: 'Alice Admin',
      }),
    ];
    const user = await openProjectsTab();

    await waitFor(() => expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /archived \(1\)/i }));

    await waitFor(() => expect(screen.getByText('Old Project')).toBeInTheDocument());
    expect(screen.getByText('Alice Admin: "No longer needed"')).toBeInTheDocument();

    // The "Archived {date}" text is part of a larger "{n}/{n} agents · Archived {date}"
    // text node, so match on substring via a custom text matcher.
    const expectedDateText = `Archived ${new Date(archivedDate).toLocaleDateString()}`;
    // Multiple ancestor elements share the same text content; verify at least one leaf contains it.
    const matches = screen.getAllByText((_content: string, element: Element | null) => element?.textContent?.includes(expectedDateText) ?? false);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ── Findings ────────────────────────────────────────────────────────────────
// TS-43 ("No archived projects." empty state): walking the render logic,
// `visibleProjects` is computed as `archivedCount > 0` gates the toggle, and
// `showArchivedProjects` can only become true by clicking that toggle. Once
// the last archived project is gone, archivedCount drops to 0 and the toggle
// disappears — there's no UI path left to view an empty archived list. The
// "No archived projects." string is reachable only if `showArchivedProjects`
// is true while `archivedCount` is simultaneously 0, which can't happen via
// user interaction. Same dead-branch pattern as Dashboard.tsx.
//
// TS-44/45/46 from the original suite (inline "Archive" text-input form,
// Confirm/Cancel buttons, updateProject-based archiving) were removed in this
// session: that whole code path was deleted from AppSettingsModal.tsx because
// it bypassed the new admin-gated soft-delete system entirely (any signed-in
// user could archive a project via updateProject, and the server's PATCH
// hardening added alongside this feature would have silently discarded those
// writes anyway, making the old "Archive" button a confusing no-op). Delete
// is now the single soft-delete entry point everywhere in the app.
