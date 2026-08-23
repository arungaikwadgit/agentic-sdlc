/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
// Item #5 Phase 3 -- buildSemanticQuery synthesizes the pgvector similarity
// query for agents that opt into evidence grounding (AgentDefinition.
// evidenceSources). Pure function, exported alongside buildAgentPromptContext
// specifically so it can be unit-tested without running the full pipeline.
import { describe, expect, it } from 'vitest';

import { buildSemanticQuery } from '../../frontend/src/services/pipelineEngine';
import type { Project } from '../../frontend/src/types/project.types';

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Acme Ledger',
    description: 'Internal ledger reconciliation platform.',
    domain: 'fintech',
    status: 'draft',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    agentRuns: {},
    reviewGates: {},
    ...overrides,
  } as Project;
}

describe('buildSemanticQuery', () => {
  it('returns undefined for an agent with no evidenceSources (the default for every agent but tokenOptimizer)', () => {
    const project = baseProject();
    expect(buildSemanticQuery(project, 'architecture')).toBeUndefined();
  });

  it('synthesizes a query from the agent description and project identity for an opted-in agent', () => {
    const project = baseProject({ name: 'Acme Ledger', description: 'Internal ledger reconciliation platform.' });
    const query = buildSemanticQuery(project, 'tokenOptimizer');

    expect(query).toBeDefined();
    expect(query).toContain('Acme Ledger');
    expect(query).toContain('Internal ledger reconciliation platform.');
  });

  it('caps the synthesized query at 2000 characters', () => {
    const project = baseProject({ description: 'x'.repeat(5000) });
    const query = buildSemanticQuery(project, 'tokenOptimizer');

    expect(query).toBeDefined();
    expect(query!.length).toBeLessThanOrEqual(2000);
  });
});
