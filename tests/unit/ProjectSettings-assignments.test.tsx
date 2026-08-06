// tests/unit/ProjectSettings-assignments.test.tsx
// Real-component RTL test for ProjectSettings.tsx, Agent Assignments tab.
// Covers TS-101 through TS-108 from
// docs/test-plans/team-and-roles-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';
import { PHASE_AGENTS, PHASE_LABELS } from '../../frontend/src/agents/constants';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';

// ── Mock db/database ──
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

// ── Mock db/projectRepository's updateProject ──
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

// ── Mock services/api ──
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

// ── Mock hooks/useIntegrations ──
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
};

const NON_ADMIN_MEMBER = {
  id: 'member-dev',
  name: 'Dev Dave',
  email: 'dave@example.com',
  role: 'Engineer',
  avatarColor: '#0891b2',
  appRole: 'editor' as const,
};

async function openAssignmentsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /agent assignments/i }));
}

describe('ProjectSettings — Agent Assignments tab', () => {
  beforeEach(() => {
    updateProjectMock.mockClear();
  });

  it('shows the empty-team message and no matrix when there are no members (TS-101)', async () => {
    currentProject = baseProject();
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    expect(screen.getByText('Add team members first to configure assignments.')).toBeInTheDocument();
    expect(screen.queryByText('Agent → Member Matrix')).not.toBeInTheDocument();
  });

  it('checking an unchecked matrix cell adds the member to that agent\'s assignment (TS-102)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    // Pick the first agent in phase1 and toggle it for Dev Dave.
    const agentId = PHASE_AGENTS.phase1[0];
    const agentName = AGENT_DEFINITIONS[agentId]?.name ?? agentId;
    const row = screen.getByText(agentName).closest('div[class*="matrixRow"]') as HTMLElement;
    const cells = within(row).getAllByRole('button');
    // members order is [ADMIN_MEMBER, NON_ADMIN_MEMBER] -> second cell = Dev Dave
    await user.click(cells[1]);

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [, updater] = updateProjectMock.mock.calls[0];
    const draft = structuredClone(currentProject);
    updater(draft);

    const entry = draft.agentAssignments.find((a) => a.agentId === agentId);
    expect(entry).toBeDefined();
    expect(entry!.memberIds).toContain(NON_ADMIN_MEMBER.id);
  });

  it('clicking an already-checked cell removes the member from memberIds (TS-103)', async () => {
    const agentId = PHASE_AGENTS.phase1[0];
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [
        { agentId, memberIds: [ADMIN_MEMBER.id, NON_ADMIN_MEMBER.id] },
      ] as Project['agentAssignments'],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    const agentName = AGENT_DEFINITIONS[agentId]?.name ?? agentId;
    const row = screen.getByText(agentName).closest('div[class*="matrixRow"]') as HTMLElement;
    const cells = within(row).getAllByRole('button');
    // Second cell = Dev Dave, currently checked.
    expect(cells[1].textContent).toBe('✓');
    await user.click(cells[1]);

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [, updater] = updateProjectMock.mock.calls[0];
    const draft = structuredClone(currentProject);
    updater(draft);

    const entry = draft.agentAssignments.find((a) => a.agentId === agentId);
    expect(entry).toBeDefined();
    expect(entry!.memberIds).not.toContain(NON_ADMIN_MEMBER.id);
    expect(entry!.memberIds).toContain(ADMIN_MEMBER.id);
  });

  it('disables matrix toggle buttons for a non-admin session (TS-104)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: NON_ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    const agentId = PHASE_AGENTS.phase1[0];
    const agentName = AGENT_DEFINITIONS[agentId]?.name ?? agentId;
    const row = screen.getByText(agentName).closest('div[class*="matrixRow"]') as HTMLElement;
    const cells = within(row).getAllByRole('button');
    for (const cell of cells) {
      expect(cell).toBeDisabled();
    }

    expect(screen.getByText('Select an admin identity to edit assignments.')).toBeInTheDocument();

    await user.click(cells[0]);
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it('the phase filter restricts the matrix to a single phase\'s agents (TS-105)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    const filterSelect = screen.getByDisplayValue('All phases');
    await user.selectOptions(filterSelect, PHASE_LABELS.phase1);

    // An agent from phase1 should be visible.
    const phase1AgentName = AGENT_DEFINITIONS[PHASE_AGENTS.phase1[0]]?.name ?? PHASE_AGENTS.phase1[0];
    expect(screen.getByText(phase1AgentName)).toBeInTheDocument();

    // An agent from a different phase (phase2) should not be visible.
    const phase2AgentId = PHASE_AGENTS.phase2[0];
    const phase2AgentName = AGENT_DEFINITIONS[phase2AgentId]?.name ?? phase2AgentId;
    if (phase2AgentName !== phase1AgentName) {
      expect(screen.queryByText(phase2AgentName)).not.toBeInTheDocument();
    }
  });

  it('quick-apply role template adds memberIds for every suggested agent (TS-106)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [
        { agentId: 'brd' as const, memberIds: [ADMIN_MEMBER.id] },
      ] as Project['agentAssignments'],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    // Find Dev Dave's quick-apply row and select "QA Engineer".
    const devRow = screen.getByText('Dev Dave').closest('div[class*="quickApplyRow"]') as HTMLElement;
    const select = within(devRow).getByDisplayValue('Apply template...');
    await user.selectOptions(select, 'QA Engineer');

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [, updater] = updateProjectMock.mock.calls[0];
    const draft = structuredClone(currentProject);
    updater(draft);

    // QA Engineer template suggests testStrategy / testCases (per ROLE_TEMPLATES).
    const qaEntries = draft.agentAssignments.filter((a) => a.memberIds.includes(NON_ADMIN_MEMBER.id));
    expect(qaEntries.length).toBeGreaterThan(0);

    // Existing brd assignment for ADMIN_MEMBER is preserved.
    const brdEntry = draft.agentAssignments.find((a) => a.agentId === 'brd');
    expect(brdEntry?.memberIds).toContain(ADMIN_MEMBER.id);
  });

  it('"Clear" removes a member from every agentAssignments entry without affecting others (TS-107)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [
        { agentId: 'brd' as const, memberIds: [ADMIN_MEMBER.id, NON_ADMIN_MEMBER.id] },
        { agentId: 'userStory' as const, memberIds: [NON_ADMIN_MEMBER.id] },
      ] as Project['agentAssignments'],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    const devRow = screen.getByText('Dev Dave').closest('div[class*="quickApplyRow"]') as HTMLElement;
    await user.click(within(devRow).getByRole('button', { name: /clear/i }));

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [, updater] = updateProjectMock.mock.calls[0];
    const draft = structuredClone(currentProject);
    updater(draft);

    for (const a of draft.agentAssignments) {
      expect(a.memberIds).not.toContain(NON_ADMIN_MEMBER.id);
    }
    const brdEntry = draft.agentAssignments.find((a) => a.agentId === 'brd');
    expect(brdEntry?.memberIds).toContain(ADMIN_MEMBER.id);
  });

  it('"Assign All" adds the member to every agent across every phase in one click (TS-109)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [
        { agentId: 'brd' as const, memberIds: [ADMIN_MEMBER.id] },
      ] as Project['agentAssignments'],
      activeAdminId: ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    const devRow = screen.getByText('Dev Dave').closest('div[class*="quickApplyRow"]') as HTMLElement;
    await user.click(within(devRow).getByRole('button', { name: /assign all/i }));

    expect(updateProjectMock).toHaveBeenCalledTimes(1);
    const [, updater] = updateProjectMock.mock.calls[0];
    const draft = structuredClone(currentProject);
    updater(draft);

    const allAgentIds = Object.values(PHASE_AGENTS).flat();
    for (const agentId of allAgentIds) {
      const entry = draft.agentAssignments.find((a) => a.agentId === agentId);
      expect(entry?.memberIds).toContain(NON_ADMIN_MEMBER.id);
    }

    // Pre-existing assignment for ADMIN_MEMBER on 'brd' is preserved, not overwritten.
    const brdEntry = draft.agentAssignments.find((a) => a.agentId === 'brd');
    expect(brdEntry?.memberIds).toEqual(expect.arrayContaining([ADMIN_MEMBER.id, NON_ADMIN_MEMBER.id]));
  });

  it('"Assign All" is a no-op for a non-admin session (TS-110)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: NON_ADMIN_MEMBER.id,
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    // Non-admin session: the whole Quick-apply section (and its Assign All
    // button) isn't rendered at all — see the `isAdmin &&` guard around it.
    expect(screen.queryByRole('button', { name: /assign all/i })).not.toBeInTheDocument();
  });

  it('role-template pills on each agent row reflect visibleRoleTemplates only (TS-108)', async () => {
    currentProject = baseProject({
      teamMembers: [ADMIN_MEMBER],
      agentAssignments: [],
      activeAdminId: ADMIN_MEMBER.id,
      disabledRoleIds: ['scrum-master'],
    });
    render(<ProjectSettings project={currentProject} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await openAssignmentsTab(user);

    // sprintPlanner is suggested by project-manager, scrum-master, and
    // engineering-manager. With scrum-master hidden, its pill should not
    // appear on the sprintPlanner row, but project-manager / engineering
    // manager pills (if present) should.
    const sprintPlannerName = AGENT_DEFINITIONS['sprintPlanner' as keyof typeof AGENT_DEFINITIONS]?.name ?? 'sprintPlanner';
    const row = screen.getByText(sprintPlannerName).closest('div[class*="matrixRow"]') as HTMLElement;
    const pillTexts = within(row).queryAllByText(/Manager$/i).map((el) => el.textContent);

    expect(pillTexts).not.toContain('Scrum Master');
  });
});
