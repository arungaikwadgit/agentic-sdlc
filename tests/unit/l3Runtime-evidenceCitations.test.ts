/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// Item #5 Phase 3 -- structured evidence/citations on L3RuntimeMeta.evidence.
// Mirrors the requiresDiagram/missingDiagram additive-flag test pattern:
// the field must only appear when the agent opts in (evidenceSources) AND
// the memory context actually carried semantic evidence, and must stay
// undefined in every other case (no opt-in, no evidence, empty items).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn(),
    extractText: (resp: { choices: Array<{ message: { content: string } }> }) => resp.choices[0].message.content,
  },
}));

import { api } from '../../frontend/src/services/api';
import { runL3Agent } from '../../frontend/src/services/l3Runtime';
import type { AgentDefinition, AgentPromptContext, MemoryEvidenceItem } from '../../frontend/src/types/agent.types';

const evidenceItem: MemoryEvidenceItem = {
  sourceType: 'memory',
  sourceId: 'mem-1',
  title: 'Prior cost-optimization finding',
  version: null,
  updatedAt: '2026-08-01T00:00:00.000Z',
  excerpt: 'Batch size 8 reduced token spend by 22% in a prior run.',
  authority: 87,
  authorized: true,
};

function baseDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'tokenOptimizer',
    name: 'Token Optimizer',
    phase: 'phase6',
    description: 'test',
    outputLabel: 'Token Optimization Report',
    systemPrompt: 'Optimize token usage.',
    buildUserPrompt: () => 'Optimize token usage.',
    goal: () => 'Optimize token usage.',
    tools: [],
    maxIterations: 3,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<AgentPromptContext> = {}): AgentPromptContext {
  return {
    projectName: 'Evidence Project',
    projectDescription: 'Test evidence citation wiring',
    domain: 'technology',
    domainContext: '',
    priorOutputs: {},
    teamRoster: [],
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

describe('L3 evidence citation wiring', () => {
  beforeEach(() => {
    vi.mocked(api.callAgent).mockReset();
    vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
  });

  it('sets l3.evidence when the agent opts in and the memory context carries items', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(response('FINAL_OUTPUT:\n# Report\n\nDone.'));

    const def = baseDef({ evidenceSources: ['project_memory'] });
    const ctx = baseCtx({
      memoryContext: {
        summary: 'Semantic evidence found.',
        evidenceItems: [evidenceItem],
        evidenceConfidence: 82,
        evidenceSufficient: true,
      },
    });

    const result = await runL3Agent(def, ctx, { systemPrompt: 'Optimize.', userPrompt: 'u', agentId: 'tokenOptimizer' });

    expect(result.l3.evidence).toBeDefined();
    expect(result.l3.evidence?.items).toEqual([evidenceItem]);
    expect(result.l3.evidence?.confidence).toBe(82);
    expect(result.l3.evidence?.sufficient).toBe(true);
  });

  it('defaults confidence/sufficient to 0/false when the memory context omits them', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(response('FINAL_OUTPUT:\n# Report\n\nDone.'));

    const def = baseDef({ evidenceSources: ['project_memory'] });
    const ctx = baseCtx({
      memoryContext: {
        summary: 'Semantic evidence found.',
        evidenceItems: [evidenceItem],
      },
    });

    const result = await runL3Agent(def, ctx, { systemPrompt: 'Optimize.', userPrompt: 'u', agentId: 'tokenOptimizer' });

    expect(result.l3.evidence?.confidence).toBe(0);
    expect(result.l3.evidence?.sufficient).toBe(false);
  });

  it('leaves l3.evidence undefined when the agent has not opted in, even if evidence is present', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(response('FINAL_OUTPUT:\n# Report\n\nDone.'));

    const def = baseDef(); // no evidenceSources
    const ctx = baseCtx({
      memoryContext: {
        summary: 'Semantic evidence found.',
        evidenceItems: [evidenceItem],
        evidenceConfidence: 82,
        evidenceSufficient: true,
      },
    });

    const result = await runL3Agent(def, ctx, { systemPrompt: 'Optimize.', userPrompt: 'u', agentId: 'tokenOptimizer' });

    expect(result.l3.evidence).toBeUndefined();
  });

  it('leaves l3.evidence undefined when the agent opts in but no memory context is present', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(response('FINAL_OUTPUT:\n# Report\n\nDone.'));

    const def = baseDef({ evidenceSources: ['project_memory'] });
    const ctx = baseCtx(); // no memoryContext

    const result = await runL3Agent(def, ctx, { systemPrompt: 'Optimize.', userPrompt: 'u', agentId: 'tokenOptimizer' });

    expect(result.l3.evidence).toBeUndefined();
  });

  it('leaves l3.evidence undefined when the agent opts in but evidenceItems is empty', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(response('FINAL_OUTPUT:\n# Report\n\nDone.'));

    const def = baseDef({ evidenceSources: ['project_memory'] });
    const ctx = baseCtx({
      memoryContext: {
        summary: 'Keyword/recency memory, no semantic match this run.',
        evidenceItems: [],
      },
    });

    const result = await runL3Agent(def, ctx, { systemPrompt: 'Optimize.', userPrompt: 'u', agentId: 'tokenOptimizer' });

    expect(result.l3.evidence).toBeUndefined();
  });
});
