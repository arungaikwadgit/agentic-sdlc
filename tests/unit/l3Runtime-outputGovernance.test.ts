/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
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
  projectName: 'Governed Project',
  projectDescription: 'Test governance',
  domain: 'technology',
  domainContext: '',
  priorOutputs: {},
  teamRoster: [],
};

const def: AgentDefinition = {
  id: 'architecture',
  name: 'Architecture Agent',
  phase: 'phase3',
  description: 'test',
  outputLabel: 'Architecture',
  systemPrompt: 'Agentic Governance Requirements',
  buildUserPrompt: () => 'Create architecture.',
  goal: () => 'Create architecture.',
  tools: [],
  maxIterations: 3,
};

function response(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { total_tokens: 10 },
    provider: 'openai' as const,
    model: 'gpt-4o',
  };
}

describe('L3 governed output gate', () => {
  beforeEach(() => {
    vi.mocked(api.callAgent).mockReset();
    vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
  });

  it('requests one correction and accepts the corrected output at 98% or higher', async () => {
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nDraft without validation'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\nFinal artifact\n\n## Validation & Confidence\nValidation complete.\nConfidence: 99%'));

    const result = await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });
    expect(api.callAgent).toHaveBeenCalledTimes(2);
    expect(result.output).toContain('Final artifact');
    expect(result.l3.outputGovernance).toEqual(expect.objectContaining({ passed: true, score: 0.99, blocked: false }));
  });

  // Soft-warn, not hard-block (changed 2026-07-17): a failed governance
  // assessment used to replace the real artifact with a placeholder
  // "[Artifact blocked...]" message. assessGovernedOutput's confidence-score
  // regex is brittle against free-text LLM output, so that discarded
  // perfectly usable work on a near-miss. Now the real output is always
  // returned; l3Meta.outputGovernance.passed/issues flag it for the UI
  // (AgentThinkingPanel's gap-warning banner) instead.
  it('keeps the real artifact and flags it (not blocked) when correction remains below 98%', async () => {
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\n## Validation & Confidence\nConfidence: 90%'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\n## Validation & Confidence\nConfidence: 97%'));

    const result = await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });
    expect(result.output).toContain('## Validation & Confidence');
    expect(result.output).toContain('Confidence: 97%');
    expect(result.output).not.toContain('Artifact blocked');
    expect(result.l3.outputGovernance).toEqual(expect.objectContaining({ passed: false, score: 0.97, blocked: false }));
  });

  it('keeps the real output (not a placeholder) when a marker-less passthrough response fails governance', async () => {
    // A marker-less response is treated as 'passthrough' (see l3Runtime's
    // parseResponse fallback) and hits the same governed-output gate as a
    // normal FINAL_OUTPUT branch — this exercises that path specifically.
    const forcedDef: AgentDefinition = { ...def, maxIterations: 1 };
    vi.mocked(api.callAgent).mockResolvedValueOnce(response('A plain answer with no governance footer at all.'));

    const result = await runL3Agent(forcedDef, ctx, { systemPrompt: forcedDef.systemPrompt, userPrompt: 'u', agentId: 'architecture' });
    expect(result.output).toContain('A plain answer with no governance footer at all.');
    expect(result.output).not.toContain('Artifact blocked');
    expect(result.l3.outputGovernance).toEqual(expect.objectContaining({ passed: false, blocked: false }));
  });
});
