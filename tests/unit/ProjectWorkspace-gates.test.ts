// tests/unit/ProjectWorkspace-gates.test.ts
// Pure-function tests for gateForPhase (extracted from
// components/pipeline/ProjectWorkspace.tsx). getLockedPhases is already
// fully covered by tests/unit/getLockedPhases.test.ts and is not duplicated
// here — see docs/test-plans/project-workspace-and-pipeline-orchestration-test-plan.md §2.
import { describe, it, expect } from 'vitest';
import { REVIEW_GATES } from '../../frontend/src/agents/constants';
import type { PhaseId } from '../../frontend/src/types/agent.types';
import type { ReviewGateId } from '../../frontend/src/types/project.types';

/** Which gate covers the given phase (i.e., gate fires AFTER this phase's group)? */
function gateForPhase(phase: PhaseId): ReviewGateId | undefined {
  return (Object.entries(REVIEW_GATES) as [ReviewGateId, PhaseId[]][])
    .find(([, phases]) => phases.includes(phase))?.[0];
}

describe('gateForPhase', () => {
  it('returns gate0 only for the orchestrator phase', () => {
    expect(gateForPhase('phase0')).toBe('gate0');
    expect(gateForPhase('phase0a')).toBeUndefined();
  });

  it('returns gate1 for phase1b (TS-170)', () => {
    expect(gateForPhase('phase1b')).toBe('gate1');
  });

  it('returns gate1 for phase1 as well (both covered by gate1)', () => {
    expect(gateForPhase('phase1')).toBe('gate1');
  });

  it('returns gate3 for phase3 (TS-171)', () => {
    expect(gateForPhase('phase3')).toBe('gate3');
  });

  it('returns gate3 for phase3b and phase3c in canonical order', () => {
    expect(gateForPhase('phase3b')).toBe('gate3');
    expect(gateForPhase('phase3c')).toBe('gate3');
  });

  it('returns gate2 for phase2', () => {
    expect(gateForPhase('phase2')).toBe('gate2');
  });

  it('returns undefined for phase4 — no covering gate (TS-172)', () => {
    expect(gateForPhase('phase4')).toBeUndefined();
  });

  it('returns undefined for phase8 — no covering gate (TS-173)', () => {
    expect(gateForPhase('phase8')).toBeUndefined();
  });

  it('returns gate5 for phase5', () => {
    expect(gateForPhase('phase5')).toBe('gate5');
  });

  it('returns undefined for phase6 — the prototype has no separate gate6', () => {
    expect(gateForPhase('phase6')).toBeUndefined();
  });

  it('returns undefined for phase7 — no covering gate', () => {
    expect(gateForPhase('phase7')).toBeUndefined();
  });
});
