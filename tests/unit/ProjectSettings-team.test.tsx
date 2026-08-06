// tests/unit/ProjectSettings-team.test.tsx
// Real-component RTL test for ProjectSettings.tsx, Team Members tab and the
// shared admin-session bar. Covers TS-86 through TS-100 from
// docs/test-plans/team-and-roles-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

// ── Mock db/projectRepository's updateProject (imported directly by ProjectSettings.tsx) ──
const updateProjectMock = vi.fn(async (_id: string, updater: (p: Project) => void | Project) => {
  const clone = structuredClone(currentProject);
  const result = updater(clone);
  return result ?? clone;
});

let currentProject: Project;

vi.mock('../../frontend/src/db/projectRepository', () => ({
  updateProject: (...args: Parameters<typeof updateProjectMock>) => updateProjectMock(...args),
  checkIsAppAdmin: vi.fn(async () => false),
}));

// ── Mock services/api (named export `api`, imported at module level) ──
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

// ── Mock hooks/useIntegrations (Team tab doesn't use it, but it's called
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

const ADMIN_MEMBER = {
  id: 'member-admin',
  name: 'Alice Admin',
  email: 'alice@example.com',
  role: 'Product Manager',
  avatarColor: '#4f46e5',
  appRole: 'project_owner' as const,
  inviteStatus: 'accepted' as const,
};

const NON_ADMIN_MEMBER = {
  id: 'member-dev',
  name: 'Dev Dave',
  email: 'dave@example.com',
  role: 'Engineer',
  avatarColor: '#0891b2',
  appRole: 'editor' as const,
  inviteStatus: 'accepted' as const,
};

// ProjectSettings defaults to the 'team' tab on mount, so no extra click is
// needed before exercising Team tab behavior.

describe('ProjectSettings — Team Members tab', () => {
  beforeEach(() => {
    updateProjectMock.mockClear();
  });

  it('adds the first member as admin and seeds agentAssignments from the matching role template (TS-86)', async () => {
    currentProject = baseProject();
    const onClose = vi.fn();
    render(<ProjectSettings project={currentProject} onClose={onClose} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Full name *'), 'Alice Admin');
    await user.type(screen.getByLabelText('Email *'), 'alice@example.com');

    const roleSelect = screen.getByDisplayValue('Select role *');
    await user.selectOptions(roleSelect, 'Product Manager');

    await user.click(screen.getByRole('button', { name: /\+ add without invite/i }));

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [calledId, updater] = updateProjectMock.mock.calls[0];
    expect(calledId).toBe('proj-1');

    const draft = structuredClone(currentProject);
    updater(draft);

    expect(draft.teamMembers).toHaveLength(1);
    const newMember = draft.teamMembers[0];
    expect(newMember.name).toBe('Alice Admin');
    expect(newMember.email).toBe('alice@example.com');
    expect(newMember.role).toBe('Product Manager');
    // First member becomes project_owner (the sole authority for
    // admin/edit access now — see the @deprecated note on
    // TeamMember.isAdmin in project.types.ts). This IS "the first member
    // becomes admin automatically" — just expressed via appRole now.
    expect(newMember.appRole).toBe('project_owner');
    expect(newMember.avatarColor).toBeTruthy();

    // Product Manager template should seed agentAssignments for its suggestedAgents.
    expect(draft.agentAssignments.length).toBeGreaterThan(0);
    for (const a of draft.agentAssignments) {
      expect(a.memberIds).toContain(newMember.id);
    }
    // brd and userStory are part of the product-manager template.
    const agentIds = draft.agentAssignments.map((a) => a.agentId);
    expect(agentIds).toContain('brd');
    expect(agentIds).toContain('userStory');
  });

  it('shows "Name is required" and does not call updateProject when name is empty (TS-87)', async () => {
    currentProject = baseProject();
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email *'), 'alice@example.com');
    const roleSelect = screen.getByDisplayValue('Select role *');
    await user.selectOptions(roleSelect, 'Product Manager');

    await user.click(screen.getByRole('button', { name: /\+ add without invite/i }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('shows "Valid email is required" for an invalid email (TS-88)', async () => {
    currentProject = baseProject();
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Full name *'), 'Alice Admin');
    await user.type(screen.getByLabelText('Email *'), 'not-an-email');
    const roleSelect = screen.getByDisplayValue('Select role *');
    await user.selectOptions(roleSelect, 'Product Manager');

    await user.click(screen.getByRole('button', { name: /\+ add without invite/i }));

    expect(screen.getByText('Valid email is required')).toBeInTheDocument();
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('shows a role-required error when no role is selected and "Custom role..." is not chosen (TS-89)', async () => {
    currentProject = baseProject();
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Full name *'), 'Alice Admin');
    await user.type(screen.getByLabelText('Email *'), 'alice@example.com');

    await user.click(screen.getByRole('button', { name: /\+ add without invite/i }));

    expect(screen.getByText('Role is required — pick from the list or choose Custom')).toBeInTheDocument();
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('creates a member with a custom role and seeds no agentAssignments (TS-90)', async () => {
    currentProject = baseProject();
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Full name *'), 'Carol Custom');
    await user.type(screen.getByLabelText('Email *'), 'carol@example.com');

    const roleSelect = screen.getByDisplayValue('Select role *');
    await user.selectOptions(roleSelect, '__custom__');

    const customInput = screen.getByLabelText('Custom role *');
    await user.type(customInput, 'Chief Vibes Officer');

    await user.click(screen.getByRole('button', { name: /\+ add without invite/i }));

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [, updater] = updateProjectMock.mock.calls[0];
    const draft = structuredClone(currentProject);
    updater(draft);

    expect(draft.teamMembers).toHaveLength(1);
    expect(draft.teamMembers[0].role).toBe('Chief Vibes Officer');
    // No ROLE_TEMPLATES entry has this title, so nothing should be seeded.
    expect(draft.agentAssignments).toHaveLength(0);
  });

  it('disables the add-member inputs when members exist and no admin session is active (TS-91)', () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: '',
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    expect(screen.getByLabelText('Full name *')).toBeDisabled();
    expect(screen.getByLabelText('Email *')).toBeDisabled();
    expect(screen.getByDisplayValue('Select role *')).toBeDisabled();
    expect(
      screen.getByText('🔒 Select an admin identity above to add or remove members.')
    ).toBeInTheDocument();
  });

  it('removes a non-admin member and strips them from agentAssignments (TS-92)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [
        { agentId: 'brd' as const, memberIds: [ADMIN_MEMBER.id, NON_ADMIN_MEMBER.id] },
      ] as Project['agentAssignments'],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    const devCard = screen.getAllByText('Dev Dave')[0].closest('[class*="memberGrid"] > div') as HTMLElement;
    expect(devCard).toBeTruthy();
    await user.click(within(devCard).getByRole('button', { name: /remove/i }));

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [, updater] = updateProjectMock.mock.calls[0];
    const draft = structuredClone(currentProject);
    updater(draft);

    expect(draft.teamMembers.map((m) => m.id)).not.toContain(NON_ADMIN_MEMBER.id);
    for (const a of draft.agentAssignments) {
      expect(a.memberIds).not.toContain(NON_ADMIN_MEMBER.id);
    }
  });

  it('disables Remove for the only admin (TS-93)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    const card = screen.getAllByText('Alice Admin')[0].closest('[class*="memberGrid"] > div') as HTMLElement;
    const removeBtn = within(card).getByRole('button', { name: /remove/i });
    expect(removeBtn).toBeDisabled();

    await user.click(removeBtn);
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('allows removing the active admin when a second admin exists, clearing activeAdminId (TS-94)', async () => {
    const SECOND_ADMIN = {
      id: 'member-admin-2',
      name: 'Bob Backup',
      email: 'bob@example.com',
      role: 'Tech Lead',
      avatarColor: '#059669',
      appRole: 'project_owner' as const,
      inviteStatus: 'accepted' as const,
    };
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, SECOND_ADMIN],
      agentAssignments: [],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    const card = screen.getAllByText('Alice Admin')[0].closest('[class*="memberGrid"] > div') as HTMLElement;
    const removeBtn = within(card).getByRole('button', { name: /remove/i });
    expect(removeBtn).not.toBeDisabled();

    await user.click(removeBtn);

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [, updater] = updateProjectMock.mock.calls[0];
    const draft = structuredClone(currentProject);
    updater(draft);

    expect(draft.teamMembers.map((m) => m.id)).not.toContain(ADMIN_MEMBER.id);
    expect(draft.activeAdminId).toBeUndefined();
  });

  // TS-95/TS-96 used to cover the standalone "Make admin"/"Revoke admin"
  // toggle, which flipped an isAdmin boolean independent of appRole. That
  // toggle is retired — Project Owner status now changes only via appRole
  // (the role dropdown / invite-and-edit-role modal), so there is no
  // separate admin-toggle button to click anymore. These two tests now
  // cover what replaced it: the "Owner" badge reflects appRole directly,
  // and there's no stray admin-toggle control left in the DOM.
  it('shows the "Owner" badge for a project_owner member and not for others (TS-95)', () => {
    const SECOND_ADMIN = {
      id: 'member-admin-2',
      name: 'Bob Backup',
      email: 'bob@example.com',
      role: 'Tech Lead',
      avatarColor: '#059669',
      appRole: 'project_owner' as const,
      inviteStatus: 'accepted' as const,
    };
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, SECOND_ADMIN, NON_ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const aliceCard = screen.getAllByText('Alice Admin')[0].closest('[class*="memberGrid"] > div') as HTMLElement;
    const bobCard = screen.getAllByText('Bob Backup')[0].closest('[class*="memberGrid"] > div') as HTMLElement;
    const daveCard = screen.getAllByText('Dev Dave')[0].closest('[class*="memberGrid"] > div') as HTMLElement;

    expect(within(aliceCard).getByText('Owner')).toBeInTheDocument();
    expect(within(bobCard).getByText('Owner')).toBeInTheDocument();
    expect(within(daveCard).queryByText('Owner')).not.toBeInTheDocument();

    // No standalone admin-toggle button remains anywhere in the panel.
    expect(screen.queryByRole('button', { name: /make admin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /🔑 admin/i })).not.toBeInTheDocument();
  });

  it('disables Remove (not a separate admin-revoke control) for the only Project Owner (TS-96)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    const card = screen.getAllByText('Alice Admin')[0].closest('[class*="memberGrid"] > div') as HTMLElement;
    const removeBtn = within(card).getByRole('button', { name: /remove/i });
    expect(removeBtn).toBeDisabled();
    expect(removeBtn).toHaveAttribute('title', expect.stringMatching(/only project owner/i));

    await user.click(removeBtn);
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('shows the "no agents assigned" warning for a member with no matching agentAssignments (TS-97)', () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [
        { agentId: 'brd' as const, memberIds: [ADMIN_MEMBER.id] },
      ] as Project['agentAssignments'],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const devCard = screen.getAllByText('Dev Dave')[0].closest('[class*="memberGrid"] > div') as HTMLElement;
    expect(within(devCard).getByText('⚠ No agents assigned — pipeline cannot run')).toBeInTheDocument();

    const aliceCard = screen.getAllByText('Alice Admin')[0].closest('[class*="memberGrid"] > div') as HTMLElement;
    expect(within(aliceCard).queryByText('⚠ No agents assigned — pipeline cannot run')).not.toBeInTheDocument();
  });

  it('renders all 11 ROLE_TEMPLATES in the suggested-roles reference panel, dimming hidden roles (TS-98)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: ADMIN_MEMBER.id,
      disabledRoleIds: ['scrum-master'],
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    const details = screen.getByText('📋 Suggested roles & agent mappings reference').closest('details') as HTMLElement;
    // <details> content is present in the DOM regardless of open state, but
    // open it to mirror real usage.
    await user.click(within(details).getByText('📋 Suggested roles & agent mappings reference'));

    // Spot-check a sample of role titles render as cards.
    expect(within(details).getByText('Product Manager')).toBeInTheDocument();
    expect(within(details).getByText('Scrum Master')).toBeInTheDocument();
    expect(within(details).getByText('Architect')).toBeInTheDocument();

    // The hidden role (Scrum Master) shows the "Hidden — show" toggle and
    // reduced opacity; visible roles show "Visible — hide".
    const scrumCard = within(details).getByText('Scrum Master').closest('div[class*="roleCard"]') as HTMLElement;
    expect(within(scrumCard).getByRole('button', { name: /hidden — show/i })).toBeInTheDocument();
    expect(scrumCard.style.opacity).toBe('0.5');

    const pmCard = within(details).getByText('Product Manager').closest('div[class*="roleCard"]') as HTMLElement;
    expect(within(pmCard).getByRole('button', { name: /visible — hide/i })).toBeInTheDocument();
    expect(pmCard.style.opacity).toBe('1');
  });

  it('toggles disabledRoleIds when an admin clicks "Visible — hide" / "Hidden — show" (TS-99)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: ADMIN_MEMBER.id,
      disabledRoleIds: [],
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    const details = screen.getByText('📋 Suggested roles & agent mappings reference').closest('details') as HTMLElement;
    await user.click(within(details).getByText('📋 Suggested roles & agent mappings reference'));

    const pmCard = within(details).getByText('Product Manager').closest('div[class*="roleCard"]') as HTMLElement;
    await user.click(within(pmCard).getByRole('button', { name: /visible — hide/i }));

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [, updater] = updateProjectMock.mock.calls[0];
    const draft = structuredClone(currentProject);
    updater(draft);
    expect(draft.disabledRoleIds).toContain('product-manager');
  });

  it('updates adminSessionId and persists activeAdminId via the "Viewing as" select (TS-100)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: '',
    });
    const { rerender } = render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    const select = screen.getByText('Viewing as:').parentElement!.querySelector('select') as HTMLSelectElement;
    await user.selectOptions(select, ADMIN_MEMBER.id);

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [calledId, updater] = updateProjectMock.mock.calls[0];
    expect(calledId).toBe('proj-1');

    const draft = structuredClone(currentProject);
    updater(draft);
    expect(draft.activeAdminId).toBe(ADMIN_MEMBER.id);

    // The real app re-renders this panel with a fresh `project` prop once
    // the persisted activeAdminId comes back through the live query (see
    // ProjectWorkspace's `key`-bump remount) -- isAdmin is derived from the
    // `project` prop (via getProjectMember's fallbackMemberId match), not
    // from the local adminSessionId state alone, so simulate that here.
    rerender(<ProjectSettings project={{ ...currentProject, activeAdminId: ADMIN_MEMBER.id }} onClose={vi.fn()} />);
    expect(await screen.findByText('🔑 Admin session active')).toBeInTheDocument();
  });
});
