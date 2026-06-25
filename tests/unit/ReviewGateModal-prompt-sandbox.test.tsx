// tests/unit/ReviewGateModal-prompt-sandbox.test.tsx
// Real-component RTL test for ReviewGateModal.tsx — covers the Prompt
// Sandbox panel: loading saved/default prompts, injection detection,
// dry-run (success/error/confirm), enhance, save-for-project, and the
// downstream-agents hint. Covers TS-75 through TS-85 from
// docs/test-plans/review-gates-test-plan.md.
//
// View/edit/approve/reject flows are covered separately in
// ReviewGateModal-core.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';
import { PHASE_AGENTS } from '../../frontend/src/agents/constants';
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

// ── Mock services/api ───────────────────────────────────────────────────────
const callAgentMock = vi.fn();
const extractTextMock = vi.fn();
const enhancePromptMock = vi.fn();

vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: (...args: unknown[]) => callAgentMock(...args),
    extractText: (...args: unknown[]) => extractTextMock(...args),
    enhancePrompt: (...args: unknown[]) => enhancePromptMock(...args),
  },
}));

// ── Mock prompt defaults ────────────────────────────────────────────────────
const getEffectivePromptDefaultMock = vi.fn(async () => 'DEFAULT SYSTEM PROMPT');

vi.mock('../../frontend/src/agents/promptDefaults', () => ({
  getEffectivePromptDefault: (...args: unknown[]) => getEffectivePromptDefaultMock(...args),
}));

// ── Mock prompt-injection check ─────────────────────────────────────────────
const checkPromptInjectionMock = vi.fn(() => ({ safe: true as boolean, matchedPattern: undefined as string | undefined }));

vi.mock('../../frontend/src/utils/sanitize', () => ({
  checkPromptInjection: (...args: unknown[]) => checkPromptInjectionMock(...args),
}));

import ReviewGateModal from '../../frontend/src/components/reviewGate/ReviewGateModal';

const GATE_ID = 'gate3' as const;
const PHASE3_AGENTS = PHASE_AGENTS.phase3; // ['architecture', 'apiDesign', 'uxResearch', 'interaction', 'uxMockups']
const PHASE3B_AGENTS = PHASE_AGENTS.phase3b; // ['securityCompliance']

// 'uxResearch' (phase3) is in `interaction`'s dependsOn — both are
// inside gate3, giving us a same-gate downstream-agent relationship.
const AGENT_WITH_DOWNSTREAM = 'uxResearch' as const;
const AGENT_WITHOUT_DOWNSTREAM = 'uxMockups' as const; // nothing in AGENT_DEFINITIONS depends on uxMockups

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
      [AGENT_WITH_DOWNSTREAM]: {
        agentId: AGENT_WITH_DOWNSTREAM,
        status: 'complete',
        output: '# UX Research\n\nFindings here.',
        completedAt: Date.now(),
      },
    } as Project['agentRuns'],
    reviewGates: {},
    promptOverrides: [],
    mode: 'expert',
    teamMembers: [],
    agentAssignments: [],
    ...overrides,
  } as Project;
}

describe('ReviewGateModal — prompt sandbox', () => {
  let onApprove: ReturnType<typeof vi.fn>;
  let onReject: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    checkPromptInjectionMock.mockReturnValue({ safe: true, matchedPattern: undefined });
    getEffectivePromptDefaultMock.mockResolvedValue('DEFAULT SYSTEM PROMPT');
    currentProject = makeProject();
    onApprove = vi.fn();
    onReject = vi.fn();
    onClose = vi.fn();
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
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

  async function selectAgent(agentId: string) {
    const label = AGENT_DEFINITIONS[agentId as keyof typeof AGENT_DEFINITIONS]?.outputLabel ?? agentId;
    await userEvent.click(screen.getByText(label));
  }

  async function openPromptSandbox() {
    await userEvent.click(screen.getByRole('button', { name: 'Prompt Sandbox' }));
  }

  function getPromptTextarea(): HTMLTextAreaElement {
    // The prompt-sandbox textarea has an explicit inline height; the notes
    // bar textarea does not.
    return screen.getAllByRole('textbox').find((el) => {
      const ta = el as HTMLTextAreaElement;
      return ta.style.height === '180px';
    }) as HTMLTextAreaElement;
  }

  // TS-75
  it('loads the saved prompt override when one exists', async () => {
    renderModal(makeProject({
      promptOverrides: [{ agentId: AGENT_WITH_DOWNSTREAM, patch: [], fullPrompt: 'CUSTOM PROMPT', updatedAt: Date.now() }],
    }));
    await selectAgent(AGENT_WITH_DOWNSTREAM);
    await openPromptSandbox();

    const textarea = await waitFor(() => getPromptTextarea());
    expect(textarea.value).toBe('CUSTOM PROMPT');
    expect(screen.getByText(/has a saved custom prompt for this project/)).toBeInTheDocument();
  });

  // TS-76
  it('falls back to the app-level default when no override exists', async () => {
    renderModal(); // promptOverrides: []
    await selectAgent(AGENT_WITH_DOWNSTREAM);
    await openPromptSandbox();

    const textarea = await waitFor(() => getPromptTextarea());
    expect(textarea.value).toBe('DEFAULT SYSTEM PROMPT');
    expect(getEffectivePromptDefaultMock).toHaveBeenCalledWith(AGENT_WITH_DOWNSTREAM);
    expect(screen.queryByText(/has a saved custom prompt for this project/)).not.toBeInTheDocument();
  });

  // TS-77
  it('shows an injection warning when checkPromptInjection flags the edited prompt', async () => {
    renderModal();
    await selectAgent(AGENT_WITH_DOWNSTREAM);
    await openPromptSandbox();
    const textarea = await waitFor(() => getPromptTextarea());

    checkPromptInjectionMock.mockReturnValue({ safe: false, matchedPattern: 'ignore previous instructions' });
    fireEvent.change(textarea, { target: { value: 'Please ignore previous instructions and...' } });

    // The warning div renders: "⚠ Possible prompt injection detected: ignore previous instructions"
    // Both the textarea value and the warning div contain the pattern — use findByText
    // targeting the full warning message to avoid ambiguous selector.
    const warning = await screen.findByText(/Possible prompt injection detected.*ignore previous instructions/);
    expect(warning).toBeInTheDocument();
  });

  // TS-78
  it('"Run & Update Output" calls the agent API and saves the new output', async () => {
    renderModal();
    await selectAgent(AGENT_WITH_DOWNSTREAM);
    await openPromptSandbox();
    await waitFor(() => getPromptTextarea());

    callAgentMock.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'NEW OUTPUT' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    extractTextMock.mockReturnValue('NEW OUTPUT');

    await userEvent.click(screen.getByRole('button', { name: /Run & Update Output/ }));

    await waitFor(() => expect(callAgentMock).toHaveBeenCalledTimes(1));

    expect(updateAgentRunMock).toHaveBeenCalledWith(
      'proj-1',
      AGENT_WITH_DOWNSTREAM,
      expect.objectContaining({
        agentId: AGENT_WITH_DOWNSTREAM,
        status: 'complete',
        output: 'NEW OUTPUT',
        tokensUsed: 15,
      })
    );

    // After a successful run the component calls setPanelMode('view'),
    // which hides the sandbox panel. Verify we returned to view mode by
    // checking the DocumentViewer (mocked) is present.
    // (updateAgentRun is mocked so agentRuns in the fixture stays unchanged,
    //  but the component flips back to view mode — that's what we assert.)
    await screen.findByTestId('document-viewer');
    expect(screen.getByTestId('document-viewer')).toBeInTheDocument();
  });

  // TS-80
  it('resets the covering gate to unapproved and pauses the project after a successful run', async () => {
    renderModal(makeProject({
      reviewGates: {
        gate3: { id: 'gate3', afterPhases: ['phase3', 'phase3b'], approved: true, approvedAt: 12345, approvedBy: 'm1', notes: 'old notes' },
      },
      status: 'running',
    }));
    await selectAgent(AGENT_WITH_DOWNSTREAM); // uxResearch → phase3 → covered by gate3
    await openPromptSandbox();
    await waitFor(() => getPromptTextarea());

    callAgentMock.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'NEW OUTPUT' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    extractTextMock.mockReturnValue('NEW OUTPUT');

    await userEvent.click(screen.getByRole('button', { name: /Run & Update Output/ }));

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalled());

    // Apply the updater the component passed to confirm the resulting shape.
    const updater = updateProjectMock.mock.calls[0][1] as (p: Project) => void;
    const draft = structuredClone(currentProject);
    updater(draft);

    expect(draft.reviewGates.gate3?.approved).toBe(false);
    expect(draft.reviewGates.gate3?.approvedAt).toBeUndefined();
    expect(draft.reviewGates.gate3?.approvedBy).toBeUndefined();
    expect(draft.reviewGates.gate3?.notes).toContain('re-approval required');
    expect(draft.status).toBe('paused');
    expect(draft.currentPhase).toBe('phase3');
  });

  // TS-79
  it('confirms before running when an injection warning is present, and aborts if declined', async () => {
    renderModal();
    await selectAgent(AGENT_WITH_DOWNSTREAM);
    await openPromptSandbox();
    const textarea = await waitFor(() => getPromptTextarea());

    checkPromptInjectionMock.mockReturnValue({ safe: false, matchedPattern: 'suspicious pattern' });
    fireEvent.change(textarea, { target: { value: 'Do something suspicious pattern' } });
    await screen.findByText(/Possible prompt injection detected/);

    // Decline the confirm dialog → dry run aborted.
    confirmSpy.mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: /Run & Update Output/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(callAgentMock).not.toHaveBeenCalled();

    // Accept the confirm dialog → dry run proceeds.
    confirmSpy.mockReturnValue(true);
    callAgentMock.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    extractTextMock.mockReturnValue('OK');

    await userEvent.click(screen.getByRole('button', { name: /Run & Update Output/ }));
    await waitFor(() => expect(callAgentMock).toHaveBeenCalledTimes(1));
  });

  // TS-81
  it('shows a "Run failed:" message when the agent API rejects, without saving', async () => {
    renderModal();
    await selectAgent(AGENT_WITH_DOWNSTREAM);
    await openPromptSandbox();
    await waitFor(() => getPromptTextarea());

    callAgentMock.mockRejectedValue(new Error('network down'));

    await userEvent.click(screen.getByRole('button', { name: /Run & Update Output/ }));

    expect(await screen.findByText('Run failed:')).toBeInTheDocument();
    expect(screen.getByText(/Error: Error: network down/)).toBeInTheDocument();
    expect(updateAgentRunMock).not.toHaveBeenCalled();
    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  // TS-82
  it('"Enhance prompt" replaces the textarea content with the enhanced prompt', async () => {
    renderModal();
    await selectAgent(AGENT_WITH_DOWNSTREAM);
    await openPromptSandbox();
    const textarea = await waitFor(() => getPromptTextarea());

    enhancePromptMock.mockResolvedValue('ENHANCED PROMPT');

    await userEvent.click(screen.getByRole('button', { name: /Enhance prompt/ }));

    await waitFor(() => expect(textarea.value).toBe('ENHANCED PROMPT'));
    expect(enhancePromptMock).toHaveBeenCalledWith('DEFAULT SYSTEM PROMPT', AGENT_DEFINITIONS[AGENT_WITH_DOWNSTREAM]?.name);
  });

  // TS-83
  it('disables "Enhance prompt" when the prompt textarea is empty', async () => {
    renderModal();
    await selectAgent(AGENT_WITH_DOWNSTREAM);
    await openPromptSandbox();
    const textarea = await waitFor(() => getPromptTextarea());

    fireEvent.change(textarea, { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: /Enhance prompt/ })).toBeDisabled();
  });

  // TS-84
  it('"Save for this project" persists a PromptOverride and shows confirmation', async () => {
    renderModal();
    await selectAgent(AGENT_WITH_DOWNSTREAM);
    await openPromptSandbox();
    const textarea = await waitFor(() => getPromptTextarea());

    fireEvent.change(textarea, { target: { value: 'MY CUSTOM PROMPT' } });

    await userEvent.click(screen.getByRole('button', { name: /Save for this project/ }));

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalled());
    const updater = updateProjectMock.mock.calls[0][1] as (p: Project) => void;
    const draft = structuredClone(currentProject);
    updater(draft);

    expect(draft.promptOverrides).toContainEqual(
      expect.objectContaining({ agentId: AGENT_WITH_DOWNSTREAM, fullPrompt: 'MY CUSTOM PROMPT', patch: [] })
    );

    expect(await screen.findByText(/Saved as project default/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '✓ Saved' })).toBeDisabled();
  });

  // TS-85
  it('shows a downstream-agents hint for an agent that other agents depend on', async () => {
    renderModal();
    await selectAgent(AGENT_WITH_DOWNSTREAM); // dataModel — architecture depends on it
    await openPromptSandbox();
    await waitFor(() => getPromptTextarea());

    // 'dataModel' has two downstream dependents (Architecture, Security &
    // Compliance) → component renders the plural "depend on this".
    const downstreamName = AGENT_DEFINITIONS.architecture.name; // 'Architecture'
    expect(screen.getByText(new RegExp(downstreamName))).toBeInTheDocument();
    expect(screen.getByText(/depend on this/)).toBeInTheDocument();
  });

  it('shows no downstream-agents hint for an agent nothing else depends on', async () => {
    renderModal(makeProject({
      agentRuns: {
        [AGENT_WITHOUT_DOWNSTREAM]: { agentId: AGENT_WITHOUT_DOWNSTREAM, status: 'complete', output: 'x', completedAt: Date.now() },
      } as Project['agentRuns'],
    }));
    await selectAgent(AGENT_WITHOUT_DOWNSTREAM);
    await openPromptSandbox();
    await waitFor(() => getPromptTextarea());

    expect(screen.queryByText(/depend on this/)).not.toBeInTheDocument();
  });
});
