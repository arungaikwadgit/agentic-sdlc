/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// Real enforcement of the output side of token usage (2026-07-17): every
// call used to hardcode max_tokens: 8192 on the backend regardless of
// whether the response was expected to be a full document or a two-line
// TOOL_CALL/PLAN_REVISION marker. l3Runtime now caps intermediate
// iterations and leaves the last-chance ("nearLimit") iteration and the
// forced-finalization call at the full default. See services/api.ts
// (AgentRequest.maxTokens) and backend/src/proxy.js (clampMaxTokens).
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

const noopTool: AgentTool = {
  name: 'get_thing',
  description: 'test tool',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => ({ ok: true }),
};

function response(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { total_tokens: 10 },
    provider: 'openai' as const,
    model: 'gpt-4o',
  };
}

describe('L3 runtime — per-iteration maxTokens enforcement', () => {
  beforeEach(() => {
    vi.mocked(api.callAgent).mockReset();
    vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
  });

  it('caps intermediate (non-last, non-forced) iterations to 2048 and leaves the last iteration uncapped', async () => {
    const def: AgentDefinition = {
      id: 'architecture',
      name: 'Architecture Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Architecture',
      systemPrompt: 'Do work.',
      buildUserPrompt: () => 'Do the work.',
      goal: () => 'Do the work.',
      tools: [noopTool],
      maxIterations: 3,
    };

    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}'))
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nThe complete document.'));

    await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });

    expect(api.callAgent).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(api.callAgent).mock.calls.map((c) => c[0] as { maxTokens?: number });
    // iteration 0 and 1 (0-indexed) are not the last iteration of maxIterations=3 -> capped
    expect(calls[0].maxTokens).toBe(2048);
    expect(calls[1].maxTokens).toBe(2048);
    // iteration 2 is the last iteration (nearLimit) -> uncapped (undefined -> backend default 8192)
    expect(calls[2].maxTokens).toBeUndefined();
  });

  it('does not cap the forced-finalization call when maxIterations is exhausted without FINAL_OUTPUT', async () => {
    const def: AgentDefinition = {
      id: 'architecture',
      name: 'Architecture Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Architecture',
      systemPrompt: 'Do work.',
      buildUserPrompt: () => 'Do the work.',
      goal: () => 'Do the work.',
      tools: [noopTool],
      maxIterations: 2,
    };

    // Every regular iteration keeps calling the tool, never finalizing —
    // forces the loop to exhaust maxIterations and make the forced call.
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}'))
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nForced document.'));

    const result = await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });

    expect(api.callAgent).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(api.callAgent).mock.calls.map((c) => c[0] as { maxTokens?: number });
    // iteration 0 (maxIterations=2, so iteration 0 is NOT the last -> capped),
    // iteration 1 IS the last regular iteration -> uncapped,
    // the 3rd call is the forced-finalization call -> also uncapped.
    expect(calls[0].maxTokens).toBe(2048);
    expect(calls[1].maxTokens).toBeUndefined();
    expect(calls[2].maxTokens).toBeUndefined();
    expect(result.output).toContain('Forced document.');
  });

  it('a single-iteration agent (maxIterations=1) is never capped', async () => {
    const def: AgentDefinition = {
      id: 'architecture',
      name: 'Architecture Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Architecture',
      systemPrompt: 'Do work.',
      buildUserPrompt: () => 'Do the work.',
      goal: () => 'Do the work.',
      tools: [],
      maxIterations: 1,
    };
    vi.mocked(api.callAgent).mockResolvedValueOnce(response('FINAL_OUTPUT:\nQuick document.'));

    await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });

    const calls = vi.mocked(api.callAgent).mock.calls.map((c) => c[0] as { maxTokens?: number });
    expect(calls[0].maxTokens).toBeUndefined();
  });
});
