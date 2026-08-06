// tests/unit/ProjectWorkspace-github-push.test.tsx
// Component tests for components/pipeline/ProjectWorkspace.tsx — the
// "Push to GitHub" button visibility and GithubPushModal wiring.
// Covers TS-166 through TS-169.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';

// Mock dexie-react-hooks
let currentProject: Project | undefined;
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => currentProject,
}));

vi.mock('@/db/database', () => ({
  db: { projects: { get: vi.fn() } },
}));

// ── Mock contexts/AuthContext — ProjectWorkspace.tsx calls useAuth()
// unconditionally at the top of the component; without this mock,
// useAuth() throws "must be used inside <AuthProvider>" and every test in
// this file fails to render. ──
vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-user-1', email: 'owner@example.com' }, session: null, loading: false, adminMode: false, signOut: vi.fn() }),
}));

// ── ProjectWorkspace.tsx loads its project via the useProject() hook
// (frontend/src/hooks/useProject.ts), which calls getProject +
// subscribeProjectRepositoryChange from @/db/projectRepository -- neither
// was defined on this mock, so useProject's effect threw and every test in
// this file failed to render (pre-existing gap from a useLiveQuery ->
// useProject refactor, unrelated to the isAdmin -> appRole RBAC
// consolidation, but it blocks verifying that consolidation here). ──
vi.mock('@/db/projectRepository', () => ({
  getProject: (...args: unknown[]) => Promise.resolve(currentProject),
  updateProject: vi.fn(),
  updateAgentRun: vi.fn(),
  subscribeProjectRepositoryChange: () => () => {},
}));

vi.mock('@/services/pipelineEngine', () => ({
  PipelineEngine: vi.fn().mockImplementation(() => ({ run: vi.fn(), stop: vi.fn() })),
}));

// callAgent stubbed — ProjectWorkspace pings it on mount to check API key.
vi.mock('@/services/api', () => ({
  api: {
    callAgent: vi.fn().mockResolvedValue({ content: 'pong' }),
    pushIssuesToGithub: vi.fn(),
  },
}));

vi.mock('@/services/traceability', () => ({ exportTraceabilityCSV: vi.fn() }));
vi.mock('@/services/exporters/documentExporter', () => ({ exportAllArtifactsZip: vi.fn() }));
vi.mock('@/services/exporters/excelExporter', () => ({ exportPipelineMetricsXlsx: vi.fn() }));

vi.mock('../../frontend/src/components/documents/DocumentViewer', () => ({
  default: () => <div data-testid="document-viewer" />,
}));
vi.mock('../../frontend/src/components/reviewGate/ReviewGateModal', () => ({
  default: () => <div data-testid="review-gate-modal" />,
}));
vi.mock('../../frontend/src/components/settings/ProjectSettings', () => ({
  default: () => <div data-testid="project-settings" />,
  initials: (name: string) =>
    name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2),
}));
vi.mock('../../frontend/src/components/documents/ExportMenu', () => ({
  default: () => <div data-testid="export-menu" />,
}));

const githubPushModalPropsSpy = vi.fn();
vi.mock('../../frontend/src/components/documents/GithubPushModal', () => ({
  default: (props: unknown) => {
    githubPushModalPropsSpy(props);
    return <div data-testid="github-push-modal" />;
  },
}));

import ProjectWorkspace from '../../frontend/src/components/pipeline/ProjectWorkspace';

const SPRINT_PLANNER_DEF = AGENT_DEFINITIONS.sprintPlanner;

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Acme Retail',
    description: 'A project for testing',
    domain: 'fintech',
    status: 'draft',
    currentPhase: 'phase1',
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    agentRuns: {},
    reviewGates: {
      gate0: { approved: true },
      gate1: { approved: true },
      gate2: { approved: true },
      gate3: { approved: true },
      gate5: { approved: true },
    },
    promptOverrides: [],
    mode: 'simple',
    teamMembers: [
      { id: 'member-1', name: 'Alice Admin', email: 'alice@example.com', role: 'Admin', appRole: 'project_owner', avatarColor: '#fff' },
    ],
    activeAdminId: 'member-1',
    agentAssignments: [],
    ...overrides,
  } as unknown as Project;
}

const SPRINT_PLAN_OUTPUT = '## Backend Tasks\n1. Title: Implement feature\n   Some body text.\n';

function withCompleteRun(agentId: string, output: string): Project['agentRuns'] {
  return {
    [agentId]: { agentId, status: 'complete', output },
  } as unknown as Project['agentRuns'];
}

const noop = () => {};

async function selectAgent(agentName: string) {
  const user = userEvent.setup();
  // findByRole (not getByRole) -- the project now loads asynchronously via
  // useProject()'s getProject() call, so the agent sidebar isn't populated
  // on the very first synchronous render tick.
  const row = await screen.findByRole('button', { name: new RegExp(agentName, 'i') });
  await user.click(row);
  return user;
}

describe('ProjectWorkspace — GitHub push integration', () => {
  beforeEach(() => {
    githubPushModalPropsSpy.mockClear();
    currentProject = undefined;
  });

  it('renders the "Push to GitHub" button when admin, githubIntegrationId set, and Sprint Plan is selected and complete (TS-166)', async () => {
    currentProject = baseProject({
      githubIntegrationId: 'gh-int-1',
      agentRuns: withCompleteRun('sprintPlanner', SPRINT_PLAN_OUTPUT),
    });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    await selectAgent(SPRINT_PLANNER_DEF!.name);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /push to github/i })).toBeInTheDocument();
    });
  });

  it('does not render the "Push to GitHub" button when the user is not an admin (TS-167)', async () => {
    currentProject = baseProject({
      githubIntegrationId: 'gh-int-1',
      agentRuns: withCompleteRun('sprintPlanner', SPRINT_PLAN_OUTPUT),
      teamMembers: [
        { id: 'member-1', name: 'Bob Dev', email: 'bob@example.com', role: 'Developer', appRole: 'editor', avatarColor: '#fff' },
      ],
      activeAdminId: 'member-1',
    } as Partial<Project>);
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    await selectAgent(SPRINT_PLANNER_DEF!.name);
    await waitFor(() => {
      expect(screen.getByTestId('document-viewer')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /push to github/i })).not.toBeInTheDocument();
  });

  it('does not render the "Push to GitHub" button for an agent other than Sprint Plan / Task Breakdown (TS-168)', async () => {
    currentProject = baseProject({
      githubIntegrationId: 'gh-int-1',
      agentRuns: {
        ...withCompleteRun('sprintPlanner', SPRINT_PLAN_OUTPUT),
        ...withCompleteRun('brd', '# Business Requirements\n\nSome content.'),
      },
    });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    await selectAgent(AGENT_DEFINITIONS.brd!.name);
    await waitFor(() => {
      expect(screen.getByTestId('document-viewer')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /push to github/i })).not.toBeInTheDocument();
  });

  it('clicking "Push to GitHub" renders GithubPushModal with correct props (TS-169)', async () => {
    currentProject = baseProject({
      githubIntegrationId: 'gh-int-1',
      agentRuns: withCompleteRun('sprintPlanner', SPRINT_PLAN_OUTPUT),
    });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    const user = await selectAgent(SPRINT_PLANNER_DEF!.name);
    const pushButton = await screen.findByRole('button', { name: /push to github/i });
    await user.click(pushButton);
    await waitFor(() => {
      expect(screen.getByTestId('github-push-modal')).toBeInTheDocument();
    });
    expect(githubPushModalPropsSpy).toHaveBeenCalled();
    const props = githubPushModalPropsSpy.mock.calls[githubPushModalPropsSpy.mock.calls.length - 1][0] as {
      project: Project;
      markdown: string;
      extraLabels: string[];
      sourceLabel: string;
    };
    expect(props.markdown).toBe(SPRINT_PLAN_OUTPUT);
    expect(props.extraLabels).toEqual(['sprint-plan']);
    expect(props.sourceLabel).toBe(SPRINT_PLANNER_DEF!.outputLabel);
    expect(props.project.id).toBe('proj-1');
  });

  it('uses the "task-breakdown" label for the Task Breakdown agent (TS-169 variant)', async () => {
    const TASK_BREAKDOWN_DEF = AGENT_DEFINITIONS.taskBreakdown;
    const TASK_BREAKDOWN_OUTPUT = '## Backend Tasks\n1. Title: Break down the work\n   Some body text.\n';
    currentProject = baseProject({
      githubIntegrationId: 'gh-int-1',
      agentRuns: withCompleteRun('taskBreakdown', TASK_BREAKDOWN_OUTPUT),
    });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    const user = await selectAgent(TASK_BREAKDOWN_DEF!.name);
    const pushButton = await screen.findByRole('button', { name: /push to github/i });
    await user.click(pushButton);
    await waitFor(() => {
      expect(screen.getByTestId('github-push-modal')).toBeInTheDocument();
    });
    const props = githubPushModalPropsSpy.mock.calls[githubPushModalPropsSpy.mock.calls.length - 1][0] as {
      markdown: string;
      extraLabels: string[];
      sourceLabel: string;
    };
    expect(props.markdown).toBe(TASK_BREAKDOWN_OUTPUT);
    expect(props.extraLabels).toEqual(['task-breakdown']);
    expect(props.sourceLabel).toBe(TASK_BREAKDOWN_DEF!.outputLabel);
  });
});
