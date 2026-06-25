// tests/unit/agentDefinitions.test.ts
import { describe, it, expect } from 'vitest';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';
import { PHASE_ORDER, PHASE_AGENTS } from '../../frontend/src/agents/constants';
import type { AgentId, AgentPromptContext } from '../../frontend/src/types/agent.types';

const MOCK_CTX: AgentPromptContext = {
  projectName: 'TestApp',
  projectDescription: 'A test application',
  domain: 'saas',
  domainContext: 'SaaS domain context',
  priorOutputs: {},
  teamRoster: [
    { name: 'Alice', role: 'tech-lead', agents: ['architecture', 'apiDesign'] as AgentId[] },
    { name: 'Bob', role: 'qa-engineer', agents: ['testPlan', 'testCases'] as AgentId[] },
  ],
};

// All agent IDs declared across all phases (30 agents, 11 phases including
// phase0/SDLC Orchestrator, phase1b, and phase3b)
const ALL_AGENT_IDS: AgentId[] = PHASE_ORDER.flatMap((ph) => PHASE_AGENTS[ph]);

describe('PHASE_ORDER and PHASE_AGENTS', () => {
  it('PHASE_ORDER has 11 phases', () => {
    expect(PHASE_ORDER.length).toBe(11);
  });

  it('starts with phase0 (SDLC Orchestrator)', () => {
    expect(PHASE_ORDER[0]).toBe('phase0');
  });

  it('includes phase1b', () => {
    expect(PHASE_ORDER).toContain('phase1b');
  });

  it('includes phase3b', () => {
    expect(PHASE_ORDER).toContain('phase3b');
  });

  it('has no duplicate phase IDs', () => {
    expect(new Set(PHASE_ORDER).size).toBe(PHASE_ORDER.length);
  });

  it('covers exactly 30 agents across all phases', () => {
    expect(ALL_AGENT_IDS).toHaveLength(30);
  });

  it('has no duplicate agent IDs across phases', () => {
    const seen = new Set<string>();
    for (const id of ALL_AGENT_IDS) {
      expect(seen.has(id), `Duplicate agent: ${id}`).toBe(false);
      seen.add(id);
    }
  });
});

describe('AGENT_DEFINITIONS registry completeness', () => {
  it('has a definition for every agent in PHASE_AGENTS', () => {
    for (const id of ALL_AGENT_IDS) {
      expect(AGENT_DEFINITIONS[id], `Missing definition for ${id}`).toBeDefined();
    }
  });

  it('has exactly 30 entries — no extra definitions', () => {
    expect(Object.keys(AGENT_DEFINITIONS)).toHaveLength(30);
  });

  it('every definition has a non-empty name', () => {
    for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
      expect(def.name.length, `${id}.name empty`).toBeGreaterThan(0);
    }
  });

  it('every definition has a non-empty outputLabel', () => {
    for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
      expect(def.outputLabel.length, `${id}.outputLabel empty`).toBeGreaterThan(0);
    }
  });

  it('every definition has a non-empty systemPrompt (>10 chars)', () => {
    for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
      expect(def.systemPrompt.length, `${id}.systemPrompt too short`).toBeGreaterThan(10);
    }
  });

  it('every definition has a buildUserPrompt function', () => {
    for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
      expect(typeof def.buildUserPrompt, `${id}.buildUserPrompt not a function`).toBe('function');
    }
  });
});

describe('AGENT_DEFINITIONS — buildUserPrompt output', () => {
  it('every buildUserPrompt produces a non-empty string', () => {
    for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
      const prompt = def.buildUserPrompt(MOCK_CTX);
      expect(typeof prompt, `${id} returned non-string`).toBe('string');
      expect(prompt.length, `${id} returned empty string`).toBeGreaterThan(0);
    }
  });

  it('every prompt injects the project name', () => {
    for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
      const prompt = def.buildUserPrompt(MOCK_CTX);
      expect(prompt, `${id} missing project name`).toContain('TestApp');
    }
  });

  it('every prompt injects team member names from roster', () => {
    for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
      const prompt = def.buildUserPrompt(MOCK_CTX);
      expect(prompt, `${id} missing team member Alice`).toContain('Alice');
    }
  });

  it('prompt with empty teamRoster omits team section gracefully', () => {
    const ctx = { ...MOCK_CTX, teamRoster: [] };
    for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
      expect(() => def.buildUserPrompt(ctx), `${id} threw on empty roster`).not.toThrow();
    }
  });
});

describe('Diagram-enabled agents', () => {
  const DIAGRAM_AGENTS: AgentId[] = [
    'dataModel', 'architecture', 'apiDesign',
    'devopsEngineer', 'infraEngineer', 'observabilityEngineer',
  ];

  it('exactly 6 agents have diagram requirements', () => {
    expect(DIAGRAM_AGENTS).toHaveLength(6);
  });

  for (const agentId of DIAGRAM_AGENTS) {
    it(`${agentId} prompt includes Mermaid diagram requirement`, () => {
      const def = AGENT_DEFINITIONS[agentId];
      const prompt = def.buildUserPrompt(MOCK_CTX);
      expect(prompt).toContain('mermaid');
      expect(prompt).toContain('Diagram Requirement');
    });
  }

  it('non-diagram agents do not include Diagram Requirement', () => {
    const nonDiagram: AgentId[] = ['manager', 'brd', 'userStory', 'testPlan', 'securityCompliance'];
    for (const id of nonDiagram) {
      const prompt = AGENT_DEFINITIONS[id].buildUserPrompt(MOCK_CTX);
      expect(prompt, `${id} should not have diagram requirement`).not.toContain('Diagram Requirement');
    }
  });
});

describe('Key agent prompt content', () => {
  it('manager prompt includes project description', () => {
    const prompt = AGENT_DEFINITIONS.manager.buildUserPrompt(MOCK_CTX);
    expect(prompt).toContain('A test application');
  });

  it('testPlan systemPrompt references testing', () => {
    expect(AGENT_DEFINITIONS.testPlan.systemPrompt.toLowerCase()).toMatch(/test/);
  });

  it('securityCompliance systemPrompt references security', () => {
    expect(AGENT_DEFINITIONS.securityCompliance.systemPrompt.toLowerCase()).toMatch(/security/);
  });

  it('architecture systemPrompt references architecture', () => {
    expect(AGENT_DEFINITIONS.architecture.systemPrompt.toLowerCase()).toMatch(/architect/);
  });

  it('devopsEngineer systemPrompt references devops or CI/CD or pipeline', () => {
    const sp = AGENT_DEFINITIONS.devopsEngineer.systemPrompt.toLowerCase();
    expect(sp).toMatch(/devops|ci\/cd|pipeline|deploy/);
  });

  it('dataModel systemPrompt references data or schema or model', () => {
    const sp = AGENT_DEFINITIONS.dataModel.systemPrompt.toLowerCase();
    expect(sp).toMatch(/data|schema|model|entity/);
  });
});
