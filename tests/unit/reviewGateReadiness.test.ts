/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { describe, expect, it } from 'vitest';
import { getGateReviewReadiness } from '../../frontend/src/lib/reviewGateReadiness';
import type { Project } from '../../frontend/src/types/project.types';

function projectWithRuns(agentRuns: Project['agentRuns']): Project {
  return { agentRuns } as Project;
}

describe('getGateReviewReadiness', () => {
  it('requires the orchestrator artifact before Gate 0 can open', () => {
    expect(getGateReviewReadiness(projectWithRuns({}), 'gate0').ready).toBe(false);
    expect(getGateReviewReadiness(projectWithRuns({
      sdlcOrchestrator: {
        agentId: 'sdlcOrchestrator',
        status: 'complete',
        output: '# Governed plan',
      },
    }), 'gate0').ready).toBe(true);
  });

  it('keeps a design gate closed while any covered artifact is missing', () => {
    const result = getGateReviewReadiness(projectWithRuns({
      architecture: { agentId: 'architecture', status: 'complete', output: '# Architecture' },
    }), 'gate3');

    expect(result.ready).toBe(false);
    expect(result.pendingAgentIds).toContain('uxResearch');
    expect(result.pendingAgentIds).toContain('uxMockups');
  });

  it('accepts completed artifacts and explicitly skipped agents as review-ready', () => {
    const required = ['architecture', 'uxResearch', 'apiDesign', 'interaction', 'securityCompliance', 'uxMockups'] as const;
    const runs = Object.fromEntries(required.map((agentId, index) => [
      agentId,
      index === 1
        ? { agentId, status: 'skipped' as const }
        : { agentId, status: 'complete' as const, output: '# Artifact' },
    ])) as Project['agentRuns'];

    expect(getGateReviewReadiness(projectWithRuns(runs), 'gate3').ready).toBe(true);
  });

  it('does not treat a complete run with an empty artifact as review-ready', () => {
    const result = getGateReviewReadiness(projectWithRuns({
      sdlcOrchestrator: {
        agentId: 'sdlcOrchestrator',
        status: 'complete',
        output: '   ',
      },
    }), 'gate0');

    expect(result.ready).toBe(false);
    expect(result.pendingAgentIds).toEqual(['sdlcOrchestrator']);
  });
});
