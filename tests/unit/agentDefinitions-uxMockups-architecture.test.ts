// tests/unit/agentDefinitions-uxMockups-architecture.test.ts
//
// Targeted tests for uxMockups and architecture AGENT_DEFINITIONS:
//   - uxMockups: 2-version structure, CSS custom property variables,
//     responsive design requirement, output format checks
//   - architecture: mermaid fenced-block requirement, "Diagram Requirement" literal
//   - All 6 DIAGRAM_AGENTS: ```mermaid fence requirement, "Diagram Requirement" literal
//
// The general structure of AGENT_DEFINITIONS is covered by agentDefinitions.test.ts.

import { describe, it, expect } from 'vitest';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';
import type { AgentPromptContext, AgentId } from '../../frontend/src/types/agent.types';

const CTX: AgentPromptContext = {
  projectName: 'ShopEase',
  projectDescription: 'An e-commerce platform for small businesses',
  domain: 'ecommerce',
  domainContext: 'E-commerce context with product catalogue and checkout flows',
  priorOutputs: {
    manager: 'Manager output text',
    architecture: 'Architecture document with system components',
    securityCompliance: 'Security audit findings',
  },
  teamRoster: [
    { name: 'Dana Dev', role: 'tech-lead', agents: ['architecture', 'apiDesign'] as AgentId[] },
    { name: 'Sam QA', role: 'qa-engineer', agents: ['testPlan', 'testCases'] as AgentId[] },
  ],
};

// ─────────────────────────────────────────────────────────────────
// uxMockups — two-version structure
// ─────────────────────────────────────────────────────────────────
describe('uxMockups — two-version structure', () => {
  const def = AGENT_DEFINITIONS.uxMockups;

  it('definition exists', () => {
    expect(def).toBeDefined();
  });

  it('buildUserPrompt references Version A', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('Version A');
  });

  it('buildUserPrompt references Version B', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('Version B');
  });

  it('buildUserPrompt does NOT say "3 most important" (old wording removed)', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).not.toMatch(/3\s+most important/i);
  });

  it('buildUserPrompt does NOT contain "Screen 1 of 3"', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).not.toContain('Screen 1 of 3');
  });

  it('description mentions two versions (not 4 screens)', () => {
    // Current description is "Two interactive HTML mockup versions..."
    expect(def.description.toLowerCase()).toMatch(/two|version/i);
  });
});

// ─────────────────────────────────────────────────────────────────
// uxMockups — CSS custom property requirement
// ─────────────────────────────────────────────────────────────────
describe('uxMockups — CSS custom property requirement', () => {
  const def = AGENT_DEFINITIONS.uxMockups;

  it('systemPrompt requires --color-primary CSS variable', () => {
    expect(def.systemPrompt).toContain('--color-primary');
  });

  it('systemPrompt requires --color-secondary CSS variable', () => {
    expect(def.systemPrompt).toContain('--color-secondary');
  });

  it('systemPrompt requires --color-surface CSS variable', () => {
    expect(def.systemPrompt).toContain('--color-surface');
  });

  it('systemPrompt requires --color-text CSS variable', () => {
    expect(def.systemPrompt).toContain('--color-text');
  });

  it('systemPrompt requires --font-family CSS variable', () => {
    expect(def.systemPrompt).toContain('--font-family');
  });

  it('systemPrompt requires --radius CSS variable', () => {
    expect(def.systemPrompt).toContain('--radius');
  });

  it('systemPrompt requires --spacing-unit CSS variable', () => {
    expect(def.systemPrompt).toContain('--spacing-unit');
  });

  it('buildUserPrompt also references CSS custom properties', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('--color-primary');
  });
});

// ─────────────────────────────────────────────────────────────────
// uxMockups — responsive design requirement
// ─────────────────────────────────────────────────────────────────
describe('uxMockups — responsive design requirement', () => {
  const def = AGENT_DEFINITIONS.uxMockups;

  it('systemPrompt requires RESPONSIVE DESIGN', () => {
    expect(def.systemPrompt).toMatch(/responsive/i);
  });

  it('systemPrompt requires mobile-first approach', () => {
    expect(def.systemPrompt).toMatch(/mobile-first/i);
  });

  it('systemPrompt references viewport meta tag', () => {
    expect(def.systemPrompt).toContain('viewport');
  });
});

// ─────────────────────────────────────────────────────────────────
// uxMockups — HTML output format requirements
// ─────────────────────────────────────────────────────────────────
describe('uxMockups — HTML output format requirements', () => {
  const def = AGENT_DEFINITIONS.uxMockups;

  it('buildUserPrompt requires ```html fenced code blocks', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('```html');
  });

  it('buildUserPrompt includes the project name', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('ShopEase');
  });

  it('buildUserPrompt includes the project description', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('An e-commerce platform for small businesses');
  });

  it('buildUserPrompt references the prior architecture output', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('Architecture document with system components');
  });

  it('buildUserPrompt requires EXACTLY 2 html blocks', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toMatch(/exactly 2/i);
  });

  it('systemPrompt requires EXACTLY 2 fenced code blocks', () => {
    expect(def.systemPrompt).toMatch(/exactly 2/i);
  });

  it('buildUserPrompt Appendix section references image prompts', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt.toLowerCase()).toContain('appendix');
    expect(prompt).toContain('Image Prompt');
  });
});

// ─────────────────────────────────────────────────────────────────
// architecture — mermaid and Diagram Requirement
// ─────────────────────────────────────────────────────────────────
describe('architecture — diagram requirements', () => {
  const def = AGENT_DEFINITIONS.architecture;

  it('definition exists', () => {
    expect(def).toBeDefined();
  });

  it('buildUserPrompt contains "mermaid"', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('mermaid');
  });

  it('buildUserPrompt contains "Diagram Requirement"', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('Diagram Requirement');
  });

  it('buildUserPrompt contains ```mermaid fenced block instruction', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('```mermaid');
  });

  it('systemPrompt references architecture domain', () => {
    expect(def.systemPrompt.toLowerCase()).toMatch(/architect/);
  });

  it('buildUserPrompt includes the project name', () => {
    const prompt = def.buildUserPrompt(CTX);
    expect(prompt).toContain('ShopEase');
  });
});

// ─────────────────────────────────────────────────────────────────
// All 6 DIAGRAM_AGENTS — invariant preservation
// ─────────────────────────────────────────────────────────────────
describe('DIAGRAM_AGENTS — invariant preservation', () => {
  const DIAGRAM_AGENT_IDS: AgentId[] = [
    'dataModel',
    'architecture',
    'apiDesign',
    'devopsEngineer',
    'infraEngineer',
    'observabilityEngineer',
  ];

  for (const agentId of DIAGRAM_AGENT_IDS) {
    describe(`${agentId}`, () => {
      it('prompt contains literal string "Diagram Requirement"', () => {
        const prompt = AGENT_DEFINITIONS[agentId].buildUserPrompt(CTX);
        expect(prompt).toContain('Diagram Requirement');
      });

      it('prompt contains ```mermaid fenced block marker', () => {
        const prompt = AGENT_DEFINITIONS[agentId].buildUserPrompt(CTX);
        expect(prompt).toContain('```mermaid');
      });

      it('prompt contains "mermaid" (lowercase)', () => {
        const prompt = AGENT_DEFINITIONS[agentId].buildUserPrompt(CTX);
        expect(prompt.toLowerCase()).toContain('mermaid');
      });

      it('systemPrompt is non-empty and >100 chars', () => {
        expect(AGENT_DEFINITIONS[agentId].systemPrompt.length).toBeGreaterThan(100);
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// Non-diagram agents — do NOT get diagram sections
// ─────────────────────────────────────────────────────────────────
describe('Non-diagram agents — no diagram requirement', () => {
  const NON_DIAGRAM_IDS: AgentId[] = [
    'manager',
    'brd',
    'projectCharter',
    'userStory',
    'businessRules',
    'feasibility',
    'uxResearch',
    'interaction',
    'testPlan',
    'testCases',
    'securityCompliance',
    'sprintPlanner',
    'taskBreakdown',
    'techDebt',
    'codeStructure',
    'codeSnippets',
    'uiComponentLibrary',
    'onCallEngineer',
    'stakeholder',
  ];

  for (const agentId of NON_DIAGRAM_IDS) {
    it(`${agentId} prompt does NOT contain "Diagram Requirement"`, () => {
      const def = AGENT_DEFINITIONS[agentId];
      if (!def) return;
      const prompt = def.buildUserPrompt(CTX);
      expect(prompt).not.toContain('Diagram Requirement');
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// uxMockups — varies correctly with context
// ─────────────────────────────────────────────────────────────────
describe('uxMockups — context-sensitivity', () => {
  const def = AGENT_DEFINITIONS.uxMockups;

  it('adapts project name to the supplied context', () => {
    const ctx1 = { ...CTX, projectName: 'ProjectAlpha' };
    const ctx2 = { ...CTX, projectName: 'ProjectBeta' };
    expect(def.buildUserPrompt(ctx1)).toContain('ProjectAlpha');
    expect(def.buildUserPrompt(ctx2)).toContain('ProjectBeta');
    expect(def.buildUserPrompt(ctx1)).not.toContain('ProjectBeta');
  });

  it('injects prior uxResearch output when available', () => {
    const ctx = {
      ...CTX,
      priorOutputs: {
        ...CTX.priorOutputs,
        uxResearch: 'Users prefer dark mode and large touch targets',
      },
    };
    const prompt = def.buildUserPrompt(ctx);
    expect(prompt).toContain('Users prefer dark mode and large touch targets');
  });

  it('does not throw when priorOutputs is empty', () => {
    const ctx = { ...CTX, priorOutputs: {} };
    expect(() => def.buildUserPrompt(ctx)).not.toThrow();
  });

  it('does not throw when teamRoster is empty', () => {
    const ctx = { ...CTX, teamRoster: [] };
    expect(() => def.buildUserPrompt(ctx)).not.toThrow();
  });
});
