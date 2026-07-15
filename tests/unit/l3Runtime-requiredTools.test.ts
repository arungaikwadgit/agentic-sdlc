// tests/unit/l3Runtime-requiredTools.test.ts
//
// Targeted tests for AgentDefinition.requiredTools enforcement in runL3Agent
// (frontend/src/services/l3Runtime.ts). Covers the bug found via a real
// sdlcOrchestrator run that finished at "3i" — the pre-existing parser
// fallback silently accepted ANY unparseable/marker-less response as the
// final output, even mid-way through a mandatory multi-tool-call sequence.
// These tests verify the fix: premature finalization gets pushed back with
// a bounded number of corrective nudges, and a run that still can't get
// there (or that exhausts maxIterations entirely) flags the gap on
// L3RuntimeMeta.incompleteRequiredTools instead of silently masking it.
//
// Mocks: services/api only. runL3Agent itself is exercised for real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn(),
    extractText: (resp: { choices: Array<{ message: { content: string } }> }) =>
      resp.choices?.[0]?.message?.content ?? '',
  },
}));

import { api } from '../../frontend/src/services/api';
import { runL3Agent } from '../../frontend/src/services/l3Runtime';
import type { AgentDefinition, AgentPromptContext, AgentTool } from '../../frontend/src/types/agent.types';

function mockResponse(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    provider: 'openai' as const,
    model: 'gpt-4o',
  };
}

const BASE_CTX: AgentPromptContext = {
  projectName: 'DriveWithMe',
  projectDescription: 'A logistics coordination platform',
  domain: 'logistics',
  domainContext: 'Logistics domain context',
  priorOutputs: {},
  teamRoster: [],
};

function makeTool(name: string): AgentTool {
  return {
    name,
    description: `Test tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn(async () => ({ ok: true, tool: name })),
  };
}

function makeDef(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'sdlcOrchestrator',
    name: 'Test Orchestrator',
    phase: 'phase0',
    description: 'test',
    outputLabel: 'Test Output',
    systemPrompt: 'You are a test agent.',
    buildUserPrompt: () => 'Do the test task.',
    goal: () => 'Test goal.',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(api.callAgent).mockReset();
  vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runL3Agent — requiredTools enforcement', () => {
  it('finishes normally with no gap flag when no requiredTools are configured (backward compat)', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(mockResponse('FINAL_OUTPUT:\nSimple doc'));

    const def = makeDef({ tools: [makeTool('toolA')] }); // no requiredTools set
    const result = await runL3Agent(def, BASE_CTX, { systemPrompt: 's', userPrompt: 'u', agentId: 'sdlcOrchestrator' });

    expect(result.output).toBe('Simple doc');
    expect(result.l3.incompleteRequiredTools).toBeUndefined();
    expect(result.l3.iterationCount).toBe(1);
    expect(result.l3.decisions.some((d) => d.type === 'retry')).toBe(false);
  });

  it('finishes normally with no gap flag when all requiredTools were actually called', async () => {
    const toolA = makeTool('toolA');
    const toolB = makeTool('toolB');
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(mockResponse('TOOL_CALL: toolA\n{}'))
      .mockResolvedValueOnce(mockResponse('TOOL_CALL: toolB\n{}'))
      .mockResolvedValueOnce(mockResponse('FINAL_OUTPUT:\nComplete doc'));

    const def = makeDef({ tools: [toolA, toolB], requiredTools: ['toolA', 'toolB'], maxIterations: 5 });
    const result = await runL3Agent(def, BASE_CTX, { systemPrompt: 's', userPrompt: 'u', agentId: 'sdlcOrchestrator' });

    expect(result.output).toBe('Complete doc');
    expect(result.l3.incompleteRequiredTools).toBeUndefined();
    expect(result.l3.toolTrace.map((t) => t.tool)).toEqual(['toolA', 'toolB']);
    expect(result.l3.iterationCount).toBe(3);
  });

  it('pushes a corrective nudge when the model tries to finish before calling required tools, then accepts once it complies', async () => {
    const toolA = makeTool('toolA');
    const toolB = makeTool('toolB');
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(mockResponse('FINAL_OUTPUT:\nPremature doc')) // tries to finish immediately
      .mockResolvedValueOnce(mockResponse('TOOL_CALL: toolA\n{}'))
      .mockResolvedValueOnce(mockResponse('TOOL_CALL: toolB\n{}'))
      .mockResolvedValueOnce(mockResponse('FINAL_OUTPUT:\nComplete doc'));

    const def = makeDef({ tools: [toolA, toolB], requiredTools: ['toolA', 'toolB'], maxIterations: 5 });
    const result = await runL3Agent(def, BASE_CTX, { systemPrompt: 's', userPrompt: 'u', agentId: 'sdlcOrchestrator' });

    expect(result.output).toBe('Complete doc');
    expect(result.l3.incompleteRequiredTools).toBeUndefined();
    expect(result.l3.decisions.filter((d) => d.type === 'retry')).toHaveLength(1);
    expect(result.l3.decisions[0].rationale).toContain('toolA');
    expect(result.l3.decisions[0].rationale).toContain('toolB');
    // 4 LLM calls happened: premature attempt, toolA, toolB, real final output
    expect(api.callAgent).toHaveBeenCalledTimes(4);
  });

  it('flags incompleteRequiredTools after exhausting the correction budget against a persistently non-compliant model', async () => {
    const toolA = makeTool('toolA');
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(mockResponse('FINAL_OUTPUT:\nDraft1'))
      .mockResolvedValueOnce(mockResponse('FINAL_OUTPUT:\nDraft2'))
      .mockResolvedValueOnce(mockResponse('FINAL_OUTPUT:\nDraft3'));

    const def = makeDef({ tools: [toolA], requiredTools: ['toolA'], maxIterations: 5 });
    const result = await runL3Agent(def, BASE_CTX, { systemPrompt: 's', userPrompt: 'u', agentId: 'sdlcOrchestrator' });

    // Accepted on the 3rd attempt (2 corrections exhausted) rather than looping forever
    expect(result.output).toBe('Draft3');
    expect(result.l3.incompleteRequiredTools).toEqual(['toolA']);
    expect(result.l3.decisions.filter((d) => d.type === 'retry')).toHaveLength(2);
    const finalDecision = result.l3.decisions[result.l3.decisions.length - 1];
    expect(finalDecision.type).toBe('output_accepted');
    expect(finalDecision.rationale).toContain('toolA');
    expect(finalDecision.confidence).toBeLessThan(0.9); // lower confidence than a clean finish
  });

  it('accepts immediately without a correction attempt when no iterations remain, but still flags the gap', async () => {
    const toolA = makeTool('toolA');
    // maxIterations: 1 -- the very first response IS the last allowed iteration,
    // so there's no room to push back even though toolA was never called.
    vi.mocked(api.callAgent).mockResolvedValueOnce(mockResponse('FINAL_OUTPUT:\nOnly shot'));

    const def = makeDef({ tools: [toolA], requiredTools: ['toolA'], maxIterations: 1 });
    const result = await runL3Agent(def, BASE_CTX, { systemPrompt: 's', userPrompt: 'u', agentId: 'sdlcOrchestrator' });

    expect(result.output).toBe('Only shot');
    expect(result.l3.incompleteRequiredTools).toEqual(['toolA']);
    expect(result.l3.decisions.some((d) => d.type === 'retry')).toBe(false);
    expect(api.callAgent).toHaveBeenCalledTimes(1);
  });

  it('flags incompleteRequiredTools via the forced-finalization path when maxIterations is exhausted without ever emitting FINAL_OUTPUT', async () => {
    const toolA = makeTool('toolA');
    const toolB = makeTool('toolB');
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(mockResponse('TOOL_CALL: toolA\n{}'))
      .mockResolvedValueOnce(mockResponse('TOOL_CALL: toolA\n{}')) // never calls toolB, never finalizes
      .mockResolvedValueOnce(mockResponse('Forced doc with no markers')); // the forced tool-free call

    const def = makeDef({ tools: [toolA, toolB], requiredTools: ['toolB'], maxIterations: 2 });
    const result = await runL3Agent(def, BASE_CTX, { systemPrompt: 's', userPrompt: 'u', agentId: 'sdlcOrchestrator' });

    expect(result.output).toBe('Forced doc with no markers');
    expect(result.l3.incompleteRequiredTools).toEqual(['toolB']);
    expect(api.callAgent).toHaveBeenCalledTimes(3);
  });
});
