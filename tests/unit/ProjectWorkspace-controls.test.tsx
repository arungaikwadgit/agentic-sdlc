// tests/unit/ProjectWorkspace-controls.test.tsx
// Component tests for components/pipeline/ProjectWorkspace.tsx — pipeline
// run/stop controls, team-required banner, settings panel auto-open, and
// Simple/Expert mode toggle. Covers TS-174 through TS-185 from
// docs/test-plans/project-workspace-and-pipeline-orchestration-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';

// ── Mock dexie-react-hooks: useLiveQuery returns the fixture synchronously ──
let currentProject: Project | undefined;
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => currentProject,
}));

// ── Mock @/db/database ──
vi.mock('@/db/database', () => ({
  db: {
    projects: { get: vi.fn() },
  },
}));

// ── Mock @/db/projectRepository ──
const updateProjectMock = vi.fn();
const updateAgentRunMock = vi.fn();
vi.mock('@/db/projectRepository', () => ({
  updateProject: (...args: unknown[]) => updateProjectMock(...args),
  updateAgentRun: (...args: unknown[]) => updateAgentRunMock(...args),
}));

// ── Mock @/services/pipelineEngine: capture callbacks + spy on run/abort ──
let lastEngineCallbacks: any = null;
const engineRunMock = vi.fn().mockResolvedValue(undefined);
const engineAbortMock = vi.fn();
vi.mock('@/services/pipelineEngine', () => ({
  PipelineEngine: vi.fn().mockImplementation((_projectId: string, callbacks: any) => {
    lastEngineCallbacks = callbacks;
    return {
      run: engineRunMock,
      abort: engineAbortMock,
    };
  }),
}));

// ── Mock @/services/api ──
vi.mock('@/services/api', () => ({
  api: {
    callAgent: vi.fn(),
    extractText: vi.fn(),
    enhancePrompt: vi.fn(),
  },
}));

// ── Mock @/services/traceability, exporters ──
vi.mock('@/services/traceability', () => ({
  exportTraceabilityCSV: vi.fn(),
}));
vi.mock('@/services/exporters/documentExporter', () => ({
  exportAllArtifactsZip: vi.fn(),
}));
vi.mock('@/services/exporters/excelExporter', () => ({
  exportPipelineMetricsXlsx: vi.fn(),
}));

// ── Mock heavy/unrelated child components ──
vi.mock('../../frontend/src/components/documents/DocumentViewer', () => ({
  default: () => <div data-testid="document-viewer" />,
}));
vi.mock('../../frontend/src/components/reviewGate/ReviewGateModal', () => ({
  default: (props: { gateId: string }) => <div data-testid="review-gate-modal" data-gate-id={props.gateId} />,
}));
vi.mock('../../frontend/src/components/settings/ProjectSettings', () => ({
  default: () => <div data-testid="project-settings" />,
  initials: (name: string) =>
    name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2),
}));
vi.mock('../../frontend/src/components/documents/ExportMenu', () => ({
  default: () => <div data-testid="export-menu" />,
}));
vi.mock('../../frontend/src/components/documents/GithubPushModal', () => ({
  default: () => <div data-testid="github-push-modal" />,
}));

// Import after mocks are registered.
import ProjectWorkspace from '../../frontend/src/components/pipeline/ProjectWorkspace';

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
      gate1: { id: 'gate1', approved: true, afterPhases: [] },
      gate2_3: { id: 'gate2_3', approved: true, afterPhases: [] },
      gate5: { id: 'gate5', approved: true, afterPhases: [] },
      gate6: { id: 'gate6', approved: true, afterPhases: [] },
    },
    promptOverrides: [],
    mode: 'simple',
    teamMembers: [
      { id: 'member-1', name: 'Alice Admin', email: 'alice@example.com', role: 'Admin', isAdmin: true, avatarColor: '#fff' },
    ],
    activeAdminId: 'member-1',
    agentAssignments: [],
    ...overrides,
  } as unknown as Project;
}

const noop = () => {};

describe('ProjectWorkspace — run/stop controls', () => {
  beforeEach(() => {
    currentProject = undefined;
    lastEngineCallbacks = null;
    updateProjectMock.mockClear();
    updateAgentRunMock.mockClear();
    engineRunMock.mockClear();
    engineAbortMock.mockClear();
  });

  it('shows "Run Pipeline" when status is draft (TS-174)', () => {
    currentProject = baseProject({ status: 'draft' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(screen.getByRole('button', { name: 'Run Pipeline' })).toBeInTheDocument();
  });

  it('shows "Resume Pipeline" when status is paused (TS-175)', () => {
    currentProject = baseProject({ status: 'paused' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(screen.getByRole('button', { name: 'Resume Pipeline' })).toBeInTheDocument();
  });

  it('shows "Complete ✓" and disables the button when status is complete (TS-176)', () => {
    currentProject = baseProject({ status: 'complete' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    const btn = screen.getByRole('button', { name: 'Complete ✓' });
    expect(btn).toBeDisabled();
  });

  it('disables the run button with a tooltip when there are no team members (TS-177)', () => {
    currentProject = baseProject({ status: 'draft', teamMembers: [] });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    const btn = screen.getByRole('button', { name: 'Run Pipeline' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Add at least one team member to run the pipeline');
  });

  it('shows the team-required banner when teamMembers is empty, hidden otherwise (TS-178)', () => {
    currentProject = baseProject({ teamMembers: [] });
    const { rerender } = render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(screen.getByText(/Add at least one team member before running the pipeline/i)).toBeInTheDocument();

    currentProject = baseProject({ teamMembers: [{ id: 'm1', name: 'Alice', email: 'a@x.com', role: 'Admin', isAdmin: true, avatarColor: '#fff' }] });
    rerender(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(screen.queryByText(/Add at least one team member before running the pipeline/i)).not.toBeInTheDocument();
  });

  it('clicking "Run Pipeline" constructs a PipelineEngine and calls run(currentPhase) (TS-179)', async () => {
    currentProject = baseProject({ status: 'draft', currentPhase: 'phase1' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Run Pipeline' }));

    await waitFor(() => {
      expect(engineRunMock).toHaveBeenCalledWith('phase1');
    });
    expect(lastEngineCallbacks).toBeTruthy();
    expect(typeof lastEngineCallbacks.onAgentStart).toBe('function');
    expect(typeof lastEngineCallbacks.onGateReached).toBe('function');
  });

  it('shows "Stop" once the engine starts running (TS-180)', async () => {
    currentProject = baseProject({ status: 'draft' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Run Pipeline' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });
  });

  it('clicking "Stop" aborts the engine and persists status: paused (TS-181)', async () => {
    currentProject = baseProject({ status: 'draft' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Run Pipeline' }));
    await waitFor(() => screen.getByRole('button', { name: 'Stop' }));

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(engineAbortMock).toHaveBeenCalledTimes(1);
    expect(updateProjectMock).toHaveBeenCalledWith('proj-1', expect.any(Function));
    const mutator = updateProjectMock.mock.calls[updateProjectMock.mock.calls.length - 1][1];
    const draft: any = { status: 'running' };
    mutator(draft);
    expect(draft.status).toBe('paused');
  });

  it('onGateReached stops the engine and renders ReviewGateModal for that gate (TS-182)', async () => {
    currentProject = baseProject({ status: 'draft' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Run Pipeline' }));
    await waitFor(() => expect(lastEngineCallbacks).toBeTruthy());

    // Simulate the engine reaching a gate.
    lastEngineCallbacks.onGateReached('gate1');

    await waitFor(() => {
      const modal = screen.getByTestId('review-gate-modal');
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute('data-gate-id', 'gate1');
    });

    // "Run Pipeline"/"Resume Pipeline" should be back (engineRunning false).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    });
  });

  it('auto-opens the settings panel on first render when teamMembers is empty (TS-183)', () => {
    currentProject = baseProject({ teamMembers: [] });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(screen.getByTestId('project-settings')).toBeInTheDocument();
  });

  it('clicking "⚙ Settings" opens the settings panel when team is non-empty (TS-184)', async () => {
    currentProject = baseProject();
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(screen.queryByTestId('project-settings')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /settings/i }));

    expect(screen.getByTestId('project-settings')).toBeInTheDocument();
  });

  it('clicking the Simple/Expert toggle calls updateProject to flip project.mode (TS-185)', async () => {
    currentProject = baseProject({ mode: 'simple' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /expert mode/i }));

    expect(updateProjectMock).toHaveBeenCalledWith('proj-1', expect.any(Function));
    const mutator = updateProjectMock.mock.calls[updateProjectMock.mock.calls.length - 1][1];
    const draft: any = { mode: 'simple' };
    mutator(draft);
    expect(draft.mode).toBe('expert');
  });
});
