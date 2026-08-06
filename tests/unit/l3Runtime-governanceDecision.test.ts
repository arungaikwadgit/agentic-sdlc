/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 *
 * AI Governance MVP-0 (2026-07-21) -- see
 * docs/architecture/govern-ai-gap-assessment-and-implementation-plan.md, F1.
 * Covers the GOVERNANCE_DECISION_JSON extraction + persistence half of the
 * feature in frontend/src/services/l3Runtime.ts (the aiGovernance-specific
 * block near the end of runL3Agent). Follows the same
 * vi.mock('.../services/api')-plus-runL3Agent pattern as
 * l3Runtime-outputGovernance.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn(),
    extractText: (resp: { choices: Array<{ message: { content: string } }> }) => resp.choices[0].message.content,
  },
  getAuthHeader: vi.fn().mockResolvedValue({}),
}));

import { api } from '../../frontend/src/services/api';
import { runL3Agent } from '../../frontend/src/services/l3Runtime';
import type { AgentDefinition, AgentPromptContext } from '../../frontend/src/types/agent.types';

const ctx: AgentPromptContext = {
  projectName: 'Governed Project',
  projectDescription: 'Test governance',
  domain: 'fintech',
  domainContext: '',
  priorOutputs: {},
  teamRoster: [],
};

const governanceDef: AgentDefinition = {
  id: 'aiGovernance',
  name: 'AI Governance Agent',
  phase: 'phase0b',
  description: 'test',
  outputLabel: 'AI Governance Assessment',
  systemPrompt: 'system',
  buildUserPrompt: () => 'build',
  goal: () => 'goal',
  tools: [],
  maxIterations: 3,
};

const otherDef: AgentDefinition = { ...governanceDef, id: 'architecture', name: 'Architecture Agent' };

function response(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { total_tokens: 10 },
    provider: 'openai' as const,
    model: 'gpt-4o',
  };
}

const VALID_BLOCK = [
  'FINAL_OUTPUT:',
  '## 1. AI Use Case & Inventory',
  'Some prose report content here.',
  '',
  'GOVERNANCE_DECISION_JSON:',
  JSON.stringify({
    decision: 'blocked',
    riskTier: 'high',
    confidence: 82,
    decisionReason: 'Missing PII redaction evidence.',
    findings: [
      { controlId: 'missing-pii-redaction', severity: 'high', gap: 'No redaction pipeline documented.', recommendation: 'Add redaction step.', ownerRole: 'Data Owner' },
      { controlId: 'no-owner', severity: 'low' },
      // Malformed entries below must be silently dropped, not crash extraction.
      { severity: 'high' }, // missing controlId
      { controlId: 'bad-severity' }, // missing severity
      'not-an-object',
    ],
  }),
].join('\n');

describe('AI Governance decision extraction (l3Runtime)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.mocked(api.callAgent).mockReset();
    vi.stubEnv('VITE_L3_ITER_DELAY_MS', '0');
    vi.stubEnv('VITE_API_URL', '/api');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('strips the GOVERNANCE_DECISION_JSON block from the human-facing output and POSTs the parsed decision when projectId is provided', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(response(VALID_BLOCK));

    const result = await runL3Agent(governanceDef, ctx, {
      systemPrompt: governanceDef.systemPrompt,
      userPrompt: 'u',
      agentId: 'aiGovernance',
      projectId: 'proj-123',
    });

    expect(result.output).toContain('AI Use Case & Inventory');
    expect(result.output).not.toContain('GOVERNANCE_DECISION_JSON');
    expect(result.output).not.toContain('"decision"');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/governance/proj-123/decision');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.decision).toBe('blocked');
    expect(body.riskTier).toBe('high');
    expect(body.confidence).toBe(82);
    expect(body.decisionReason).toBe('Missing PII redaction evidence.');
    // Malformed entries (missing controlId/severity, non-object) dropped;
    // valid ones (including the one with no gap/recommendation/ownerRole) kept.
    expect(body.findings).toHaveLength(2);
    expect(body.findings[0]).toEqual({
      controlId: 'missing-pii-redaction',
      severity: 'high',
      gap: 'No redaction pipeline documented.',
      recommendation: 'Add redaction step.',
      ownerRole: 'Data Owner',
    });
    expect(body.findings[1].controlId).toBe('no-owner');
  });

  it('does not call fetch when no projectId is provided, but still strips the block from the output', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(response(VALID_BLOCK));

    const result = await runL3Agent(governanceDef, ctx, {
      systemPrompt: governanceDef.systemPrompt,
      userPrompt: 'u',
      agentId: 'aiGovernance',
      // no projectId
    });

    expect(result.output).not.toContain('GOVERNANCE_DECISION_JSON');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('leaves the output untouched (marker and all) when the JSON after the marker is malformed', async () => {
    const malformed = 'FINAL_OUTPUT:\nReport body.\n\nGOVERNANCE_DECISION_JSON:\n{not valid json';
    vi.mocked(api.callAgent).mockResolvedValueOnce(response(malformed));

    const result = await runL3Agent(governanceDef, ctx, {
      systemPrompt: governanceDef.systemPrompt,
      userPrompt: 'u',
      agentId: 'aiGovernance',
      projectId: 'proj-123',
    });

    expect(result.output).toContain('GOVERNANCE_DECISION_JSON');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('leaves the output untouched when required fields (decision/riskTier) are missing from an otherwise-valid JSON object', async () => {
    const missingFields = 'FINAL_OUTPUT:\nReport body.\n\nGOVERNANCE_DECISION_JSON:\n' + JSON.stringify({ findings: [] });
    vi.mocked(api.callAgent).mockResolvedValueOnce(response(missingFields));

    const result = await runL3Agent(governanceDef, ctx, {
      systemPrompt: governanceDef.systemPrompt,
      userPrompt: 'u',
      agentId: 'aiGovernance',
      projectId: 'proj-123',
    });

    expect(result.output).toContain('GOVERNANCE_DECISION_JSON');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never runs the extraction/persist step at all for a non-aiGovernance agent, even if its output happens to contain the marker text', async () => {
    vi.mocked(api.callAgent).mockResolvedValueOnce(response(VALID_BLOCK));

    const result = await runL3Agent(otherDef, ctx, {
      systemPrompt: otherDef.systemPrompt,
      userPrompt: 'u',
      agentId: 'architecture',
      projectId: 'proj-123',
    });

    // Not aiGovernance -> def.id check short-circuits -> marker stays as-is.
    expect(result.output).toContain('GOVERNANCE_DECISION_JSON');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('brace-matches correctly even when a finding value contains literal braces/escaped quotes', async () => {
    const trickyJson = JSON.stringify({
      decision: 'approved_with_conditions',
      riskTier: 'moderate',
      findings: [{ controlId: 'x', severity: 'medium', gap: 'Config uses {{placeholder}} and a \\"quoted\\" term.' }],
    });
    const text = `FINAL_OUTPUT:\nReport body.\n\nGOVERNANCE_DECISION_JSON:\n${trickyJson}`;
    vi.mocked(api.callAgent).mockResolvedValueOnce(response(text));

    const result = await runL3Agent(governanceDef, ctx, {
      systemPrompt: governanceDef.systemPrompt,
      userPrompt: 'u',
      agentId: 'aiGovernance',
      projectId: 'proj-123',
    });

    expect(result.output).not.toContain('GOVERNANCE_DECISION_JSON');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.decision).toBe('approved_with_conditions');
    expect(body.findings[0].gap).toContain('{{placeholder}}');
  });
});
