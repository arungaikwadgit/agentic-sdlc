/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// 2026-07-19 — buildConversationPrompt was re-embedding every past
// TOOL_RESULT turn at full size (up to MAX_TURN_CHARS) on every subsequent
// iteration, forever, not just the iteration right after it happened. This
// was the dominant driver of the per-iteration token growth reported the
// same day (a PRD run climbed 4,989 -> 6,253 tokens across 5 calls with no
// new information — just the same earlier tool results getting re-sent).
// Fix: once a TOOL_RESULT turn is no longer part of the most recent
// exchange, cap it at MAX_STALE_TURN_CHARS (1,200) instead of MAX_TURN_CHARS
// (3,000). These tests pin that behavior directly by inspecting the actual
// userPrompt sent to the (mocked) LLM on each iteration.
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

// Large enough to exceed MAX_STALE_TURN_CHARS (1,200) but stay under
// MAX_TURN_CHARS (3,000), so we can tell "full" from "stale-capped" apart
// just by whether the marker text and length survive. Each tool uses a
// DIFFERENT filler character ('a' vs 'b') -- using the same filler for both
// (e.g. both 'x'.repeat(2000)) would make a "tool_a's long run didn't
// survive" assertion trivially pass/fail based on tool_b's untouched blob
// instead, since both would contain the same long substring.
const toolA: AgentTool = {
  name: 'get_thing_a',
  description: 'test tool a',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'RESULT_A_MARKER-' + 'a'.repeat(2000),
};
const toolB: AgentTool = {
  name: 'get_thing_b',
  description: 'test tool b',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'RESULT_B_MARKER-' + 'b'.repeat(2000),
};

function response(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { total_tokens: 10 },
    provider: 'openai' as const,
    model: 'gpt-4o',
  };
}

describe('L3 runtime — stale tool-result compaction in buildConversationPrompt', () => {
  beforeEach(() => {
    vi.mocked(api.callAgent).mockReset();
    vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
  });

  it('keeps the most recent tool result full, but caps an older one once a newer exchange exists', async () => {
    const def: AgentDefinition = {
      // Reusing a real AgentId here, same as l3Runtime-intermediateSystemPrompt.test.ts
      // -- AgentDefinition.id is the closed AgentId union, not a free string.
      id: 'architecture',
      name: 'Multi Tool Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Doc',
      systemPrompt: 'System prompt.',
      buildUserPrompt: () => 'Do the work.',
      goal: () => 'Do the work.',
      tools: [toolA, toolB],
      maxIterations: 5,
    };

    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing_a\n{}'))
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing_b\n{}'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nThe complete document.'));

    await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'multiTool' });

    expect(api.callAgent).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(api.callAgent).mock.calls.map((c) => c[0] as { userPrompt: string });

    // Call 2 (index 2): history now has both tool_a's and tool_b's
    // exchanges. tool_b's result is the most recent exchange -> full.
    // tool_a's result is now stale -> capped and marked truncated.
    const finalCallPrompt = calls[2].userPrompt;
    expect(finalCallPrompt).toContain('RESULT_B_MARKER');
    expect(finalCallPrompt).toContain('b'.repeat(1900)); // tool_b's blob survives close to full length (most recent exchange)
    expect(finalCallPrompt).toContain('RESULT_A_MARKER'); // marker text itself is short, survives the cap
    expect(finalCallPrompt).toContain('[...turn truncated for context length]');
    // tool_a's full 2000-char run of a's should NOT survive intact -- only
    // a prefix up to MAX_STALE_TURN_CHARS should be present.
    expect(finalCallPrompt).not.toContain('a'.repeat(1900));
  });

  it('does not truncate anything when history is short enough to fit under the stale cap regardless', async () => {
    const def: AgentDefinition = {
      id: 'architecture',
      name: 'Single Tool Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Doc',
      systemPrompt: 'System prompt.',
      buildUserPrompt: () => 'Do the work.',
      goal: () => 'Do the work.',
      tools: [toolA],
      maxIterations: 3,
    };

    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing_a\n{}'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nThe complete document.'));

    await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'singleTool' });

    const calls = vi.mocked(api.callAgent).mock.calls.map((c) => c[0] as { userPrompt: string });
    // Only one tool result exists, and it's still the most recent exchange
    // on the very next call -> should be untouched (full 2000-char blob).
    expect(calls[1].userPrompt).toContain('a'.repeat(2000));
    expect(calls[1].userPrompt).not.toContain('[...turn truncated for context length]');
  });
});
