// tests/unit/ProjectSettings-archive.test.tsx
// Real-component RTL test for ProjectSettings.tsx, General tab "Danger Zone"
// (soft delete / restore project). Covers TS-32 through TS-39 from
// docs/test-plans/project-lifecycle-test-plan.md.
//
// The Danger Zone's admin gate was changed in this session from a per-project
// team-member flag (`TeamMember.isAdmin`, keyed off `activeAdminId`) to an
// app-wide admin check (`checkIsAppAdmin()`, backed by ADMIN_EMAIL_ALLOWLIST
// on the server) — see server/src/middleware/auth.ts requireAppAdmin. Delete
// and Restore now call the dedicated `deleteProject`/`restoreProject` REST
// functions directly instead of going through `updateProject` with a local
// field-mutating updater.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';

// ── Mock db/database (used transitively by db/projectRepository,
// agents/promptDefaults, agents/domainKnowledgeDefaults) ──
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

// ── Mock db/projectRepository ────────────────────────────────────────────────
let isAppAdminFlag = true;

const updateProjectMock = vi.fn(async (_id: string, updater: (p: Project) => void | Project) => {
  const clone = structuredClone(currentProject);
  const result = updater(clone);
  return result ?? clone;
});
const deleteProjectMock = vi.fn(async (_id: string, _remarks: string) => {});
const restoreProjectMock = vi.fn(async (_id: string) => {});
const checkIsAppAdminMock = vi.fn(async () => isAppAdminFlag);

let currentProject: Project;

vi.mock('../../frontend/src/db/projectRepository', () => ({
  updateProject: (...args: Parameters<typeof updateProjectMock>) => updateProjectMock(...args),
  deleteProject: (...args: Parameters<typeof deleteProjectMock>) => deleteProjectMock(...args),
  restoreProject: (...args: Parameters<typeof restoreProjectMock>) => restoreProjectMock(...args),
  checkIsAppAdmin: (...args: unknown[]) => checkIsAppAdminMock(...(args as [])),
}));

// ── Mock services/api (named export `api`, not used by Danger Zone but imported at module level) ──
vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn(),
    extractText: vi.fn(),
    generateDomainKnowledge: vi.fn(),
    generateBrandingGuidelines: vi.fn(),
    fetchSiteBranding: vi.fn(),
    testGithubConnection: vi.fn(),
  },
}));

// ── Mock hooks/useIntegrations (Danger Zone doesn't use it, but it's called
// unconditionally at the top of the component) ──
vi.mock('../../frontend/src/hooks/useIntegrations', () => ({
  useIntegrations: () => ({
    integrations: [],
    saveCredential: vi.fn(),
    loadCredential: vi.fn(async () => null),
    removeCredential: vi.fn(),
  }),
}));

// ── Mock contexts/AuthContext — ProjectSettings.tsx calls useAuth()
// unconditionally, which throws outside a real <AuthProvider>. ──
vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' }, session: null, loading: false, adminMode: false, signOut: vi.fn() }),
}));

// ── Mock contexts/AlertContext — same reason, useAlert() is called
// unconditionally at the top of ProjectSettings.tsx. ──
vi.mock('../../frontend/src/contexts/AlertContext', () => ({
  useAlert: () => ({ showAlert: vi.fn() }),
}));

// Import after mocks are registered.
import ProjectSettings from '../../frontend/src/components/settings/ProjectSettings';

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Demo Project',
    description: 'A project for testing',
    domain: 'fintech',
    status: 'draft',
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    agentRuns: {},
    reviewGates: {},
    promptOverrides: [],
    mode: 'simple',
    teamMembers: [],
    agentAssignments: [],
    ...overrides,
  };
}

describe('ProjectSettings — Danger Zone (soft delete / restore)', () => {
  beforeEach(() => {
    isAppAdminFlag = true;
    updateProjectMock.mockClear();
    deleteProjectMock.mockClear();
    restoreProjectMock.mockClear();
    checkIsAppAdminMock.mockClear();
  });

  it('does not render the Danger Zone for a non-app-admin user (TS-32)', async () => {
    isAppAdminFlag = false;
    currentProject = baseProject();
    const onClose = vi.fn();
    render(<ProjectSettings project={currentProject} onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /general/i }));

    // checkIsAppAdmin() resolves asynchronously; wait for it before asserting
    // the Danger Zone stayed hidden (rather than just not having rendered yet).
    await waitFor(() => expect(checkIsAppAdminMock).toHaveBeenCalled());
    expect(screen.queryByText('Danger Zone')).not.toBeInTheDocument();
  });

  it('shows "Delete Project…" then a required reason field for an app-admin user (TS-33)', async () => {
    currentProject = baseProject();
    const onClose = vi.fn();
    render(<ProjectSettings project={currentProject} onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /general/i }));

    const deleteButton = await screen.findByRole('button', { name: /delete project…/i });
    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
    await user.click(deleteButton);

    expect(screen.getByPlaceholderText(/project cancelled, duplicate/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('shows a validation error and does not call deleteProject when the reason is empty (TS-34)', async () => {
    currentProject = baseProject();
    const onClose = vi.fn();
    render(<ProjectSettings project={currentProject} onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /general/i }));
    await user.click(await screen.findByRole('button', { name: /delete project…/i }));
    await user.click(screen.getByRole('button', { name: /confirm delete/i }));

    expect(screen.getByText('A reason is required to delete this project.')).toBeInTheDocument();
    expect(deleteProjectMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('soft-deletes with the typed (trimmed) reason, then closes (TS-35)', async () => {
    currentProject = baseProject();
    const onClose = vi.fn();
    render(<ProjectSettings project={currentProject} onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /general/i }));
    await user.click(await screen.findByRole('button', { name: /delete project…/i }));

    const textarea = screen.getByPlaceholderText(/project cancelled, duplicate/i);
    await user.type(textarea, '  Scope merged into Project X  ');
    await user.click(screen.getByRole('button', { name: /confirm delete/i }));

    expect(deleteProjectMock).toHaveBeenCalledWith('proj-1', 'Scope merged into Project X');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces a repository error instead of closing when deleteProject rejects (TS-35b)', async () => {
    currentProject = baseProject();
    deleteProjectMock.mockRejectedValueOnce(new Error('Network error'));
    const onClose = vi.fn();
    render(<ProjectSettings project={currentProject} onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /general/i }));
    await user.click(await screen.findByRole('button', { name: /delete project…/i }));
    await user.type(screen.getByPlaceholderText(/project cancelled, duplicate/i), 'some reason');
    await user.click(screen.getByRole('button', { name: /confirm delete/i }));

    expect(await screen.findByText(/Error: Network error/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows archived info and a Restore button when the project is already deleted (TS-37)', async () => {
    currentProject = baseProject({
      archived: true,
      archivedReason: 'No longer needed',
      archivedAt: new Date('2026-01-15').getTime(),
      archivedBy: 'Alice Admin',
    });
    const onClose = vi.fn();
    render(<ProjectSettings project={currentProject} onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /general/i }));

    // The archived-info text is a single <p> built from several inline
    // expressions, so match on the element's full normalized text content
    // rather than a substring (default getByText only matches whole nodes).
    const infoText = await screen.findByText((_content: string, element: Element | null) => {
      if (!element || element.tagName.toLowerCase() !== 'p') return false;
      const text = element.textContent ?? '';
      return (
        text.includes('This project is deleted by Alice Admin') &&
        text.includes('Reason: "No longer needed"')
      );
    });
    expect(infoText).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore project/i })).toBeInTheDocument();
    // Delete controls should not be shown for an already-deleted project.
    expect(screen.queryByRole('button', { name: /delete project…/i })).not.toBeInTheDocument();
  });

  it('calls restoreProject(id) on Restore and does not close the modal (TS-38)', async () => {
    currentProject = baseProject({
      archived: true,
      archivedReason: 'No longer needed',
      archivedAt: 12345,
      archivedBy: 'Alice Admin',
    });
    const onClose = vi.fn();
    render(<ProjectSettings project={currentProject} onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /general/i }));
    await user.click(await screen.findByRole('button', { name: /restore project/i }));

    expect(restoreProjectMock).toHaveBeenCalledWith('proj-1');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hides the reason field again when "Cancel" is clicked, without calling deleteProject (TS-39)', async () => {
    currentProject = baseProject();
    const onClose = vi.fn();
    render(<ProjectSettings project={currentProject} onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /general/i }));
    await user.click(await screen.findByRole('button', { name: /delete project…/i }));

    const textarea = screen.getByPlaceholderText(/project cancelled, duplicate/i);
    await user.type(textarea, 'some reason');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByPlaceholderText(/project cancelled, duplicate/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete project…/i })).toBeInTheDocument();
    expect(deleteProjectMock).not.toHaveBeenCalled();
  });
});

// ── Findings ────────────────────────────────────────────────────────────────
// TS-36 from the original suite (archivedBy falling back to a raw session id
// when the admin session didn't match a team member) no longer applies: the
// Danger Zone's gate and the archived-by display were both decoupled from
// per-project TeamMember records as part of this session's admin-soft-delete
// rework. `archivedBy` now always comes straight from `project.archivedBy`,
// which the server sets to the authenticated app-admin's email on delete —
// there is no client-side member-name lookup/fallback left to test.
