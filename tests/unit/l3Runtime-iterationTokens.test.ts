/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// Per-call token instrumentation (2026-07-17) — added so "where did this
// run's tokens go" can be answered from real per-call data (surfaced in
// AgentThinkingPanel's Token Usage breakdown) instead of estimated from the
// aggregate total alone.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn(),
    extractText: (resp: { choices: Array<{ message: { content: string } }> }) => resp.choices[0].message.content,
  },
}));

import { api } from '../../frontend/src/services/api';
import { runL3Agent } from '../../frontend/src/services/l3Runtime';
import type { AgentDefinition, AgentPromptContext, AgentTool } from '../../frontend/src/types/agent.types';

const ctx: AgentPromptContext = {
  projectName: 'Test Project',
  projectDescription: 'A project',
  domain: 'technology',
  domainContext: '',
  priorOutputs: {},
  teamRoster: [],
};

const getThingTool: AgentTool = {
  name: 'get_thing',
  description: 'test tool',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => ({ ok: true }),
};

function response(content: string, tokens: number) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { total_tokens: tokens },
    provider: 'openai' as const,
    model: 'gpt-4o',
  };
}

describe('L3 runtime — iterationTokens instrumentation', () => {
  beforeEach(() => {
    vi.mocked(api.callAgent).mockReset();
    vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
  });

  it('records one entry per call, summing to the total, tagged with the correct prompt variant', async () => {
    const def: AgentDefinition = {
      id: 'sdlcOrchestrator',
      name: 'SDLC Orchestrator',
      phase: 'phase0',
      description: 'test',
      outputLabel: 'SDLC Orchestration Plan',
      systemPrompt: 'Full prompt.',
      intermediateSystemPrompt: 'Short prompt.',
      buildUserPrompt: () => 'Plan it.',
      goal: () => 'Plan it.',
      tools: [getThingTool],
      requiredTools: ['get_thing'],
      maxIterations: 4,
    };

    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}', 500))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nThe plan.', 700));

    const result = await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'sdlcOrchestrator' });

    expect(result.l3.iterationTokens).toHaveLength(2);
    expect(result.l3.iterationTokens[0]).toMatchObject({ iteration: 1, tokens: 500, promptVariant: 'intermediate' });
    expect(result.l3.iterationTokens[1]).toMatchObject({ iteration: 2, tokens: 700, promptVariant: 'full' });

    const summed = result.l3.iterationTokens.reduce((sum, e) => sum + e.tokens, 0);
    expect(summed).toBe(result.tokensUsed);
    expect(result.tokensUsed).toBe(1200);
  });

  it('tags the forced-finalization call with iteration -1 and promptVariant "forced-final"', async () => {
    const def: AgentDefinition = {
      id: 'architecture',
      name: 'Architecture Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Architecture',
      systemPrompt: 'Full prompt.',
      buildUserPrompt: () => 'Do it.',
      goal: () => 'Do it.',
      tools: [getThingTool],
      maxIterations: 1,
    };

    // Iteration 0 keeps calling a tool instead of finalizing, forcing the
    // tool-free forced-finalization call afterward.
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}', 300))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nForced document.', 900));

    const result = await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });

    expect(result.l3.iterationTokens).toHaveLength(2);
    expect(result.l3.iterationTokens[1]).toMatchObject({ iteration: -1, tokens: 900, promptVariant: 'forced-final' });
    expect(result.tokensUsed).toBe(1200);
  });
});
