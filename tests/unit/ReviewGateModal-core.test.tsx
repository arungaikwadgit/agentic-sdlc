// tests/unit/ReviewGateModal-core.test.tsx
// Real-component RTL test for ReviewGateModal.tsx — covers the core review
// gate workflow: agent list, view/edit output, approve/reject, assignee
// badges, the approver selector, and the approve/reject authorization +
// completeness gating added alongside the mandatory-approver/mandatory-
// rejection-comment requirements. Covers TS-60 through TS-74, plus TS-86
// through TS-91 (approve/reject role restriction, mandatory approver,
// mandatory rejection comment, and hide-when-incomplete) from
// docs/test-plans/review-gates-test-plan.md.
//
// Prompt sandbox mode is covered separately in
// ReviewGateModal-prompt-sandbox.test.tsx (different mocking needs).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';
import { PHASE_AGENTS, PHASE_LABELS, REVIEW_GATES } from '../../frontend/src/agents/constants';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';

// ── Mock contexts/AuthContext — ReviewGateModal.tsx calls useAuth()
// unconditionally at the top of the component. Hoisted + mutable so
// individual tests can swap the "current user" identity to exercise the
// getReviewGatePermission() role gate (project owner / PM / EM / PdM / admin
// vs everyone else) without a full remock per test. Defaults to
// asha@example.com, which matches teamMembers[0] (project_owner) in
// makeProject() below, so every pre-existing test that doesn't care about
// identity keeps working unchanged.
const mockAuth = vi.hoisted(() => ({
  userId: 'owner-user-1',
  userEmail: 'asha@example.com',
  adminMode: false,
  isAppAdmin: false,
}));
vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: mockAuth.userId, email: mockAuth.userEmail },
    session: null,
    loading: false,
    adminMode: mockAuth.adminMode,
    isAppAdmin: mockAuth.isAppAdmin,
    signOut: vi.fn(),
  }),
}));

// ── Mock heavy/child components ─────────────────────────────────────────────
vi.mock('../../frontend/src/components/documents/DocumentViewer', () => ({
  default: ({ markdown }: { markdown: string }) => (
    <div data-testid="document-viewer">{markdown}</div>
  ),
}));

vi.mock('../../frontend/src/components/documents/ExportMenu', () => ({
  default: () => <div data-testid="export-menu" />,
}));

// ── Mock db/projectRepository ───────────────────────────────────────────────
const updateAgentRunMock = vi.fn(async () => undefined);
const updateProjectMock = vi.fn(async (_id: string, updater: (p: Project) => void | Project) => {
  const clone = structuredClone(currentProject);
  const result = updater(clone);
  return result ?? clone;
});

vi.mock('../../frontend/src/db/projectRepository', () => ({
  updateAgentRun: (...args: unknown[]) => updateAgentRunMock(...(args as [string, string, object])),
  updateProject: (...args: Parameters<typeof updateProjectMock>) => updateProjectMock(...args),
}));

// ── Mock services/api (imported transitively, not exercised here) ──────────
vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn(),
    extractText: vi.fn(),
    enhancePrompt: vi.fn(),
  },
}));

// ── Mock prompt defaults / sanitize (imported transitively) ────────────────
vi.mock('../../frontend/src/agents/promptDefaults', () => ({
  getEffectivePromptDefault: vi.fn(async () => 'DEFAULT SYSTEM PROMPT'),
}));

vi.mock('../../frontend/src/utils/sanitize', () => ({
  checkPromptInjection: vi.fn(() => ({ safe: true })),
}));

import ReviewGateModal from '../../frontend/src/components/reviewGate/ReviewGateModal';

// gate3 covers phase3 + phase3b — 6 agents combined (architecture, apiDesign,
// uxResearch, interaction, uxMockups, securityCompliance).
const GATE_ID = 'gate3' as const;
const PHASE3_AGENTS = PHASE_AGENTS.phase3;
const PHASE3B_AGENTS = PHASE_AGENTS.phase3b;
const ALL_GATE_AGENTS = [...PHASE3_AGENTS, ...PHASE3B_AGENTS];

const COMPLETE_AGENT = PHASE3_AGENTS[0]; // 'architecture'
const IDLE_AGENT = PHASE3_AGENTS[1]; // 'apiDesign'

let currentProject: Project;

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    domain: 'saas',
    status: 'paused',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    currentPhase: 'phase3',
    agentRuns: {
      [COMPLETE_AGENT]: {
        agentId: COMPLETE_AGENT,
        status: 'complete',
        output: '# Stakeholder Analysis\n\nContent here.',
        completedAt: Date.now(),
      },
      [IDLE_AGENT]: {
        agentId: IDLE_AGENT,
        status: 'idle',
      },
    } as Project['agentRuns'],
    reviewGates: {},
    promptOverrides: [],
    mode: 'expert',
    teamMembers: [
      // m1 (Asha) is the project owner and the default mocked identity above
      // — getReviewGatePermission() grants project owners regardless of job
      // title. m2 (Raj) is an Engineer editor: not project_owner and not one
      // of the PM/EM/PdM approver titles, so canActOnGate is false for them
      // — used by the role-restriction tests below.
      { id: 'm1', name: 'Asha Patel', email: 'asha@example.com', role: 'Product Manager', appRole: 'project_owner', avatarColor: '#4f46e5' },
      { id: 'm2', name: 'Raj Kumar', email: 'raj@example.com', role: 'Engineering Lead', appRole: 'editor', avatarColor: '#16a34a' },
    ],
    agentAssignments: [
      { agentId: COMPLETE_AGENT, memberIds: ['m1'] },
    ],
    ...overrides,
  } as Project;
}

const REAL_GATE3_AGENTS = REVIEW_GATES.gate3.flatMap((p) => PHASE_AGENTS[p] ?? []);

function allGateAgentsCompleteProject(overrides: Partial<Project> = {}): Project {
  const agentRuns = Object.fromEntries(
    REAL_GATE3_AGENTS.map((agentId) => [agentId, { agentId, status: 'complete', output: `# ${agentId} output` }])
  ) as Project['agentRuns'];
  return makeProject({ agentRuns, ...overrides });
}

describe('ReviewGateModal — core (view/edit/approve/reject)', () => {
  let onApprove: ReturnType<typeof vi.fn>;
  let onReject: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    currentProject = makeProject();
    onApprove = vi.fn();
    onReject = vi.fn();
    onClose = vi.fn();
    mockAuth.userId = 'owner-user-1';
    mockAuth.userEmail = 'asha@example.com';
    mockAuth.adminMode = false;
    mockAuth.isAppAdmin = false;
  });

  function renderModal(project: Project = currentProject) {
    currentProject = project;
    return render(
      <ReviewGateModal
        gateId={GATE_ID}
        project={project}
        onApprove={onApprove}
        onReject={onReject}
        onClose={onClose}
      />
    );
  }

  // TS-60
  it('renders the gate title and phase subtitle', () => {
    renderModal();
    expect(screen.getByText('Phase 3 & 3B Review Gate')).toBeInTheDocument();
    const subtitle = screen.getByText(/Review outputs before the pipeline continues/);
    expect(subtitle.textContent).toContain(PHASE_LABELS.phase3);
    expect(subtitle.textContent).toContain(PHASE_LABELS.phase3b);
  });

  // TS-61
  it('renders one button per agent in the gate phases', () => {
    renderModal();
    for (const agentId of ALL_GATE_AGENTS) {
      const label = AGENT_DEFINITIONS[agentId]?.outputLabel ?? agentId;
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  // TS-62
  it('shows a checkmark for a completed agent and a circle for an idle agent', () => {
    renderModal();
    const completeLabel = AGENT_DEFINITIONS[COMPLETE_AGENT]?.outputLabel ?? COMPLETE_AGENT;
    const idleLabel = AGENT_DEFINITIONS[IDLE_AGENT]?.outputLabel ?? IDLE_AGENT;

    const completeButton = screen.getByText(completeLabel).closest('button')!;
    const idleButton = screen.getByText(idleLabel).closest('button')!;

    expect(completeButton.textContent).toContain('✓');
    expect(idleButton.textContent).toContain('○');
  });

  // TS-63 + TS-64
  it('defaults to the first agent and renders its output via DocumentViewer', () => {
    renderModal();
    // First agent in PHASE3_AGENTS is the default selectedAgent.
    const firstAgent = ALL_GATE_AGENTS[0];
    if (firstAgent === COMPLETE_AGENT) {
      const viewer = screen.getByTestId('document-viewer');
      expect(viewer.textContent).toContain('Stakeholder Analysis');
    }
  });

  // TS-65
  it('shows "No output available" for an agent with no completed output', async () => {
    renderModal();
    const idleLabel = AGENT_DEFINITIONS[IDLE_AGENT]?.outputLabel ?? IDLE_AGENT;
    await userEvent.click(screen.getByText(idleLabel));

    const idleName = AGENT_DEFINITIONS[IDLE_AGENT]?.name;
    expect(screen.getByText(new RegExp(`No output available for ${idleName}`))).toBeInTheDocument();
    expect(screen.queryByTestId('document-viewer')).not.toBeInTheDocument();
  });

  // TS-66
  it('disables "Edit Output" for an agent with no completed run', async () => {
    renderModal();
    const idleLabel = AGENT_DEFINITIONS[IDLE_AGENT]?.outputLabel ?? IDLE_AGENT;
    await userEvent.click(screen.getByText(idleLabel));

    const editTab = screen.getByRole('button', { name: 'Edit Output' });
    expect(editTab).toBeDisabled();
  });

  // TS-67
  it('enables "Edit Output" for a completed agent and pre-fills the textarea', async () => {
    renderModal();
    const completeLabel = AGENT_DEFINITIONS[COMPLETE_AGENT]?.outputLabel ?? COMPLETE_AGENT;
    await userEvent.click(screen.getByText(completeLabel));

    const editTab = screen.getByRole('button', { name: 'Edit Output' });
    expect(editTab).not.toBeDisabled();

    await userEvent.click(editTab);

    // Two textareas are present (edit output + the always-visible notes bar);
    // the edit textarea is the one pre-filled with the agent's output.
    const textarea = screen.getAllByRole('textbox').find((el) =>
      (el as HTMLTextAreaElement).value.includes('Stakeholder Analysis')
    ) as HTMLTextAreaElement;
    expect(textarea).toBeDefined();
    expect(textarea.value).toContain('Stakeholder Analysis');
  });

  // TS-68
  it('"Save Edits" calls updateAgentRun with the new text and returns to view mode', async () => {
    renderModal();
    const completeLabel = AGENT_DEFINITIONS[COMPLETE_AGENT]?.outputLabel ?? COMPLETE_AGENT;
    await userEvent.click(screen.getByText(completeLabel));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Output' }));

    const textarea = screen.getAllByRole('textbox').find((el) =>
      (el as HTMLTextAreaElement).value.includes('Stakeholder Analysis')
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: '# Updated Output\n\nNew content.' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save Edits' }));

    expect(updateAgentRunMock).toHaveBeenCalledWith(
      'proj-1',
      COMPLETE_AGENT,
      { output: '# Updated Output\n\nNew content.' }
    );

    // Back in view mode, showing the edited content via the (mocked) viewer.
    expect(await screen.findByTestId('document-viewer')).toBeInTheDocument();
  });

  // TS-69
  it('"Save Edits" is a no-op when the textarea is emptied', async () => {
    renderModal();
    const completeLabel = AGENT_DEFINITIONS[COMPLETE_AGENT]?.outputLabel ?? COMPLETE_AGENT;
    await userEvent.click(screen.getByText(completeLabel));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Output' }));

    const textarea = screen.getAllByRole('textbox').find((el) =>
      (el as HTMLTextAreaElement).value.includes('Stakeholder Analysis')
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: '   ' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save Edits' }));

    expect(updateAgentRunMock).not.toHaveBeenCalled();
  });

  // TS-70
  it('"Cancel" in edit mode discards changes and returns to view', async () => {
    renderModal();
    const completeLabel = AGENT_DEFINITIONS[COMPLETE_AGENT]?.outputLabel ?? COMPLETE_AGENT;
    await userEvent.click(screen.getByText(completeLabel));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Output' }));

    const textarea = screen.getAllByRole('textbox').find((el) =>
      (el as HTMLTextAreaElement).value.includes('Stakeholder Analysis')
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Discard me' } });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(updateAgentRunMock).not.toHaveBeenCalled();
    const viewer = await screen.findByTestId('document-viewer');
    expect(viewer.textContent).toContain('Stakeholder Analysis');
    expect(viewer.textContent).not.toContain('Discard me');
  });

  // TS-71
  it('renders assignee badges for team members assigned to agents in this gate', () => {
    renderModal();
    const badge = screen.getByTitle('Asha Patel (Product Manager)');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('AP');
  });

  it('does not render assignee badges when no one is assigned', () => {
    renderModal(makeProject({ agentAssignments: [] }));
    expect(screen.queryByText('Assigned:')).not.toBeInTheDocument();
  });

  // TS-72 — the approver select only renders once every gate agent has
  // finished (see the incomplete-agents hide test below), so this needs the
  // all-complete fixture now that Approve/Reject/select are hidden (not just
  // disabled) while any agent is still running.
  it('"Approving as..." select lists all team members', () => {
    renderModal(allGateAgentsCompleteProject());
    const select = screen.getByTitle('Who is approving?');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Asha Patel (Product Manager)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Raj Kumar (Engineering Lead)' })).toBeInTheDocument();
  });

  it('hides the approver select and assignee badges when there are no team members', () => {
    renderModal(makeProject({ teamMembers: [], agentAssignments: [] }));
    expect(screen.queryByTitle('Who is approving?')).not.toBeInTheDocument();
    expect(screen.queryByText('Assigned:')).not.toBeInTheDocument();
  });

  // TS-73
  it('"Approve & Continue" calls onApprove with notes and the selected approver id', async () => {
    renderModal(allGateAgentsCompleteProject());

    const notesBox = screen.getByPlaceholderText(/Add notes or feedback for this review gate/);
    await userEvent.type(notesBox, 'Looks good, ship it.');

    const select = screen.getByTitle('Who is approving?');
    fireEvent.change(select, { target: { value: 'm2' } });

    await userEvent.click(screen.getByRole('button', { name: /Approve & Continue/ }));

    expect(onApprove).toHaveBeenCalledWith('Looks good, ship it.', 'm2');
  });

  // TS-86 — mandatory approver selection (new requirement).
  it('"Approve & Continue" stays disabled until an approver is selected', async () => {
    renderModal(allGateAgentsCompleteProject());

    const approveBtn = screen.getByRole('button', { name: /Approve & Continue/ });
    expect(approveBtn).toBeDisabled();

    await userEvent.click(approveBtn);
    expect(onApprove).not.toHaveBeenCalled();

    const select = screen.getByTitle('Who is approving?');
    fireEvent.change(select, { target: { value: 'm1' } });
    expect(approveBtn).not.toBeDisabled();

    await userEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalledWith('', 'm1');
  });

  // TS-74 / TS-87 — mandatory rejection comment (new requirement): reject
  // must carry a non-empty review note.
  it('"Reject & Stop" stays disabled without a review comment, and calls onReject with the comment once one is entered', async () => {
    renderModal(allGateAgentsCompleteProject());

    const rejectBtn = screen.getByRole('button', { name: /Reject & Stop/ });
    expect(rejectBtn).toBeDisabled();

    await userEvent.click(rejectBtn);
    expect(onReject).not.toHaveBeenCalled();

    const notesBox = screen.getByPlaceholderText(/Add notes or feedback for this review gate/);
    await userEvent.type(notesBox, 'Missing the auth section, please redo.');
    expect(rejectBtn).not.toBeDisabled();

    await userEvent.click(rejectBtn);
    expect(onReject).toHaveBeenCalledWith('Missing the auth section, please redo.', undefined);
    expect(onApprove).not.toHaveBeenCalled();
  });

  // TS-88 — incomplete-agents hides Approve/Reject entirely (not just
  // disables Approve, as before). The default makeProject() fixture leaves
  // most gate3 agents idle.
  it('hides Approve/Reject and shows a waiting note while a gate agent has not finished', () => {
    renderModal();

    expect(screen.queryByRole('button', { name: /Approve & Continue/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject & Stop/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Who is approving?')).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting on \d+ agents? to finish/)).toBeInTheDocument();
  });

  // TS-89/90/91 — role restriction: only the Project Owner, an admin, or a
  // member whose job title is in REVIEW_GATE_APPROVER_TITLES may act.
  it('hides Approve/Reject and shows a restricted note for a member without an approver role', () => {
    mockAuth.userEmail = 'raj@example.com'; // editor, "Engineering Lead" — not in the approver title list
    renderModal(allGateAgentsCompleteProject());

    expect(screen.queryByRole('button', { name: /Approve & Continue/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject & Stop/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Who is approving?')).not.toBeInTheDocument();
    expect(screen.getByText(/Only the Project Owner, Product Manager, Project Manager, Engineering Manager, Delivery Manager, Architect, or an admin/)).toBeInTheDocument();
  });

  it('grants access to a non-owner member whose job title is Architect (the design/QA-bucket pick)', () => {
    mockAuth.userEmail = 'sam@example.com';
    renderModal(allGateAgentsCompleteProject({
      teamMembers: [
        ...makeProject().teamMembers!,
        { id: 'm4', name: 'Sam Torres', email: 'sam@example.com', role: 'Architect', appRole: 'editor', avatarColor: '#0d9488' },
      ],
    }));

    expect(screen.getByRole('button', { name: /Approve & Continue/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject & Stop/ })).toBeInTheDocument();
  });

  it('denies access to a non-owner member whose job title is QA Engineer (not on the approved list)', () => {
    mockAuth.userEmail = 'qa@example.com';
    renderModal(allGateAgentsCompleteProject({
      teamMembers: [
        ...makeProject().teamMembers!,
        { id: 'm5', name: 'Quinn Adler', email: 'qa@example.com', role: 'QA Engineer', appRole: 'editor', avatarColor: '#dc2626' },
      ],
    }));

    expect(screen.queryByRole('button', { name: /Approve & Continue/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject & Stop/ })).not.toBeInTheDocument();
  });

  it('grants access to a non-owner member whose job title is Project Manager', () => {
    mockAuth.userEmail = 'priya@example.com';
    renderModal(allGateAgentsCompleteProject({
      teamMembers: [
        ...makeProject().teamMembers!,
        { id: 'm3', name: 'Priya Shah', email: 'priya@example.com', role: 'Project Manager', appRole: 'editor', avatarColor: '#d97706' },
      ],
    }));

    expect(screen.getByRole('button', { name: /Approve & Continue/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject & Stop/ })).toBeInTheDocument();
  });

  it('grants access to an app admin regardless of project role', () => {
    mockAuth.userEmail = 'raj@example.com'; // same non-approver member as above
    mockAuth.isAppAdmin = true;
    renderModal(allGateAgentsCompleteProject());

    expect(screen.getByRole('button', { name: /Approve & Continue/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject & Stop/ })).toBeInTheDocument();
  });

  it('the close ("✕") button calls onClose', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
