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

  it('blocks the artifact when correction remains below 98%', async () => {
    vi.mocked(api.callAgent)
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\n## Validation & Confidence\nConfidence: 90%'))
      .mockResolvedValueOnce(response('FINAL_OUTPUT:\n## Validation & Confidence\nConfidence: 97%'));

    const result = await runL3Agent(def, ctx, { systemPrompt: def.systemPrompt, userPrompt: 'u', agentId: 'architecture' });
    expect(result.output).toContain('Artifact blocked by the agent governance confidence gate');
    expect(result.l3.outputGovernance).toEqual(expect.objectContaining({ passed: false, score: 0.97, blocked: true }));
  });
});
