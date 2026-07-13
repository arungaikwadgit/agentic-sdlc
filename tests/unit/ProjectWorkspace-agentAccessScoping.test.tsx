// tests/unit/ProjectWorkspace-agentAccessScoping.test.tsx
// Component tests for the per-agent access-scoping feature added 2026-07-11
// (mandatory-agent-assignment invites) in components/pipeline/ProjectWorkspace.tsx.
// See frontend/src/lib/projectAccess.ts's getAgentRunPermission (unit-tested
// directly in tests/unit/projectAccess.test.ts) for the underlying rule this
// component wires up to its Run/Retry/Re-run controls, and
// backend/src/proxy.agentAccess.integration.test.ts for the server-side
// enforcement backstop.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Project } from '../../frontend/src/types/project.types';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';

let currentProject: Project | undefined;
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => currentProject,
}));

vi.mock('@/db/database', () => ({
  db: {
    projects: { get: vi.fn() },
    settings: { get: vi.fn().mockResolvedValue(undefined) },
  },
}));

// The one thing this file varies between tests: which member "is" the
// current signed-in user, driving getProjectMember()'s email match.
let mockUserEmail = 'scoped-editor@example.com';
vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'scoped-editor-user-1', email: mockUserEmail }, session: null, loading: false, adminMode: false, signOut: vi.fn() }),
}));

const updateProjectMock = vi.fn().mockResolvedValue(undefined);
const updateAgentRunMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/db/projectRepository', () => ({
  getProject: (...args: unknown[]) => Promise.resolve(currentProject),
  updateProject: (...args: unknown[]) => updateProjectMock(...args),
  updateAgentRun: (...args: unknown[]) => updateAgentRunMock(...args),
  subscribeProjectRepositoryChange: () => () => {},
}));

const { runSingleAgentMock } = vi.hoisted(() => ({ runSingleAgentMock: vi.fn() }));
vi.mock('@/services/pipelineEngine', () => ({
  PipelineEngine: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
  })),
  runSingleAgent: (...args: unknown[]) => runSingleAgentMock(...args),
}));

vi.mock('@/services/api', () => ({
  api: {
    callAgent: vi.fn().mockResolvedValue({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] }),
    extractText: vi.fn(),
    enhancePrompt: vi.fn(),
  },
}));

vi.mock('@/agents/domains', () => ({
  DOMAINS: { fintech: { id: 'fintech', context: 'FINTECH DOMAIN CONTEXT' } },
}));

vi.mock('@/services/appStateApi', () => ({
  getAppConfigValue: vi.fn().mockResolvedValue({}),
  setAppConfigValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/traceability', () => ({ exportTraceabilityCSV: vi.fn() }));
vi.mock('@/services/exporters/documentExporter', () => ({ exportAllArtifactsZip: vi.fn() }));
vi.mock('@/services/exporters/excelExporter', () => ({ exportPipelineMetricsXlsx: vi.fn() }));

vi.mock('../../frontend/src/components/documents/DocumentViewer', () => ({ default: () => <div data-testid="document-viewer" /> }));
vi.mock('../../frontend/src/components/reviewGate/ReviewGateModal', () => ({ default: () => <div data-testid="review-gate-modal" /> }));
vi.mock('../../frontend/src/components/settings/ProjectSettings', () => ({
  default: () => <div data-testid="project-settings" />,
  initials: (name: string) => name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2),
}));
vi.mock('../../frontend/src/components/documents/ExportMenu', () => ({ default: () => <div data-testid="export-menu" /> }));
vi.mock('../../frontend/src/components/documents/GithubPushModal', () => ({ default: () => <div data-testid="github-push-modal" /> }));

// Import after mocks are registered.
import ProjectWorkspace from '../../frontend/src/components/pipeline/ProjectWorkspace';

const ARCHITECTURE_DEF = AGENT_DEFINITIONS.architecture!;   // will be the assigned agent
const API_DESIGN_DEF = AGENT_DEFINITIONS.apiDesign!;        // will be the unassigned agent

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Acme Retail',
    description: 'A project for testing',
    domain: 'fintech',
    status: 'draft',
    currentPhase: 'phase3',
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    agentRuns: {},
    reviewGates: {
      gate1: { id: 'gate1', approved: true, afterPhases: [] },
      gate2: { id: 'gate2', approved: true, afterPhases: [] },
      gate3: { id: 'gate3', approved: true, afterPhases: [] },
      gate5: { id: 'gate5', approved: true, afterPhases: [] },
    },
    promptOverrides: [],
    mode: 'expert',
    teamMembers: [
      { id: 'editor-1', name: 'Scoped Editor', email: 'scoped-editor@example.com', role: 'Tech Lead', appRole: 'editor', avatarColor: '#fff', agentAccessScoped: true, inviteStatus: 'accepted' },
      { id: 'legacy-editor-1', name: 'Legacy Editor', email: 'legacy-editor@example.com', role: 'Developer', appRole: 'editor', avatarColor: '#fff', inviteStatus: 'accepted' },
      { id: 'owner-1', name: 'Owner', email: 'owner@example.com', role: 'Owner', appRole: 'project_owner', avatarColor: '#fff', inviteStatus: 'accepted' },
    ],
    activeAdminId: 'owner-1',
    agentAssignments: [
      { agentId: 'architecture', memberIds: ['editor-1'] },
      // apiDesign intentionally has no assignment entry at all.
    ],
    ...overrides,
  } as unknown as Project;
}

const noop = () => {};

describe('ProjectWorkspace — per-agent access scoping', () => {
  beforeEach(() => {
    currentProject = undefined;
    mockUserEmail = 'scoped-editor@example.com';
    updateProjectMock.mockClear();
    updateAgentRunMock.mockClear();
    runSingleAgentMock.mockClear();
  });

  it('disables "Run Pipeline" for a scoped Editor, with a tooltip pointing at per-agent Re-run', async () => {
    currentProject = baseProject();
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    const btn = await screen.findByRole('button', { name: 'Run Pipeline' });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/scoped to specific agents/i);
  });

  it('enables "Run Pipeline" for the same project when signed in as the (unscoped) Project Owner', async () => {
    currentProject = baseProject();
    mockUserEmail = 'owner@example.com';
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    const btn = await screen.findByRole('button', { name: 'Run Pipeline' });
    expect(btn).not.toBeDisabled();
  });

  it('enables "Run Pipeline" for a legacy Editor (agentAccessScoped falsy) — grandfathering', async () => {
    currentProject = baseProject();
    mockUserEmail = 'legacy-editor@example.com';
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    const btn = await screen.findByRole('button', { name: 'Run Pipeline' });
    expect(btn).not.toBeDisabled();
  });

  it('a scoped Editor sees "Edit prompt and run" enabled for their assigned agent, disabled for an unassigned one', async () => {
    currentProject = baseProject();
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    // Select the assigned agent (architecture) — never run yet, so the
    // "not run yet" placeholder with Run/"Edit prompt and run" renders.
    const assignedRow = await screen.findByRole('button', { name: new RegExp(ARCHITECTURE_DEF.name, 'i') });
    assignedRow.click();
    await waitFor(async () => {
      const editBtn = await screen.findByRole('button', { name: 'Edit prompt and run' });
      expect(editBtn).not.toBeDisabled();
    });

    // Select the unassigned agent (apiDesign) — same placeholder, but this
    // member has no assignment entry for it.
    const unassignedRow = await screen.findByRole('button', { name: new RegExp(API_DESIGN_DEF.name, 'i') });
    unassignedRow.click();
    await waitFor(async () => {
      const editBtn = await screen.findByRole('button', { name: 'Edit prompt and run' });
      expect(editBtn).toBeDisabled();
      expect(editBtn.getAttribute('title')).toMatch(/not assigned to run this agent/i);
    });
  });
});
