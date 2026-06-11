// tests/unit/ReviewGateModal-core.test.tsx
// Real-component RTL test for ReviewGateModal.tsx — covers the core review
// gate workflow: agent list, view/edit output, approve/reject, assignee
// badges, and the approver selector. Covers TS-60 through TS-74 from
// docs/test-plans/review-gates-test-plan.md.
//
// Prompt sandbox mode is covered separately in
// ReviewGateModal-prompt-sandbox.test.tsx (different mocking needs).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';
import { PHASE_AGENTS, PHASE_LABELS } from '../../frontend/src/agents/constants';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';

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

// gate2_3 covers phase2 + phase3 — 10 agents combined, the richest agent
// list among the four gates without being phase4 (which isn't gated).
const GATE_ID = 'gate2_3' as const;
const PHASE2_AGENTS = PHASE_AGENTS.phase2;
const PHASE3_AGENTS = PHASE_AGENTS.phase3;
const ALL_GATE_AGENTS = [...PHASE2_AGENTS, ...PHASE3_AGENTS];

const COMPLETE_AGENT = PHASE2_AGENTS[0]; // e.g. 'stakeholder'
const IDLE_AGENT = PHASE2_AGENTS[1]; // e.g. 'userStory'

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
    currentPhase: 'phase2',
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
      { id: 'm1', name: 'Asha Patel', email: 'asha@example.com', role: 'Product Manager', avatarColor: '#4f46e5', isAdmin: true },
      { id: 'm2', name: 'Raj Kumar', email: 'raj@example.com', role: 'Engineering Lead', avatarColor: '#16a34a', isAdmin: false },
    ],
    agentAssignments: [
      { agentId: COMPLETE_AGENT, memberIds: ['m1'] },
    ],
    ...overrides,
  } as Project;
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
    expect(screen.getByText('Phase 2 & 3 Review Gate')).toBeInTheDocument();
    const subtitle = screen.getByText(/Review outputs before the pipeline continues/);
    expect(subtitle.textContent).toContain(PHASE_LABELS.phase2);
    expect(subtitle.textContent).toContain(PHASE_LABELS.phase3);
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
    // First agent in PHASE2_AGENTS is the default selectedAgent.
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

  // TS-72
  it('"Approving as..." select lists all team members', () => {
    renderModal();
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
    renderModal();

    const notesBox = screen.getByPlaceholderText('Add notes or feedback for this review gate...');
    await userEvent.type(notesBox, 'Looks good, ship it.');

    const select = screen.getByTitle('Who is approving?');
    fireEvent.change(select, { target: { value: 'm2' } });

    await userEvent.click(screen.getByRole('button', { name: /Approve & Continue/ }));

    expect(onApprove).toHaveBeenCalledWith('Looks good, ship it.', 'm2');
  });

  it('"Approve & Continue" passes undefined approver id when none selected', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /Approve & Continue/ }));
    expect(onApprove).toHaveBeenCalledWith('', undefined);
  });

  // TS-74
  it('"Reject & Stop" calls onReject without calling onApprove', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /Reject & Stop/ }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('the close ("✕") button calls onClose', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
