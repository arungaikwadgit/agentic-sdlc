// tests/unit/pipelineEngine-orchestration.test.ts
//
// Tests for services/pipelineEngine.ts (PipelineEngine).
//
// NOTE: there is an existing tests/unit/pipelineEngine.test.ts which,
// despite its name, tests services/api.ts (api.callAgent / api.extractText).
// This file is named differently to avoid confusion with that one — it is
// the actual orchestration test for PipelineEngine.
//
// Approach: mock projectRepository (getProject/updateProject/updateAgentRun),
// services/api (callAgent/extractText), and agents/promptDefaults
// (getPromptDefaults) so no IndexedDB or network calls occur. Real
// agents/constants, agents/definitions, agents/domains, and
// data/roleTemplates are used as-is (pure data/functions).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Project } from '../../frontend/src/types/project.types';
import type { AgentId, AgentRun } from '../../frontend/src/types/agent.types';

// ── Mock state ──────────────────────────────────────────────────────────────
let mockProject: Project;

vi.mock('../../frontend/src/db/projectRepository', () => ({
  getProject: vi.fn(async () => mockProject),
  updateProject: vi.fn(async (_id: string, updater: (p: Project) => Project | void) => {
    const result = updater(mockProject);
    mockProject = result ?? mockProject;
    return mockProject;
  }),
  updateAgentRun: vi.fn(async (_projectId: string, agentId: AgentId, run: Partial<AgentRun>) => {
    mockProject.agentRuns[agentId] = {
      ...(mockProject.agentRuns[agentId] ?? { agentId, status: 'idle' }),
      ...run,
    } as AgentRun;
  }),
  getProjectAgentMemoryContext: vi.fn(async () => ({
    summary: '',
    recordIds: [],
    coveredAgentKeys: [],
    estimatedTokens: 0,
    sourceCharacters: 0,
    selectedCharacters: 0,
  })),
  captureProjectAgentMemory: vi.fn(async () => undefined),
}));

vi.mock('../../frontend/src/agents/promptDefaults', () => ({
  getPromptDefaults: vi.fn(async () => ({})),
  getAgentProviderHints: vi.fn(async () => ({})),
  // pipelineEngine.ts also resolves a per-agent MODEL_CATALOG assignment
  // (takes priority over the provider hint above) — empty map here means
  // "no admin-assigned model", so these tests exercise the pre-existing
  // hint-only behavior unaffected by the new HF/model-catalog feature.
  getAgentModelAssignments: vi.fn(async () => ({})),
}));

vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn(async () => ({
      choices: [{ message: { content: 'mock agent output' }, finish_reason: 'stop' }],
      usage: { total_tokens: 5 },
    })),
    extractText: (r: any) => r.choices?.[0]?.message?.content ?? '',
  },
}));

vi.mock('../../frontend/src/services/lifecycleEvents', () => ({
  emitLifecycleEvent: vi.fn().mockResolvedValue(undefined),
}));

import { PipelineEngine, type PipelineCallbacks } from '../../frontend/src/services/pipelineEngine';
import { getProject, updateProject, updateAgentRun } from '../../frontend/src/db/projectRepository';
import { api } from '../../frontend/src/services/api';

function freshProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    domain: 'fintech',
    status: 'draft',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    agentRuns: {},
    reviewGates: {},
    promptOverrides: [],
    mode: 'simple',
    teamMembers: [],
    agentAssignments: [],
    // This suite tests phase/gate sequencing, not the clarifying-questions
    // feature (brd/userStory have AgentDefinition.needsClarifyingQuestions:
    // true as of the BRD/User Stories improvement work). Without pre-seeded
    // answers here, every test that runs the pipeline through phase1b/phase2
    // would halt at PipelineEngine's new pre-generation pause instead of
    // completing those phases — see pipelineEngine.ts's runAgent() and
    // services/clarifyingQuestions.ts.
    clarifyingAnswers: {
      brd: [{ question: 'seed', answer: 'seed' }],
      userStory: [{ question: 'seed', answer: 'seed' }],
    },
    ...overrides,
  };
}

function makeCallbacks(): PipelineCallbacks & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onAgentStart: vi.fn(),
    onAgentComplete: vi.fn(),
    onAgentError: vi.fn(),
    onPhaseComplete: vi.fn(),
    onGateReached: vi.fn(),
    onClarifyingQuestionsNeeded: vi.fn(),
    onPipelineComplete: vi.fn(),
    onPipelineError: vi.fn(),
  };
}

function approveAllGates(project: Project): Project {
  const now = Date.now();
  return {
    ...project,
    reviewGates: {
      // gate0 covers the orchestrator plan only; preflight starts after approval.
      gate0: { id: 'gate0', afterPhases: ['phase0'], approved: true, approvedAt: now },
      gate1: { id: 'gate1', afterPhases: ['phase1', 'phase1b'], approved: true, approvedAt: now },
      gate2: { id: 'gate2', afterPhases: ['phase2'], approved: true, approvedAt: now },
      // gate3 covers all design tiers through phase3c
      gate3: { id: 'gate3', afterPhases: ['phase3', 'phase3a', 'phase3b', 'phase3c'], approved: true, approvedAt: now },
      gate5: { id: 'gate5', afterPhases: ['phase5'], approved: true, approvedAt: now },
      // gate6 intentionally omitted: the Working Prototype phase has no separate gate6
    },
  };
}

describe('PipelineEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProject = freshProject();
    // sdlcOrchestrator now has requiredTools set (see l3Runtime.ts's
    // requiredTools enforcement) — the generic unmarked "mock agent output"
    // response below is treated as a premature passthrough and corrected
    // (see l3Runtime-requiredTools.test.ts), pushing it past 1 iteration
    // for the first time in this suite. Without this, that would incur
    // runL3Agent's real 1500ms inter-iteration delay per correction.
    vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns early with onPipelineError when the project does not exist (TS-30)', async () => {
    mockProject = undefined as unknown as Project; // simulate "not found"
    vi.mocked(getProject).mockResolvedValueOnce(undefined as unknown as Project);

    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('missing-project', callbacks);
    await engine.run();

    expect(callbacks.onPipelineError).toHaveBeenCalledWith('Project not found');
    expect(callbacks.onAgentStart).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
  });

  it('stops at gate0 immediately after the orchestrator when no gates are approved (TS-22)', async () => {
    mockProject = freshProject(); // status: draft, no gates approved
    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    await engine.run();

    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('sdlcOrchestrator', expect.any(String));
    expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('phase0');
    expect(callbacks.onAgentStart).not.toHaveBeenCalledWith('tokenOptimizer');
    expect(callbacks.onAgentStart).not.toHaveBeenCalledWith('aiGovernance');

    // Gate 0 blocks the first background preflight phase until owner/admin approval.
    expect(callbacks.onGateReached).toHaveBeenCalledWith('gate0');
    expect(callbacks.onPipelineComplete).not.toHaveBeenCalled();
    expect(mockProject.status).toBe('paused');
    expect(mockProject.currentPhase).toBe('phase0a');
    expect(callbacks.onAgentStart).not.toHaveBeenCalledWith('manager');
  });

  it('stops at gate1 (after phase1b) when gate0 is approved but no other gates are (TS-23)', async () => {
    mockProject = freshProject({
      reviewGates: {
        gate0: { id: 'gate0', afterPhases: ['phase0'], approved: true, approvedAt: Date.now() },
      },
    });
    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    await engine.run();

    // phase1 (manager) and phase1b (projectCharter, brd) should have run
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('tokenOptimizer', expect.any(String));
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('aiGovernance', expect.any(String));
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('manager', expect.any(String));
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('projectCharter', expect.any(String));
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('brd', expect.any(String));
    expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('phase1');
    expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('phase1b');

    // gate1 fires after phase1b, blocking phase2
    expect(callbacks.onGateReached).toHaveBeenCalledWith('gate1');
    expect(callbacks.onPipelineComplete).not.toHaveBeenCalled();

    // pipeline paused, ready to resume at phase2
    expect(mockProject.status).toBe('paused');
    expect(mockProject.currentPhase).toBe('phase2');

    // phase2 agents should NOT have started
    expect(callbacks.onAgentStart).not.toHaveBeenCalledWith('stakeholder');
  });

  it('runs through to completion when all gates are pre-approved (TS-24)', async () => {
    mockProject = approveAllGates(freshProject());
    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    await engine.run();

    expect(callbacks.onPipelineComplete).toHaveBeenCalledOnce();
    expect(callbacks.onPipelineError).not.toHaveBeenCalled();
    expect(callbacks.onGateReached).not.toHaveBeenCalled();
    expect(mockProject.status).toBe('complete');

    // Spot-check a few agents from different phases all completed
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('manager', expect.any(String));
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('architecture', expect.any(String));
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('onCallEngineer', expect.any(String));

    // New agents (phase3b and phase4 additions) also completed
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('securityCompliance', expect.any(String));
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('codeReviewStandards', expect.any(String));
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('roadmapPlanner', expect.any(String));
    expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('phase3b');
  });

  it('skips agents whose run is already marked complete (TS-25)', async () => {
    mockProject = approveAllGates(
      freshProject({
        agentRuns: {
          manager: { agentId: 'manager', status: 'complete', output: 'already done' },
        },
      })
    );
    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    await engine.run();

    // 'manager' should never be (re-)started or completed by the engine
    expect(callbacks.onAgentStart).not.toHaveBeenCalledWith('manager');
    expect(callbacks.onAgentComplete).not.toHaveBeenCalledWith('manager', expect.any(String));

    // but other agents still ran
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('projectCharter', expect.any(String));
    expect(callbacks.onPipelineComplete).toHaveBeenCalledOnce();
  });

  it('starts at the given phase when run(startFromPhase) is called (TS-26)', async () => {
    mockProject = approveAllGates(freshProject({ status: 'paused', currentPhase: 'phase5' }));
    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    await engine.run('phase5');

    // Earlier-phase agents should not have been touched
    expect(callbacks.onAgentStart).not.toHaveBeenCalledWith('manager');
    expect(callbacks.onAgentStart).not.toHaveBeenCalledWith('architecture');

    // phase5+ agents should have run
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('testPlan', expect.any(String));
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('testCases', expect.any(String));
    expect(callbacks.onPipelineComplete).toHaveBeenCalledOnce();
  });

  it('does not block phase entry when the required gate is approved (TS-27)', async () => {
    // Approve gate0, gate1 and gate2 only; gate3 left unapproved so we can observe
    // the pipeline proceeding past phase2/phase3 before stopping at gate3.
    mockProject = freshProject({
      reviewGates: {
        gate0: { id: 'gate0', afterPhases: ['phase0'], approved: true, approvedAt: Date.now() },
        gate1: { id: 'gate1', afterPhases: ['phase1', 'phase1b'], approved: true, approvedAt: Date.now() },
        gate2: { id: 'gate2', afterPhases: ['phase2'], approved: true, approvedAt: Date.now() },
      },
    });
    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    await engine.run();

    // phase2 should have started (gate1 approved did not block it)
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('stakeholder', expect.any(String));
    expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('phase2');
    expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('phase3');

    // phase3b (securityCompliance) now runs before gate3 fires
    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('securityCompliance', expect.any(String));
    expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('phase3b');

    expect(callbacks.onAgentComplete).toHaveBeenCalledWith('uxMockups', expect.any(String));
    expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('phase3c');

    // gate3 fires after phase3c and is unapproved -> pipeline pauses
    expect(callbacks.onGateReached).toHaveBeenCalledWith('gate3');
    expect(mockProject.status).toBe('paused');
    expect(mockProject.currentPhase).toBe('phase4');
  });

  it('records agent error, calls onAgentError and onPipelineError, and sets status to error (TS-28)', async () => {
    mockProject = freshProject();
    // mockRejectedValueOnce fails the FIRST api.callAgent invocation. phase0
    // (sdlcOrchestrator) now runs before phase1 (manager), so the first agent
    // to be called — and therefore the one that errors — is sdlcOrchestrator.
    vi.mocked(api.callAgent).mockRejectedValueOnce(new Error('rate limited'));

    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    await engine.run();

    expect(callbacks.onAgentError).toHaveBeenCalledWith('sdlcOrchestrator', 'rate limited');
    expect(callbacks.onPipelineError).toHaveBeenCalledWith('rate limited');
    expect(mockProject.status).toBe('error');
    expect(mockProject.agentRuns.sdlcOrchestrator?.status).toBe('error');
    expect(mockProject.agentRuns.sdlcOrchestrator?.error).toBe('rate limited');

    // pipeline should not have proceeded to mark anything complete
    expect(callbacks.onPipelineComplete).not.toHaveBeenCalled();
  });

  it('abort() prevents further agents from starting in a sequential phase (TS-29)', async () => {
    mockProject = freshProject();
    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    // Abort before running — phase1 (manager) is sequential with a single agent.
    engine.abort();
    await engine.run();

    expect(callbacks.onAgentStart).not.toHaveBeenCalled();
    expect(callbacks.onAgentComplete).not.toHaveBeenCalled();
    // Loop exits without marking complete or error (aborted, not erred)
    expect(callbacks.onPipelineComplete).not.toHaveBeenCalled();
    expect(callbacks.onPipelineError).not.toHaveBeenCalled();
  });

  it('run(startFromPhase) pauses immediately if the resumed phase requires an unapproved gate (TS-27b)', async () => {
    // gate3 is required *before* phase4 (GATE_AFTER_PHASE_INDEX.gate3 = idx(phase4)).
    // Resuming directly at phase4 with gate3 unapproved should hit the
    // "required gate before phase" branch (getGateRequiredBefore), which is
    // otherwise unreachable during normal sequential execution.
    mockProject = freshProject({ status: 'paused', currentPhase: 'phase4', reviewGates: {} });
    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    await engine.run('phase4');

    expect(callbacks.onGateReached).toHaveBeenCalledWith('gate3');
    expect(callbacks.onAgentStart).not.toHaveBeenCalled();
    expect(mockProject.status).toBe('paused');
    expect(mockProject.currentPhase).toBe('phase4');
    expect(callbacks.onPipelineComplete).not.toHaveBeenCalled();
  });

  it('runs all agents in a parallel phase (phase2) via the shared queue (TS-31)', async () => {
    mockProject = approveAllGates(freshProject({ status: 'paused', currentPhase: 'phase2' }));
    const callbacks = makeCallbacks();
    const engine = new PipelineEngine('proj-1', callbacks);

    await engine.run('phase2');

    const phase2Agents: AgentId[] = ['stakeholder', 'userStory', 'businessRules', 'feasibility', 'dataModel'];
    for (const agentId of phase2Agents) {
      expect(callbacks.onAgentComplete).toHaveBeenCalledWith(agentId, expect.any(String));
    }
    expect(callbacks.onPhaseComplete).toHaveBeenCalledWith('phase2');
  });
});
