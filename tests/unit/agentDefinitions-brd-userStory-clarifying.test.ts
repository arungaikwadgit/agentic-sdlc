// tests/unit/agentDefinitions-brd-userStory-clarifying.test.ts
//
// Targeted tests for the brd/userStory clarifying-questions feature:
//   - needsClarifyingQuestions flag set on both agent definitions
//   - brd: new Domain-Specific Business Requirements section, project-context
//     self-check, clarifications block only appears when answers exist
//   - userStory: mandatory 5-part per-story structure, clarifications block

import { describe, it, expect } from 'vitest';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';
import type { AgentPromptContext } from '../../frontend/src/types/agent.types';

const BASE_CTX: AgentPromptContext = {
  projectName: 'ShopEase',
  projectDescription: 'An e-commerce platform for small businesses with same-day local delivery',
  domain: 'ecommerce',
  domainContext: 'E-commerce context with product catalogue and checkout flows',
  priorOutputs: {
    manager: 'PRD with FR-001, FR-002',
    brd: 'BR-001: The system shall allow customer returns within 30 days.\nBR-002: The system shall support same-day delivery scheduling.',
  },
  teamRoster: [{ name: 'Dana Dev', role: 'tech-lead', agents: ['architecture'] as never }],
};

const CTX_WITH_ANSWERS: AgentPromptContext = {
  ...BASE_CTX,
  clarifyingAnswers: [
    { question: 'Is this replacing a legacy system?', answer: 'Yes, replacing a spreadsheet-based process.' },
    { question: 'Any budget constraints?', answer: '' }, // left blank — should be filtered out
  ],
};

// ─────────────────────────────────────────────────────────────────
// needsClarifyingQuestions flag
// ─────────────────────────────────────────────────────────────────
describe('needsClarifyingQuestions flag', () => {
  it('is set on brd', () => {
    expect(AGENT_DEFINITIONS.brd.needsClarifyingQuestions).toBe(true);
  });

  it('is set on userStory', () => {
    expect(AGENT_DEFINITIONS.userStory.needsClarifyingQuestions).toBe(true);
  });

  it('is not set on unrelated agents (spot check)', () => {
    expect(AGENT_DEFINITIONS.manager.needsClarifyingQuestions).toBeFalsy();
    expect(AGENT_DEFINITIONS.stakeholder.needsClarifyingQuestions).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────
// brd — domain-specific section, project-context self-check, clarifications
// ─────────────────────────────────────────────────────────────────
describe('brd — improved BRD requirements', () => {
  const def = AGENT_DEFINITIONS.brd;

  it('buildUserPrompt includes a standalone Domain-Specific Business Requirements section', () => {
    expect(def.buildUserPrompt(BASE_CTX)).toContain('Domain-Specific Business Requirements');
  });

  it('goal instructs the agent to produce the domain-specific section distinct from Compliance', () => {
    expect(def.goal!(BASE_CTX)).toMatch(/Domain-Specific Business Requirements.*distinct from Compliance/);
  });

  it('buildUserPrompt requires at least 2 BR-xxx items to trace to the project description', () => {
    expect(def.buildUserPrompt(BASE_CTX)).toMatch(/at least 2.*trace to a specific fact/i);
  });

  it('goal self-check verifies the project-description tracing requirement', () => {
    expect(def.goal!(BASE_CTX)).toMatch(/at least 2 BR-xxx cite a specific project-description fact/);
  });

  it('buildUserPrompt omits the Clarifications block when no answers exist', () => {
    expect(def.buildUserPrompt(BASE_CTX)).not.toContain('Clarifications From the Team');
  });

  it('buildUserPrompt includes the Clarifications block when answers exist', () => {
    const prompt = def.buildUserPrompt(CTX_WITH_ANSWERS);
    expect(prompt).toContain('Clarifications From the Team');
    expect(prompt).toContain('Is this replacing a legacy system?');
    expect(prompt).toContain('Yes, replacing a spreadsheet-based process.');
  });

  it('buildUserPrompt filters out blank answers from the Clarifications block', () => {
    const prompt = def.buildUserPrompt(CTX_WITH_ANSWERS);
    expect(prompt).not.toContain('Any budget constraints?');
  });
});

// ─────────────────────────────────────────────────────────────────
// userStory — mandatory 5-part per-story structure, clarifications
// ─────────────────────────────────────────────────────────────────
describe('userStory — mandatory 5-part story structure', () => {
  const def = AGENT_DEFINITIONS.userStory;

  it('buildUserPrompt requires all five labeled fields', () => {
    const prompt = def.buildUserPrompt(BASE_CTX);
    expect(prompt).toContain('Clear Requirement');
    expect(prompt).toContain('Business Value');
    expect(prompt).toContain('Definition of Ready');
    expect(prompt).toContain('Definition of Done');
    expect(prompt).toContain('Acceptance Criteria');
  });

  it('buildUserPrompt requires exactly one feature/function per story', () => {
    expect(def.buildUserPrompt(BASE_CTX)).toMatch(/exactly one feature\/function/);
  });

  it('systemPrompt requires Business Value as its own line, distinct from the "so that" clause', () => {
    expect(def.systemPrompt).toMatch(/Business Value must be its own explicit line/);
  });

  it('systemPrompt requires story-specific Definition of Ready and Definition of Done', () => {
    expect(def.systemPrompt).toMatch(/Definition of Ready must be story-specific/);
    expect(def.systemPrompt).toMatch(/Definition of Done must be story-specific/);
  });

  it('goal self-check verifies all five mandatory fields and the single-feature rule', () => {
    const goal = def.goal!(BASE_CTX);
    expect(goal).toMatch(/all five mandatory fields/);
    expect(goal).toMatch(/no story bundles more than one feature\/function/);
  });

  it('buildUserPrompt omits the Clarifications block when no answers exist', () => {
    expect(def.buildUserPrompt(BASE_CTX)).not.toContain('Clarifications From the Team');
  });

  it('buildUserPrompt includes the Clarifications block when answers exist', () => {
    expect(def.buildUserPrompt(CTX_WITH_ANSWERS)).toContain('Clarifications From the Team');
  });
});
