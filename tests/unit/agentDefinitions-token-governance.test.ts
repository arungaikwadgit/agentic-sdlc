import { describe, expect, it } from 'vitest';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';
import { PHASE_AGENTS, PHASE_ORDER, REVIEW_GATES } from '../../frontend/src/agents/constants';
import type { AgentPromptContext } from '../../frontend/src/types/agent.types';

describe('Token Optimizer and AI Governance agent contracts', () => {
  it('runs both governed preflight agents after orchestration and before the PRD', () => {
    expect(PHASE_ORDER.slice(0, 4)).toEqual(['phase0', 'phase0a', 'phase0b', 'phase1']);
    expect(PHASE_AGENTS.phase0a).toEqual(['tokenOptimizer']);
    expect(PHASE_AGENTS.phase0b).toEqual(['aiGovernance']);
    expect(REVIEW_GATES.gate0).toEqual(['phase0']);

    expect(AGENT_DEFINITIONS.tokenOptimizer.dependsOn).toEqual(['sdlcOrchestrator']);
    expect(AGENT_DEFINITIONS.aiGovernance.dependsOn).toEqual(['sdlcOrchestrator', 'tokenOptimizer']);
  });

  it('defines a measurable, safety-preserving Token Optimizer L3 contract', () => {
    const def = AGENT_DEFINITIONS.tokenOptimizer;
    const toolNames = def.tools?.map((tool) => tool.name) ?? [];

    expect(def.name).toBe('Token Optimizer Agent');
    expect(def.outputLabel).toBe('Token & Cost Optimization Assessment');
    expect(def.maxIterations).toBeGreaterThanOrEqual(7);
    expect(toolNames).toEqual(expect.arrayContaining([
      'get_agent_output',
      'get_agent_catalog',
      'get_available_models',
      'get_token_usage_summary',
      'validate_output_completeness',
    ]));
    expect(def.requiredTools).toEqual(expect.arrayContaining([
      'get_agent_output',
      'get_token_usage_summary',
      'get_available_models',
    ]));
    expect(def.systemPrompt).toMatch(/accuracy before cost reduction/i);
    expect(def.systemPrompt).toMatch(/never remove mandatory legal, security, privacy, governance, or approval/i);

    const prompt = def.buildUserPrompt(makeContext());
    expect(prompt).toMatch(/Original estimated token usage/i);
    expect(prompt).toMatch(/Optimized estimated token usage/i);
    expect(prompt).toMatch(/Estimated token reduction percentage/i);
    expect(prompt).toMatch(/Optimization confidence score/i);
    expect(prompt).toMatch(/approve, revise, or reject/i);
  });

  it('defines evidence-based governance decisions and human approval controls', () => {
    const def = AGENT_DEFINITIONS.aiGovernance;
    const toolNames = def.tools?.map((tool) => tool.name) ?? [];

    expect(def.name).toBe('AI Governance Agent');
    expect(def.outputLabel).toBe('AI Governance Assessment');
    expect(def.maxIterations).toBeGreaterThanOrEqual(8);
    expect(toolNames).toEqual(expect.arrayContaining([
      'get_agent_output',
      'get_governance_snapshot',
      'get_team_roster',
      'get_domain_context',
      'get_phase_rules',
      'validate_output_completeness',
    ]));
    expect(def.requiredTools).toEqual(expect.arrayContaining([
      'get_governance_snapshot',
      'get_agent_output',
      'get_team_roster',
    ]));

    const contract = def.systemPrompt + '\n' + def.buildUserPrompt(makeContext());
    for (const decision of ['Approved', 'Approved with Conditions', 'Human Review Required', 'Blocked', 'Not Applicable']) {
      expect(contract).toContain(decision);
    }
    expect(contract).toMatch(/must not approve.*required evidence is missing/is);
    expect(contract).toMatch(/NIST AI Risk Management Framework/i);
    expect(contract).toMatch(/ISO\/IEC 42001/i);
    expect(contract).toMatch(/human approval/i);
    expect(contract).toMatch(/Governance confidence score/i);
  });

  it('threads both approved preflight artifacts into the foundational PRD', () => {
    const def = AGENT_DEFINITIONS.manager;
    expect(def.dependsOn).toEqual(expect.arrayContaining(['tokenOptimizer', 'aiGovernance']));

    const prompt = def.buildUserPrompt(makeContext());
    expect(prompt).toContain('Token & Cost Optimization Assessment');
    expect(prompt).toContain('AI Governance Assessment');
    expect(def.goal?.(makeContext())).toContain('get_agent_output("tokenOptimizer")');
    expect(def.goal?.(makeContext())).toContain('get_agent_output("aiGovernance")');
  });
});

function makeContext(): AgentPromptContext {
  return {
    projectName: 'Payments Modernization',
    projectDescription: 'Modernize a regulated payment platform.',
    domain: 'fintech',
    domainContext: 'PCI DSS, privacy, fraud controls, and auditability are required.',
    priorOutputs: {
      sdlcOrchestrator: '# Orchestration Plan\nRun the governed delivery pipeline.',
      tokenOptimizer: '# Token & Cost Optimization Assessment\nRecommendation: Approve.',
      aiGovernance: '# AI Governance Assessment\nGovernance Decision: Approved with Conditions.',
    },
    teamRoster: [
      { name: 'Arun Gaikwad', role: 'Project Owner', agents: [] },
    ],
    agentRunMetrics: [
      {
        agentId: 'sdlcOrchestrator',
        status: 'complete',
        tokensUsed: 4200,
        provider: 'openai',
        model: 'gpt-4o',
      },
    ],
    governanceSnapshot: {
      reviewGates: [{ id: 'gate0', approved: false }],
      promptOverrideAgentIds: [],
      contextDocuments: [],
      creationApproval: null,
    },
    agentCatalog: [],
    phaseRules: {
      phaseOrder: [],
      phaseAgents: {} as AgentPromptContext['phaseRules'] extends infer T ? T extends { phaseAgents: infer P } ? P : never : never,
      parallelPhases: [],
      reviewGates: {},
    },
    modelCatalog: [],
  };
}
