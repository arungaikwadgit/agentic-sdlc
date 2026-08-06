/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { describe, expect, it } from 'vitest';
import {
  buildArtifactMemoryDigest,
  selectProjectMemoryContext,
  type ProjectMemoryRecord,
} from '../../server/src/services/projectMemory';

function record(overrides: Partial<ProjectMemoryRecord> = {}): ProjectMemoryRecord {
  return {
    id: 'memory-1',
    project_id: 'project-1',
    scope: 'project',
    approved: false,
    title: 'Architecture memory',
    content: 'Decision: use PostgreSQL.\nRisk: connection saturation.\nConstraint: private networking.',
    tags: ['kind:agent-output-summary', 'source-agent:architecture'],
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildArtifactMemoryDigest', () => {
  it('keeps decision-bearing lines and enforces a bounded digest', () => {
    const output = [
      '# Architecture',
      'Introductory prose '.repeat(300),
      'Decision: PostgreSQL is the system of record.',
      'Risk: pool exhaustion under burst traffic.',
      'Constraint: all database access goes through backend APIs.',
    ].join('\n');

    const digest = buildArtifactMemoryDigest(output, 500);
    expect(digest.length).toBeLessThanOrEqual(500);
    expect(digest).toContain('Decision: PostgreSQL');
    expect(digest).toContain('Risk: pool exhaustion');
    expect(digest).toContain('Constraint: all database access');
  });
});

describe('selectProjectMemoryContext', () => {
  it('prioritizes project and dependency memories and stays within budget', () => {
    const result = selectProjectMemoryContext({
      records: [
        record(),
        record({
          id: 'memory-2',
          project_id: 'other-project',
          scope: 'domain_shared',
          domain_id: 'fintech',
          approved: true,
          title: 'Shared compliance memory',
          tags: ['source-agent:securityCompliance'],
        }),
      ],
      projectId: 'project-1',
      agentKey: 'apiDesign',
      dependencyKeys: ['architecture'],
      maxChars: 1_000,
      limit: 2,
    });

    expect(result.recordIds[0]).toBe('memory-1');
    expect(result.coveredAgentKeys).toContain('architecture');
    expect(result.summary.length).toBeLessThanOrEqual(1_000);
    expect(result.estimatedTokens).toBe(Math.ceil(result.summary.length / 4));
  });

  it('deduplicates records returned by project and domain queries', () => {
    const shared = record({ id: 'same', scope: 'domain_shared', approved: true });
    const result = selectProjectMemoryContext({
      records: [shared, shared],
      projectId: 'project-1',
      agentKey: 'architecture',
    });
    expect(result.recordIds).toEqual(['same']);
  });
});
