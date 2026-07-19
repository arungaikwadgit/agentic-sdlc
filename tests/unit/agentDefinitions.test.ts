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
  it('PHASE_ORDER has 17 phases', () => {
    expect(PHASE_ORDER.length).toBe(17);
  });

  it('uses the canonical numeric and dependency-tier sequence', () => {
    expect(PHASE_ORDER).toEqual([
      'phase0', 'phase0a', 'phase0b', 'phase1', 'phase1b', 'phase2', 'phase2a',
      'phase3', 'phase3a', 'phase3b', 'phase3c', 'phase4', 'phase4a',
      'phase5', 'phase6', 'phase7', 'phase8',
    ]);
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

  it('covers exactly 32 agents across all phases', () => {
    expect(ALL_AGENT_IDS).toHaveLength(32);
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

  it('has exactly 32 entries — no extra definitions', () => {
    expect(Object.keys(AGENT_DEFINITIONS)).toHaveLength(32);
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

// 2026-07-19 — manager (PRD Agent) was the reported "token optimizer doesn't
// help tool-calling agents" gap: it has a 5-tool MANDATORY STEP SEQUENCE in
// its goal but no requiredTools enforcement and no intermediateSystemPrompt,
// so every one of its tool-gathering iterations resent the full PRD format
// spec. Fixed by giving it the same requiredTools + intermediateSystemPrompt
// pair sdlcOrchestrator already had — these assertions guard both halves of
// that fix, plus the systemPrompt identity copy-paste bug found alongside it.
describe('manager (PRD Agent) — requiredTools and intermediateSystemPrompt', () => {
  it('systemPrompt identifies itself as the PRD Agent, not the SDLC Orchestrator', () => {
    expect(AGENT_DEFINITIONS.manager.systemPrompt).toContain('You are the PRD Agent');
    expect(AGENT_DEFINITIONS.manager.systemPrompt).not.toContain('You are the SDLC Orchestrator Agent');
  });

  it('requiredTools matches the tool calls named in its own MANDATORY STEP SEQUENCE', () => {
    expect(AGENT_DEFINITIONS.manager.requiredTools).toEqual(
      expect.arrayContaining(['get_agent_output', 'get_domain_context', 'get_team_roster', 'get_style_guide'])
    );
  });

  it('every requiredTools entry is actually in its own tools list (nothing required that it cannot call)', () => {
    const toolNames = new Set(AGENT_DEFINITIONS.manager.tools.map((t) => t.name));
    for (const required of AGENT_DEFINITIONS.manager.requiredTools ?? []) {
      expect(toolNames.has(required)).toBe(true);
    }
  });

  it('intermediateSystemPrompt is set and identifies itself correctly', () => {
    expect(AGENT_DEFINITIONS.manager.intermediateSystemPrompt).toBeTruthy();
    expect(AGENT_DEFINITIONS.manager.intermediateSystemPrompt).toContain('You are the PRD Agent');
    expect(AGENT_DEFINITIONS.manager.intermediateSystemPrompt).toContain('have NOT yet earned the right to write FINAL_OUTPUT');
  });

  // Intentionally not a fixed-percentage threshold (e.g. "< 50% of full")
  // — that was tried and turned out fragile: a first measurement attempt
  // was thrown off by this file's CRLF line endings and produced a false
  // ratio. Strict-less-than is the actual invariant that matters (the
  // condensed prompt drops the PRD Quality Standards bullets, so it must be
  // shorter, full stop) without pinning an exact number that future edits
  // to either prompt could break for no real reason.
  it('intermediateSystemPrompt is shorter than the full systemPrompt (it should drop the PRD Quality Standards section)', () => {
    const full = AGENT_DEFINITIONS.manager.systemPrompt.length;
    const intermediate = AGENT_DEFINITIONS.manager.intermediateSystemPrompt?.length ?? full;
    expect(intermediate).toBeLessThan(full);
  });
});

// 2026-07-19 — token-optimization rollout to the rest of the tool-calling
// agents (projectCharter, stakeholder, workingPrototype, devopsEngineer,
// infraEngineer, observabilityEngineer, onCallEngineer), same pattern as
// manager above. Generalized instead of copy-pasting manager's describe
// block 7 more times — loops over every agent that actually has requiredTools
// or intermediateSystemPrompt set and asserts the invariants that must hold
// for ANY agent using this mechanism, regardless of which one it is.
describe('Token-optimization rollout — requiredTools / intermediateSystemPrompt invariants (all agents)', () => {
  const agentsWithRequiredTools = Object.entries(AGENT_DEFINITIONS).filter(
    ([, def]) => (def.requiredTools?.length ?? 0) > 0
  );

  it('at least the expected set of agents has requiredTools set (documents the current rollout surface)', () => {
    const ids = agentsWithRequiredTools.map(([id]) => id).sort();
    expect(ids).toEqual(
      [
        'sdlcOrchestrator', 'tokenOptimizer', 'aiGovernance', 'manager',
        'projectCharter', 'stakeholder', 'workingPrototype',
        'devopsEngineer', 'infraEngineer', 'observabilityEngineer', 'onCallEngineer',
      ].sort()
    );
  });

  for (const [id, def] of agentsWithRequiredTools) {
    it(`${id}: every requiredTools entry is in its own tools list`, () => {
      const toolNames = new Set((def.tools ?? []).map((t) => t.name));
      for (const required of def.requiredTools ?? []) {
        expect(toolNames.has(required), `${id} requires "${required}" but does not list it in tools`).toBe(true);
      }
    });
  }

  const agentsWithIntermediatePrompt = Object.entries(AGENT_DEFINITIONS).filter(
    ([, def]) => !!def.intermediateSystemPrompt
  );

  it('only agents with a real quality-standards/format section to drop have an intermediateSystemPrompt (devopsEngineer/infraEngineer/observabilityEngineer/onCallEngineer deliberately do not — their systemPrompt is already minimal)', () => {
    const ids = agentsWithIntermediatePrompt.map(([id]) => id).sort();
    expect(ids).toEqual(
      ['sdlcOrchestrator', 'manager', 'projectCharter', 'stakeholder', 'workingPrototype'].sort()
    );
  });

  for (const [id, def] of agentsWithIntermediatePrompt) {
    it(`${id}: intermediateSystemPrompt is shorter than the full systemPrompt`, () => {
      expect(def.intermediateSystemPrompt!.length).toBeLessThan(def.systemPrompt.length);
    });

    it(`${id}: intermediateSystemPrompt tells the model it has not earned FINAL_OUTPUT yet`, () => {
      expect(def.intermediateSystemPrompt).toContain('have NOT yet earned the right to write FINAL_OUTPUT');
    });
  }

  it('every agent with requiredTools but no intermediateSystemPrompt has a systemPrompt with nothing substantial to drop (sanity check on the "skip it" decision)', () => {
    // Measured 2026-07-19: BASE_SYSTEM alone is ~2,103 chars, so even a
    // "minimal" systemPrompt (BASE_SYSTEM + one identity sentence) runs
    // ~2,140-2,200 chars once interpolated -- NOT under some small absolute
    // number like 400. The agents that DO have a real quality-standards
    // section on top of BASE_SYSTEM measured 3,200-3,711. 2,500 sits
    // cleanly between the two observed clusters.
    const skipped = agentsWithRequiredTools.filter(([, def]) => !def.intermediateSystemPrompt);
    for (const [id, def] of skipped) {
      expect(def.systemPrompt.length, `${id} systemPrompt grew past the "minimal" threshold`).toBeLessThan(2500);
    }
  });
});
