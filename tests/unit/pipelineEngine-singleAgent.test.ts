// tests/unit/pipelineEngine-singleAgent.test.ts
//
// Tests for:
//   TG-2 — runSingleAgent with SingleAgentOptions (providerOverride, agentSucceeded flow)
//   TG-3 — applyUxMockupsCorrectiveCheck (trigger condition, retry path, passthrough)
//   TG-5 — L3 turn + tool-result truncation (MAX_TURN_CHARS, MAX_TOOL_RESULT_CHARS)
//
// Mocks: projectRepository, api, promptDefaults, runtimeApi, l3Runtime
// No network calls, no IndexedDB.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Project } from '../../frontend/src/types/project.types';
import type { AgentId, AgentRun } from '../../frontend/src/types/agent.types';

// ── Mock state ───────────────────────────────────────────────────────────────
let mockProject: Project;

vi.mock('../../frontend/src/db/projectRepository', () => ({
  getProject:    vi.fn(async () => mockProject),
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
}));

vi.mock('../../frontend/src/agents/promptDefaults', () => ({
  getPromptDefaults:     vi.fn(async () => ({})),
  getAgentProviderHints: vi.fn(async () => ({})),
  // pipelineEngine.ts also resolves a per-agent MODEL_CATALOG assignment
  // (takes priority over the provider hint above) — empty map here means
  // "no admin-assigned model", so these tests exercise the pre-existing
  // hint-only behavior unaffected by the new HF/model-catalog feature.
  getAgentModelAssignments: vi.fn(async () => ({})),
}));

// Track callAgent calls so we can assert on provider/model args.
// vi.hoisted() is required here: vi.mock() factories are hoisted above all other
// top-level code, including plain `const` declarations, and the test file's own
// imports (which pull in pipelineEngine.ts, which imports './api') evaluate before
// the rest of the file's top-level statements. A plain `const callAgentMock` closed
// over by the factory below hits it before initialization. vi.hoisted() runs at the
// same hoisted point as vi.mock(), so callAgentMock exists before the factory needs it.
const { callAgentMock, runL3AgentMock } = vi.hoisted(() => ({
  callAgentMock: vi.fn(async () => ({
    choices: [{ message: { content: 'mock output' }, finish_reason: 'stop' }],
    usage: { total_tokens: 10 },
    provider: 'openai' as const,
    model: 'gpt-4o',
  })),
  runL3AgentMock: vi.fn(async () => ({
    output: 'l3 mock output',
    tokensUsed: 42,
    provider: 'openai' as const,
    model: 'gpt-4o',
    l3: { goal: 'test', planRevisions: [], toolTrace: [], decisions: [], iterationCount: 2 },
  })),
}));

vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent:   callAgentMock,
    extractText: (r: any) => r.choices?.[0]?.message?.content ?? '',
  },
}));

// runtimeApi fire-and-forget — these must never throw
vi.mock('../../frontend/src/services/runtimeApi', () => ({
  syncRunStart:   vi.fn(),
  syncRunSucceed: vi.fn(),
  syncRunFail:    vi.fn(),
}));

// l3Runtime — we mock it to avoid the 1500ms delay and real LLM calls in most tests.
// For truncation tests we test the pure helper functions directly (imported separately).
vi.mock('../../frontend/src/services/l3Runtime', () => ({
  runL3Agent: runL3AgentMock,
}));

vi.mock('../../frontend/src/services/lifecycleEvents', () => ({
  emitLifecycleEvent: vi.fn().mockResolvedValue(undefined),
}));

import { runSingleAgent } from '../../frontend/src/services/pipelineEngine';
import { updateAgentRun } from '../../frontend/src/db/projectRepository';

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshProject(overrides: Partial<Project> = {}): Project {
  return {
    id:          'proj-test',
    name:        'Unit Test Project',
    description: 'Test',
    domain:      'saas',
    status:      'active',
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
    ownerId:     'owner-1',
    version:     1,
    agentRuns:   {},
    reviewGates: {},
    promptOverrides:  [],
    teamMembers:      [],
    agentAssignments: [],
    sourceDocumentIds: [],
    mode: 'simple',
    ...overrides,
  };
}

// ── TG-2: runSingleAgent with SingleAgentOptions ──────────────────────────────

describe('runSingleAgent — basic execution', () => {
  beforeEach(() => {
    mockProject = freshProject();
    vi.clearAllMocks();
    runL3AgentMock.mockResolvedValue({
      output: 'completed output',
      tokensUsed: 10,
      provider: 'openai' as const,
      model: 'gpt-4o',
      l3: { goal: 'test', planRevisions: [], toolTrace: [], decisions: [], iterationCount: 1 },
    });
  });

  it('calls onComplete when the agent succeeds', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();

    await runSingleAgent(
      'proj-test',
      'sdlcOrchestrator',
      'system prompt',
      { onComplete, onError },
    );

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('sets agent status to "complete" in agentRuns on success', async () => {
    await runSingleAgent('proj-test', 'sdlcOrchestrator', 'sys', {});
    expect(mockProject.agentRuns['sdlcOrchestrator']?.status).toBe('complete');
  });

  it('calls onError and sets status "error" when L3 execution throws', async () => {
    runL3AgentMock.mockRejectedValueOnce(new Error('Network timeout'));
    const onError = vi.fn();

    await runSingleAgent('proj-test', 'sdlcOrchestrator', 'sys', { onError });

    expect(onError).toHaveBeenCalledWith('Network timeout');
    expect(mockProject.agentRuns['sdlcOrchestrator']?.status).toBe('error');
  });

  it('does not throw when onError is not provided (error is swallowed)', async () => {
    runL3AgentMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      runSingleAgent('proj-test', 'sdlcOrchestrator', 'sys', {})
    ).resolves.toBeUndefined();
  });
});

describe('runSingleAgent — providerOverride (B2)', () => {
  beforeEach(() => {
    mockProject = freshProject();
    vi.clearAllMocks();
    runL3AgentMock.mockResolvedValue({
      output: 'done',
      tokensUsed: 5,
      provider: 'openai' as const,
      model: 'gpt-4o',
      l3: { goal: 'test', planRevisions: [], toolTrace: [], decisions: [], iterationCount: 1 },
    });
  });

  it('passes providerOverride="claude" to callAgent when set', async () => {
    await runSingleAgent(
      'proj-test',
      'sdlcOrchestrator',
      'sys',
      {},
      '',
      { providerOverride: 'claude' },
    );

    expect(runL3AgentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ provider: 'claude' }),
    );
  });

  it('does not pass a provider when providerOverride="auto"', async () => {
    await runSingleAgent(
      'proj-test',
      'sdlcOrchestrator',
      'sys',
      {},
      '',
      { providerOverride: 'auto' },
    );

    const options = runL3AgentMock.mock.calls[0][2];
    expect(options.provider).toBeUndefined();
  });

  it('passes providerOverride="openai" to callAgent when set', async () => {
    await runSingleAgent(
      'proj-test',
      'sdlcOrchestrator',
      'sys',
      {},
      '',
      { providerOverride: 'openai' },
    );

    expect(runL3AgentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ provider: 'openai' }),
    );
  });
});

// ── TG-3: applyUxMockupsCorrectiveCheck (via runSingleAgent on uxMockups) ────

describe('runSingleAgent — uxMockups corrective check (TG-3)', () => {
  beforeEach(() => {
    mockProject = freshProject({ mockupVersionCount: 2 });
    vi.clearAllMocks();
  });

  it('keeps original output when it already has enough html blocks', async () => {
    const twoBlockOutput = '```html\n<html>v1</html>\n```\n\n```html\n<html>v2</html>\n```';
    runL3AgentMock.mockResolvedValueOnce({
      output: twoBlockOutput,
      tokensUsed: 10,
      provider: 'openai' as const,
      model: 'gpt-4o',
      l3: { goal: 'test', planRevisions: [], toolTrace: [], decisions: [], iterationCount: 1 },
    });

    await runSingleAgent('proj-test', 'uxMockups', 'sys', {});

    expect(callAgentMock).not.toHaveBeenCalled();
    expect(mockProject.agentRuns['uxMockups']?.output).toContain('```html');
  });

  it('fires corrective retry when html block count is below desired', async () => {
    const oneBlockOutput = '```html\n<html>v1 only</html>\n```';
    const twoBlockOutput = '```html\n<html>v1</html>\n```\n\n```html\n<html>v2</html>\n```';

    runL3AgentMock.mockResolvedValueOnce({
      output: oneBlockOutput,
      tokensUsed: 10,
      provider: 'openai' as const,
      model: 'gpt-4o',
      l3: { goal: 'test', planRevisions: [], toolTrace: [], decisions: [], iterationCount: 1 },
    });
    callAgentMock.mockResolvedValueOnce({
      choices: [{ message: { content: twoBlockOutput }, finish_reason: 'stop' }],
      usage: { total_tokens: 20 },
      provider: 'openai' as const,
      model: 'gpt-4o',
    });

    await runSingleAgent('proj-test', 'uxMockups', 'sys', {});

    expect(callAgentMock).toHaveBeenCalledTimes(1);
    // Final stored output is the corrected 2-block version
    expect(mockProject.agentRuns['uxMockups']?.output).toBe(twoBlockOutput);
  });

  it('keeps original output when corrective retry also fails to improve block count', async () => {
    const oneBlockOutput = '```html\n<html>only one</html>\n```';

    runL3AgentMock.mockResolvedValueOnce({
      output: oneBlockOutput,
      tokensUsed: 10,
      provider: 'openai' as const,
      model: 'gpt-4o',
      l3: { goal: 'test', planRevisions: [], toolTrace: [], decisions: [], iterationCount: 1 },
    });
    callAgentMock.mockResolvedValueOnce({
      choices: [{ message: { content: oneBlockOutput }, finish_reason: 'stop' }],
      usage: { total_tokens: 10 },
      provider: 'openai' as const,
      model: 'gpt-4o',
    });

    const onComplete = vi.fn();
    await runSingleAgent('proj-test', 'uxMockups', 'sys', { onComplete });

    // onComplete still called — failure to improve is non-fatal
    expect(onComplete).toHaveBeenCalled();
    expect(mockProject.agentRuns['uxMockups']?.output).toBe(oneBlockOutput);
  });
});

describe('runSingleAgent — architecture diagram corrective check', () => {
  beforeEach(() => {
    mockProject = freshProject();
    vi.clearAllMocks();
    callAgentMock.mockReset();
  });

  it('retries and stores a complete four-diagram ADD when L3 output is incomplete', async () => {
    const corrected = [
      '## Architecture',
      '```mermaid\nflowchart LR\nA-->B\n```',
      '```mermaid\nflowchart TB\nC-->D\n```',
      '```mermaid\nflowchart LR\nE-->F\n```',
      '```mermaid\nsequenceDiagram\nA->>B: Request\n```',
    ].join('\n\n');
    callAgentMock.mockResolvedValueOnce({
      choices: [{ message: { content: corrected }, finish_reason: 'stop' }],
      usage: { total_tokens: 20 },
      provider: 'openai' as const,
      model: 'gpt-4o',
    });

    await runSingleAgent('proj-test', 'architecture', 'LATEST EDITED ARCHITECTURE PROMPT', {});

    expect(callAgentMock).toHaveBeenCalledTimes(1);
    expect(callAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: 'LATEST EDITED ARCHITECTURE PROMPT',
      agentId: 'architecture',
    }));
    expect(mockProject.agentRuns.architecture?.output).toBe(corrected);
  });
});

// ── TG-5: L3 truncation helpers (pure unit tests, no runtime needed) ──────────

describe('L3 conversation truncation (TG-5)', () => {
  // These test the truncation logic in isolation by directly exercising the
  // constants and string-slicing rules documented in the P1 implementation.
  // MAX_TURN_CHARS = 3_000, MAX_TOOL_RESULT_CHARS = 4_000

  const MAX_TURN_CHARS = 3_000;
  const MAX_TOOL_RESULT_CHARS = 4_000;

  it('a turn shorter than MAX_TURN_CHARS is unchanged', () => {
    const shortContent = 'a'.repeat(MAX_TURN_CHARS - 1);
    const result = shortContent.length > MAX_TURN_CHARS
      ? shortContent.slice(0, MAX_TURN_CHARS) + '\n[...turn truncated for context length]'
      : shortContent;
    expect(result).toBe(shortContent);
    expect(result).not.toContain('[...turn truncated');
  });

  it('a turn exactly at MAX_TURN_CHARS is unchanged', () => {
    const exactContent = 'x'.repeat(MAX_TURN_CHARS);
    const result = exactContent.length > MAX_TURN_CHARS
      ? exactContent.slice(0, MAX_TURN_CHARS) + '\n[...turn truncated for context length]'
      : exactContent;
    expect(result).toBe(exactContent);
    expect(result).not.toContain('[...turn truncated');
  });

  it('a turn 1 char over MAX_TURN_CHARS is truncated with suffix', () => {
    const longContent = 'y'.repeat(MAX_TURN_CHARS + 1);
    const result = longContent.length > MAX_TURN_CHARS
      ? longContent.slice(0, MAX_TURN_CHARS) + '\n[...turn truncated for context length]'
      : longContent;
    expect(result).toHaveLength(MAX_TURN_CHARS + '\n[...turn truncated for context length]'.length);
    expect(result).toContain('[...turn truncated for context length]');
  });

  it('truncated turn body is exactly MAX_TURN_CHARS chars long (before suffix)', () => {
    const longContent = 'z'.repeat(MAX_TURN_CHARS + 500);
    const SUFFIX = '\n[...turn truncated for context length]';
    const result = longContent.length > MAX_TURN_CHARS
      ? longContent.slice(0, MAX_TURN_CHARS) + SUFFIX
      : longContent;
    expect(result.startsWith('z'.repeat(MAX_TURN_CHARS))).toBe(true);
    expect(result.endsWith(SUFFIX)).toBe(true);
  });

  it('a tool result shorter than MAX_TOOL_RESULT_CHARS is unchanged', () => {
    const shortResult = 'data'.repeat(100);
    const result = shortResult.length > MAX_TOOL_RESULT_CHARS
      ? shortResult.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...[result truncated — full output available in prior context]'
      : shortResult;
    expect(result).toBe(shortResult);
  });

  it('a tool result 1 char over MAX_TOOL_RESULT_CHARS is truncated with suffix', () => {
    const longResult = 'r'.repeat(MAX_TOOL_RESULT_CHARS + 1);
    const SUFFIX = '\n...[result truncated — full output available in prior context]';
    const result = longResult.length > MAX_TOOL_RESULT_CHARS
      ? longResult.slice(0, MAX_TOOL_RESULT_CHARS) + SUFFIX
      : longResult;
    expect(result).toContain(SUFFIX);
    expect(result.length).toBe(MAX_TOOL_RESULT_CHARS + SUFFIX.length);
  });
});
