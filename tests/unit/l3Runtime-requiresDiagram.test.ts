/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// Diagram enforcement (2026-07-17, see AgentDefinition.requiresDiagram and
// agents/diagramUtils.ts). Mirrors the existing output-governance soft-warn
// pattern: bounded corrective retry, then accept-and-flag rather than
// discard/block the agent's real output.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn(),
    extractText: (resp: { choices: Array<{ message: { content: string } }> }) => resp.choices[0].message.content,
  },
}));

import { api } from '../../frontend/src/services/api';
import { runL3Agent } from '../../frontend/src/services/l3Runtime';
import type { AgentDefinition, AgentPromptContext } from '../../frontend/src/types/agent.types';

const ctx: AgentPromptContext = {
  projectName: 'Diagram Project',
  projectDescription: 'Test diagram enforcement',
  domain: 'technology',
  domainContext: '',
  priorOutputs: {},
  teamRoster: [],
};

function baseDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'architecture',
    name: 'Architecture Agent',
    phase: 'phase3',
    description: 'test',
    outputLabel: 'Architecture',
    systemPrompt: 'Design the system.',
    buildUserPrompt: () => 'Design the system.',
    goal: () => 'Design the system.',
    tools: [],
    maxIterations: 3,
    requiresDiagram: true,
    ...overrides,
  };
}

function response(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { total_tokens: 10 },
    provider: 'openai' as const,
    model: 'gpt-4o',
  };
}

describe('L3 requiresDiagram enforcement', () => {
  beforeEach(() => {
    vi.mocked(api.callAgent).mockReset();
    vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
  });

  it('accepts immediately when the output already contains a diagram — no retry, no flag', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(
      response('FINAL_OUTPUT:\n# Architecture\n\n```mermaid\nflowchart TD\nA-->B\n```\n')
    );

    const result = await runL3Agent(baseDef(), ctx, { systemPrompt: 'Design.', userPrompt: 'u', agentId: 'architecture' });

    expect(api.callAgent).toHaveBeenCalledTimes(1);
    expect(result.l3.missingDiagram).toBeUndefined();
    expect(result.output).toContain('```mermaid');
  });

  it('retries once when the diagram is missing, and clears the flag once the retry adds one', async () => {
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\n# Architecture\n\nNo diagram here.'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\n# Architecture\n\n```mermaid\nflowchart TD\nA-->B\n```\n'));

    const result = await runL3Agent(baseDef(), ctx, { systemPrompt: 'Design.', userPrompt: 'u', agentId: 'architecture' });

    expect(api.callAgent).toHaveBeenCalledTimes(2);
    expect(result.l3.missingDiagram).toBeUndefined();
    expect(result.output).toContain('```mermaid');
    // The correction turn should have been recorded as a retry decision.
    expect(result.l3.decisions.some((d) => d.type === 'retry' && d.rationale.includes('diagram'))).toBe(true);
  });

  it('keeps the real output and flags missingDiagram=true when still missing after the retry budget is exhausted', async () => {
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\n# Architecture\n\nStill no diagram.'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\n# Architecture\n\nStill no diagram after retry.'));

    const result = await runL3Agent(baseDef({ maxIterations: 3 }), ctx, {
      systemPrompt: 'Design.',
      userPrompt: 'u',
      agentId: 'architecture',
    });

    expect(result.l3.missingDiagram).toBe(true);
    expect(result.output).toContain('Still no diagram after retry.');
    expect(result.output).not.toContain('blocked');
  });

  it('does not check or flag agents that do not require a diagram', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(response('FINAL_OUTPUT:\nJust prose, no diagram.'));

    const def = baseDef({ requiresDiagram: false });
    const result = await runL3Agent(def, ctx, { systemPrompt: 'Design.', userPrompt: 'u', agentId: 'architecture' });

    expect(api.callAgent).toHaveBeenCalledTimes(1);
    expect(result.l3.missingDiagram).toBeUndefined();
  });

  it('flags missingDiagram on the forced-finalization path too, when iterations are exhausted', async () => {
    const def = baseDef({ maxIterations: 1, tools: [], requiredTools: [] });
    // maxIterations=1: iteration 0 IS nearLimit, so the loop's single
    // regular iteration already asks for FINAL_OUTPUT — return a tool call
    // instead so it never finalizes there, forcing the tool-free forced
    // finalization call afterward.
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nForced document, still no diagram.'));

    const result = await runL3Agent(def, ctx, { systemPrompt: 'Design.', userPrompt: 'u', agentId: 'architecture' });

    expect(result.l3.missingDiagram).toBe(true);
    expect(result.output).toContain('Forced document, still no diagram.');
  });
});
