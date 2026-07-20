// tests/unit/ProjectWorkspace-controls.test.tsx
// Component tests for components/pipeline/ProjectWorkspace.tsx — pipeline
// run/stop controls, team-required banner, settings panel auto-open, and
// Simple/Expert mode toggle. Covers TS-174 through TS-185 from
// docs/test-plans/project-workspace-and-pipeline-orchestration-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';
import { PHASE_AGENTS } from '../../frontend/src/agents/constants';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';

// ── Mock dexie-react-hooks: unused by the current ProjectWorkspace.tsx
// (it now fetches via the useProject() hook, not useLiveQuery directly),
// but left as a harmless no-op since nothing imports it anymore. ──
let currentProject: Project | undefined;
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => currentProject,
}));

// ── Mock @/db/database: also unused by the current component; see above. ──
vi.mock('@/db/database', () => ({
  db: {
    projects: { get: vi.fn() },
  },
}));

// ── ProjectWorkspace.tsx now loads its project via the useProject() hook
// (frontend/src/hooks/useProject.ts), which calls getProject +
// subscribeProjectRepositoryChange from @/db/projectRepository -- neither
// of which this file's @/db/projectRepository mock (below) used to define,
// so useProject's effect threw "No subscribeProjectRepositoryChange export
// is defined on the mock" and every test in this file failed to render
// (pre-existing gap from the useLiveQuery -> useProject refactor, unrelated
// to the isAdmin -> appRole RBAC consolidation, but it blocks verifying
// that consolidation via this suite, so fixing it here too). repoListener
// lets a test simulate a repository-change push (as real updateProject
// calls do via emitProjectRepositoryChange) by re-running getProject.
// Because loading is now genuinely async (a resolved Promise, not a
// synchronous useLiveQuery return), assertions right after render must use
// findBy*/waitFor instead of a bare getBy* on the very first check. ──
let repoListener: ((projectId?: string) => void) | null = null;

// ── Mock contexts/AuthContext — ProjectWorkspace.tsx calls useAuth()
// unconditionally at the top of the component; without this mock,
// useAuth() throws "must be used inside <AuthProvider>" and every test in
// this file fails to render (pre-existing gap, unrelated to the
// isAdmin -> appRole RBAC consolidation, but must be fixed for any of these
// tests to actually exercise real component behavior). ──
vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-user-1', email: 'owner@example.com' }, session: null, loading: false, adminMode: false, signOut: vi.fn() }),
}));

// ── Mock @/db/projectRepository ──
const updateProjectMock = vi.fn();
const updateAgentRunMock = vi.fn();
vi.mock('@/db/projectRepository', () => ({
  getProject: (...args: unknown[]) => Promise.resolve(currentProject),
  updateProject: (...args: unknown[]) => updateProjectMock(...args),
  updateAgentRun: (...args: unknown[]) => updateAgentRunMock(...args),
  subscribeProjectRepositoryChange: (listener: (projectId?: string) => void) => {
    repoListener = listener;
    return () => { repoListener = null; };
  },
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
// callAgent must resolve (not return undefined) — ProjectWorkspace pings it
// on mount via `testMode: true` to check API key availability, and chains
// .then()/.catch() directly off the call.
vi.mock('@/services/api', () => ({
  api: {
    callAgent: vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    }),
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
  // Exposes the real onApprove/onReject callbacks ProjectWorkspace wires up
  // (see the reject-persistence test below) rather than just rendering a
  // stub div — the real approve/reject UI and mandatory-field validation are
  // covered in ReviewGateModal-core.test.tsx; this suite only needs to
  // verify ProjectWorkspace threads the callback results into updateProject
  // correctly.
  default: (props: { gateId: string; onApprove: (notes: string, approvedById?: string) => void; onReject: (notes: string, actingAsId?: string) => void }) => (
    <div data-testid="review-gate-modal" data-gate-id={props.gateId}>
      <button onClick={() => props.onReject('Missing the compliance section, please redo.', 'member-1')}>
        mock-reject
      </button>
      <button onClick={() => props.onApprove('Looks good.', 'member-1')}>mock-approve</button>
    </div>
  ),
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
    // Every real project always has ownerId set (immutable, seeded at
    // creation server-side) -- it's the safety-net fallback
    // (ownerFallbackMember in projectAccess.ts) that resolves "who am I"
    // when teamMembers has no matching entry, e.g. a brand-new project with
    // no team added yet (TS-178). Matches the mocked useAuth() user id above.
    ownerId: 'owner-user-1',
    agentRuns: {},
    reviewGates: {
      gate0: { id: 'gate0', approved: true, afterPhases: [] },
      gate1: { id: 'gate1', approved: true, afterPhases: [] },
      gate2: { id: 'gate2', approved: true, afterPhases: [] },
      gate3: { id: 'gate3', approved: true, afterPhases: [] },
      gate5: { id: 'gate5', approved: true, afterPhases: [] },
      // gate6 intentionally omitted: phase6 is empty, gate6 never fires
    },
    promptOverrides: [],
    mode: 'simple',
    teamMembers: [
      // appRole is the sole authority for admin gating now (isAdmin is
      // deprecated) -- this fixture used to carry only isAdmin: true, which
      // would silently disable "Run Pipeline"/"Settings" once AuthContext
      // is mocked and the component actually renders, since
      // canRunProjectAgents/canEditProjectSettings derive from
      // ROLE_PERMISSIONS[currentMember.appRole].
      { id: 'member-1', name: 'Alice Admin', email: 'alice@example.com', role: 'Admin', appRole: 'project_owner', avatarColor: '#fff' },
    ],
    activeAdminId: 'member-1',
    agentAssignments: [],
    // This suite tests run/stop control mechanics, not the team-assignment
    // warning flow (that gets its own dedicated test file). Without this,
    // every "Run Pipeline" click here would hit TeamAssignmentWarningModal
    // instead of calling engine.run() directly, since agentAssignments is
    // empty above -- see lib/agentEnablement.ts's getUnassignedAgents().
    teamAssignmentWarningAcknowledged: true,
    ...overrides,
  } as unknown as Project;
}

const noop = () => {};

describe('ProjectWorkspace — run/stop controls', () => {
  beforeEach(() => {
    currentProject = undefined;
    repoListener = null;
    lastEngineCallbacks = null;
    updateProjectMock.mockClear();
    updateAgentRunMock.mockClear();
    engineRunMock.mockClear();
    engineAbortMock.mockClear();
  });

  it('shows "Run Pipeline" when status is draft (TS-174)', async () => {
    currentProject = baseProject({ status: 'draft' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(await screen.findByRole('button', { name: 'Run Pipeline' })).toBeInTheDocument();
  });

  it('shows "Resume Pipeline" when status is paused (TS-175)', async () => {
    currentProject = baseProject({ status: 'paused' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(await screen.findByRole('button', { name: 'Resume Pipeline' })).toBeInTheDocument();
  });

  it('shows "Complete" and disables the button when status is complete (TS-176)', async () => {
    currentProject = baseProject({ status: 'complete' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    const btn = await screen.findByRole('button', { name: 'Complete' });
    expect(btn).toBeDisabled();
  });

  it('disables the run button with a tooltip when there are no team members (TS-177)', async () => {
    currentProject = baseProject({ status: 'draft', teamMembers: [] });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    const btn = await screen.findByRole('button', { name: 'Run Pipeline' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Add at least one team member to run the pipeline');
  });

  it('shows the team-required banner when teamMembers is empty, hidden otherwise (TS-178)', async () => {
    currentProject = baseProject({ teamMembers: [] });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(
      await screen.findByText(/Add at least one team member before running the pipeline/i)
    ).toBeInTheDocument();

    // useProject() only refetches on a repository-change push (or a
    // projectId change) -- simulate the push a real updateProject() call
    // would emit, the same way production code picks up team-member edits
    // made in the Settings panel while this view stays mounted.
    currentProject = baseProject({
      teamMembers: [{ id: 'm1', name: 'Alice', email: 'a@x.com', role: 'Admin', appRole: 'project_owner', avatarColor: '#fff' }],
    });
    repoListener?.();

    await waitFor(() => {
      expect(screen.queryByText(/Add at least one team member before running the pipeline/i)).not.toBeInTheDocument();
    });
  });

  it('clicking "Run Pipeline" constructs a PipelineEngine and calls run(currentPhase) (TS-179)', async () => {
    currentProject = baseProject({ status: 'draft', currentPhase: 'phase1' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Run Pipeline' }));

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
    await user.click(await screen.findByRole('button', { name: 'Run Pipeline' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });
  });

  it('clicking "Stop" aborts the engine and persists status: paused (TS-181)', async () => {
    currentProject = baseProject({ status: 'draft' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Run Pipeline' }));
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
    await user.click(await screen.findByRole('button', { name: 'Run Pipeline' }));
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

  it('rejecting a gate persists rejectedAt/rejectedBy/notes, leaves approved false, and keeps the project paused (TS-192)', async () => {
    currentProject = baseProject({ status: 'draft' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Run Pipeline' }));
    await waitFor(() => expect(lastEngineCallbacks).toBeTruthy());
    lastEngineCallbacks.onGateReached('gate1');
    await screen.findByTestId('review-gate-modal');

    updateProjectMock.mockClear();
    await user.click(screen.getByRole('button', { name: 'mock-reject' }));

    expect(updateProjectMock).toHaveBeenCalledWith('proj-1', expect.any(Function));
    const mutator = updateProjectMock.mock.calls[updateProjectMock.mock.calls.length - 1][1];
    const draft: any = { reviewGates: {}, status: 'running' };
    mutator(draft);

    expect(draft.reviewGates.gate1.approved).toBe(false);
    expect(draft.reviewGates.gate1.rejectedBy).toBe('member-1');
    expect(draft.reviewGates.gate1.notes).toBe('Missing the compliance section, please redo.');
    expect(draft.reviewGates.gate1.rejectedAt).toEqual(expect.any(Number));
    // Rejecting never advances the pipeline — stays paused, not running.
    expect(draft.status).toBe('paused');

    // Modal closes after rejection.
    await waitFor(() => expect(screen.queryByTestId('review-gate-modal')).not.toBeInTheDocument());
  });

  it('shows a clickable "Enable" bypass for an admin/owner on a skipped agent, which clears skippedAgentIds (TS-193)', async () => {
    const skippedAgentId = PHASE_AGENTS.phase1[0];
    currentProject = baseProject({
      status: 'paused',
      agentRuns: { [skippedAgentId]: { agentId: skippedAgentId, status: 'skipped' } } as Project['agentRuns'],
      skippedAgentIds: [skippedAgentId],
    });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    await screen.findByText(AGENT_DEFINITIONS[skippedAgentId]?.name ?? skippedAgentId);
    expect(screen.queryByText(/Locked/)).not.toBeInTheDocument();
    const enableBtn = screen.getByRole('button', { name: 'Enable' });

    const user = userEvent.setup();
    await user.click(enableBtn);

    expect(updateProjectMock).toHaveBeenCalledWith('proj-1', expect.any(Function));
    const mutator = updateProjectMock.mock.calls[updateProjectMock.mock.calls.length - 1][1];
    const draft: any = { skippedAgentIds: [skippedAgentId] };
    mutator(draft);
    expect(draft.skippedAgentIds).not.toContain(skippedAgentId);
  });

  it('shows a locked indicator (no bypass button) for a non-admin member on a skipped agent (TS-194)', async () => {
    const skippedAgentId = PHASE_AGENTS.phase1[0];
    currentProject = baseProject({
      status: 'paused',
      // Break the ownerId fallback (see projectAccess.ts ownerFallbackMember)
      // so the mocked "owner@example.com" user resolves to this Editor
      // teamMember instead of a synthesized project owner.
      ownerId: 'someone-else',
      teamMembers: [
        { id: 'member-2', name: 'Eve Editor', email: 'owner@example.com', role: 'Engineer', appRole: 'editor', avatarColor: '#0891b2' },
      ],
      activeAdminId: 'member-2',
      agentRuns: { [skippedAgentId]: { agentId: skippedAgentId, status: 'skipped' } } as Project['agentRuns'],
    });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    await screen.findByText(AGENT_DEFINITIONS[skippedAgentId]?.name ?? skippedAgentId);
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument();
    expect(screen.getByText(/Locked/)).toHaveAttribute(
      'title',
      'This agent is unassigned and can only be bypassed by a Project Owner or Admin.'
    );
  });

  it('auto-opens the settings panel on first render when teamMembers is empty (TS-183)', async () => {
    currentProject = baseProject({ teamMembers: [] });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    expect(await screen.findByTestId('project-settings')).toBeInTheDocument();
  });

  it('clicking "⚙ Settings" opens the settings panel when team is non-empty (TS-184)', async () => {
    currentProject = baseProject();
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);
    // Wait for the loaded state before asserting the settings panel is
    // absent — otherwise this could pass trivially while still loading.
    await screen.findByRole('button', { name: /settings/i });
    expect(screen.queryByTestId('project-settings')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /settings/i }));

    expect(screen.getByTestId('project-settings')).toBeInTheDocument();
  });

  it('clicking the Simple/Expert toggle calls updateProject to flip project.mode (TS-185)', async () => {
    currentProject = baseProject({ mode: 'simple' });
    render(<ProjectWorkspace projectId="proj-1" onBack={noop} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /expert mode/i }));

    expect(updateProjectMock).toHaveBeenCalledWith('proj-1', expect.any(Function));
    const mutator = updateProjectMock.mock.calls[updateProjectMock.mock.calls.length - 1][1];
    const draft: any = { mode: 'simple' };
    mutator(draft);
    expect(draft.mode).toBe('expert');
  });
});
