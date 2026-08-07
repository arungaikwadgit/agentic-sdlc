/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { describe, expect, it } from 'vitest';
import { getGateReviewReadiness } from '../../frontend/src/lib/reviewGateReadiness';
import type { Project } from '../../frontend/src/types/project.types';

function projectWithRuns(agentRuns: Project['agentRuns'], reviewGates?: Project['reviewGates']): Project {
  return { agentRuns, reviewGates } as Project;
}

/** Shorthand for an already-approved gate record, keyed by gate id. */
function approvedGates(...ids: Array<'gate0' | 'gate1' | 'gate2'>): Project['reviewGates'] {
  return Object.fromEntries(ids.map((id) => [
    id,
    { id, afterPhases: [], approved: true, approvedAt: Date.now(), approvedBy: 'test' },
  ])) as Project['reviewGates'];
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
    // gate0/gate1/gate2 pre-approved so this isolates gate3's own
    // artifact-completeness check rather than incidentally passing because
    // of the earlier-gate-ordering guard below.
    const result = getGateReviewReadiness(projectWithRuns({
      architecture: { agentId: 'architecture', status: 'complete', output: '# Architecture' },
    }, approvedGates('gate0', 'gate1', 'gate2')), 'gate3');

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

    expect(getGateReviewReadiness(
      projectWithRuns(runs, approvedGates('gate0', 'gate1', 'gate2')),
      'gate3',
    ).ready).toBe(true);
  });

  it('will not let a gate be approved while an earlier gate is still unapproved, even if its own artifacts are done', () => {
    // Reproduces the 2026-07-29 case: gate1's own required agents (phase1 +
    // phase1b) are all complete, but gate0 was never approved. The gate1
    // review must not report ready=true just because gate1's artifacts
    // happen to be done.
    const result = getGateReviewReadiness(projectWithRuns({
      manager: { agentId: 'manager', status: 'complete', output: '# PRD' },
      projectCharter: { agentId: 'projectCharter', status: 'complete', output: '# Charter' },
      brd: { agentId: 'brd', status: 'complete', output: '# BRD' },
    }), 'gate1');

    expect(result.ready).toBe(false);
    expect(result.blockedByEarlierGate).toBe('gate0');
  });

  it('lets a gate be approved once all earlier gates are approved and its own artifacts are done', () => {
    const result = getGateReviewReadiness(projectWithRuns({
      manager: { agentId: 'manager', status: 'complete', output: '# PRD' },
      projectCharter: { agentId: 'projectCharter', status: 'complete', output: '# Charter' },
      brd: { agentId: 'brd', status: 'complete', output: '# BRD' },
    }, approvedGates('gate0')), 'gate1');

    expect(result.ready).toBe(true);
    expect(result.blockedByEarlierGate).toBeUndefined();
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
