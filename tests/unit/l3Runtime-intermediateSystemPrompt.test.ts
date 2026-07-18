/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// Real, measured token reduction for sdlcOrchestrator (2026-07-17): its full
// systemPrompt (BASE_SYSTEM + a ~5,000-char, 9-section output-format spec)
// was being resent unchanged on every one of its up-to-10 L3 iterations —
// most of which are pure tool-selection turns that can't legitimately
// produce FINAL_OUTPUT yet, since requiredTools enforcement blocks it. See
// AgentDefinition.intermediateSystemPrompt.
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

const FULL_MARKER = 'FULL_PROMPT_MARKER_XYZ';
const INTERMEDIATE_MARKER = 'INTERMEDIATE_PROMPT_MARKER_ABC';

const getThingTool: AgentTool = {
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

describe('L3 runtime — intermediateSystemPrompt condensation', () => {
  beforeEach(() => {
    vi.mocked(api.callAgent).mockReset();
    vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
  });

  it('uses the condensed prompt while required tools are outstanding, and the full prompt once they are all called', async () => {
    const def: AgentDefinition = {
      id: 'architecture',
      name: 'Architecture Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Architecture',
      systemPrompt: `Full system prompt. ${FULL_MARKER}`,
      intermediateSystemPrompt: `Intermediate system prompt. ${INTERMEDIATE_MARKER}`,
      buildUserPrompt: () => 'Do the work.',
      goal: () => 'Do the work.',
      tools: [getThingTool],
      requiredTools: ['get_thing'],
      maxIterations: 4,
    };

    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nThe complete document.'));

    await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });

    expect(api.callAgent).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(api.callAgent).mock.calls.map((c) => c[0] as { systemPrompt: string });

    // Iteration 0: get_thing hasn't been called yet -> still gathering -> condensed prompt.
    expect(calls[0].systemPrompt).toContain(INTERMEDIATE_MARKER);
    expect(calls[0].systemPrompt).not.toContain(FULL_MARKER);

    // Iteration 1: get_thing was called on iteration 0 -> no longer gathering -> full prompt.
    expect(calls[1].systemPrompt).toContain(FULL_MARKER);
    expect(calls[1].systemPrompt).not.toContain(INTERMEDIATE_MARKER);
  });

  it('always uses the full prompt on the last-chance (nearLimit) iteration, even if required tools are still outstanding', async () => {
    const def: AgentDefinition = {
      id: 'architecture',
      name: 'Architecture Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Architecture',
      systemPrompt: `Full system prompt. ${FULL_MARKER}`,
      intermediateSystemPrompt: `Intermediate system prompt. ${INTERMEDIATE_MARKER}`,
      buildUserPrompt: () => 'Do the work.',
      goal: () => 'Do the work.',
      tools: [getThingTool],
      requiredTools: ['get_thing'],
      maxIterations: 1, // iteration 0 is immediately nearLimit
    };

    vi.mocked(api.callAgent).mockResolvedValueOnce(response('FINAL_OUTPUT:\nRushed document.'));

    await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });

    const calls = vi.mocked(api.callAgent).mock.calls.map((c) => c[0] as { systemPrompt: string });
    expect(calls[0].systemPrompt).toContain(FULL_MARKER);
    expect(calls[0].systemPrompt).not.toContain(INTERMEDIATE_MARKER);
  });

  it('always uses the full prompt when the agent has no intermediateSystemPrompt (every agent except sdlcOrchestrator today)', async () => {
    const def: AgentDefinition = {
      id: 'architecture',
      name: 'Architecture Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Architecture',
      systemPrompt: `Full system prompt. ${FULL_MARKER}`,
      // no intermediateSystemPrompt
      buildUserPrompt: () => 'Do the work.',
      goal: () => 'Do the work.',
      tools: [getThingTool],
      requiredTools: ['get_thing'],
      maxIterations: 4,
    };

    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nThe complete document.'));

    await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });

    const calls = vi.mocked(api.callAgent).mock.calls.map((c) => c[0] as { systemPrompt: string });
    expect(calls[0].systemPrompt).toContain(FULL_MARKER);
    expect(calls[1].systemPrompt).toContain(FULL_MARKER);
  });

  it('always uses the full prompt when the agent has no requiredTools at all', async () => {
    const def: AgentDefinition = {
      id: 'architecture',
      name: 'Architecture Agent',
      phase: 'phase3',
      description: 'test',
      outputLabel: 'Architecture',
      systemPrompt: `Full system prompt. ${FULL_MARKER}`,
      intermediateSystemPrompt: `Intermediate system prompt. ${INTERMEDIATE_MARKER}`,
      buildUserPrompt: () => 'Do the work.',
      goal: () => 'Do the work.',
      tools: [getThingTool],
      // no requiredTools
      maxIterations: 3,
    };

    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('TOOL_CALL: get_thing\n{}'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nThe complete document.'));

    await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });

    const calls = vi.mocked(api.callAgent).mock.calls.map((c) => c[0] as { systemPrompt: string });
    expect(calls[0].systemPrompt).toContain(FULL_MARKER);
    expect(calls[1].systemPrompt).toContain(FULL_MARKER);
  });
});
