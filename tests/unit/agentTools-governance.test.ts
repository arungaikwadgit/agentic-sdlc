import { describe, expect, it } from 'vitest';
import {
  getGovernanceSnapshotTool,
  getTokenUsageSummaryTool,
} from '../../frontend/src/agents/tools';
import type { AgentPromptContext } from '../../frontend/src/types/agent.types';

function makeContext(): AgentPromptContext {
  return {
    projectName: 'Payments Modernization',
    projectDescription: 'Modernize a regulated payment platform.',
    domain: 'fintech',
    domainContext: 'PCI DSS and auditability are required.',
    priorOutputs: {},
    teamRoster: [],
    agentRunMetrics: [
      {
        agentId: 'sdlcOrchestrator',
        status: 'complete',
        tokensUsed: 4200,
        provider: 'openai',
        model: 'gpt-4o',
      },
      {
        agentId: 'tokenOptimizer',
        status: 'running',
        tokensUsed: -50,
      },
    ],
    governanceSnapshot: {
      reviewGates: [{ id: 'gate0', approved: false }],
      promptOverrideAgentIds: ['manager'],
      contextDocuments: [{ name: 'PCI policy.pdf', kind: 'policy', sizeKb: 64 }],
      creationApproval: { approverRole: 'Project Owner', approvedAt: 123 },
    },
  };
}

describe('governed preflight telemetry tools', () => {
  it('returns a read-only measurable token baseline and clamps invalid negative usage', async () => {
    const result = await getTokenUsageSummaryTool.execute({}, makeContext()) as {
      found: boolean;
      totalTokens: number;
      measuredRuns: number;
      runs: Array<{ tokensUsed: number }>;
    };

    expect(result.found).toBe(true);
    expect(result.totalTokens).toBe(4200);
    expect(result.measuredRuns).toBe(2);
    expect(result.runs).toHaveLength(2);
  });

  it('returns governance metadata without hidden prompts, credentials, or document content', async () => {
    const result = await getGovernanceSnapshotTool.execute({}, makeContext()) as {
      found: boolean;
      snapshot: unknown;
    };
    const serialized = JSON.stringify(result);

    expect(result.found).toBe(true);
    expect(serialized).toContain('PCI policy.pdf');
    expect(serialized).toContain('Project Owner');
    expect(serialized).not.toMatch(/systemPrompt|apiKey|credential|documentContent/i);
  });

  it('reports missing telemetry explicitly instead of inventing evidence', async () => {
    const ctx = makeContext();
    ctx.agentRunMetrics = [];
    ctx.governanceSnapshot = undefined;

    await expect(getTokenUsageSummaryTool.execute({}, ctx)).resolves.toMatchObject({
      found: false,
      totalTokens: 0,
      measuredRuns: 0,
    });
    await expect(getGovernanceSnapshotTool.execute({}, ctx)).resolves.toMatchObject({
      found: false,
    });
  });
});
