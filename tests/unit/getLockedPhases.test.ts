// tests/unit/getLockedPhases.test.ts
import { describe, it, expect } from 'vitest';
import { PHASE_ORDER } from '../../frontend/src/agents/constants';
import type { Project } from '../../frontend/src/types/project.types';

// ── Extracted pure function from ProjectWorkspace ─────────────────────────
// gate6 is intentionally absent because the Working Prototype phase has no
// separate approval gate.
// Gate cutoffs mirror ProjectWorkspace and the canonical REVIEW_GATES order.
const GATE_UNLOCKS_AFTER: Record<string, string> = {
  gate1: 'phase1b',
  gate2: 'phase2a',
  gate3: 'phase3c',
  gate5: 'phase5',
};

function getLockedPhases(project: Pick<Project, 'reviewGates'>): Set<string> {
  const locked = new Set<string>();
  const phaseIndex = Object.fromEntries(PHASE_ORDER.map((p, i) => [p, i]));
  for (const [gateId, lastCoveredPhase] of Object.entries(GATE_UNLOCKS_AFTER)) {
    const gate = project.reviewGates?.[gateId as keyof Project['reviewGates']];
    if (!gate?.approved) {
      const cutoff = phaseIndex[lastCoveredPhase] ?? -1;
      PHASE_ORDER.forEach((ph, i) => { if (i > cutoff) locked.add(ph); });
    }
  }
  return locked;
}

function makeProject(gateApprovals: Record<string, boolean>): Pick<Project, 'reviewGates'> {
  const reviewGates: any = {};
  for (const [id, approved] of Object.entries(gateApprovals)) {
    reviewGates[id] = { id, approved, afterPhases: [] };
  }
  return { reviewGates };
}

describe('getLockedPhases', () => {
  it('locks all phases after phase1b when gate1 is not approved', () => {
    const proj = makeProject({ gate1: false, gate2: true, gate3: true, gate5: true });
    const locked = getLockedPhases(proj);
    // cutoff = index of 'phase1b' (not a hardcoded 0 — phase0/SDLC Orchestrator now
    // precedes phase1 in PHASE_ORDER, so this must be derived rather than assumed).
    const phase1bIdx = PHASE_ORDER.indexOf('phase1b');
    const expectedLocked = PHASE_ORDER.slice(phase1bIdx + 1);
    for (const ph of expectedLocked) {
      expect(locked.has(ph), `${ph} should be locked`).toBe(true);
    }
    expect(locked.has('phase0')).toBe(false);
    expect(locked.has('phase1')).toBe(false);
  });

  it('does not lock phase1 when gate1 is approved', () => {
    const proj = makeProject({ gate1: true, gate2: true, gate3: true, gate5: true });
    const locked = getLockedPhases(proj);
    expect(locked.has('phase1')).toBe(false);
    expect(locked.has('phase2')).toBe(false);
  });

  it('returns empty set when all gates are approved', () => {
    const proj = makeProject({ gate1: true, gate2: true, gate3: true, gate5: true });
    expect(getLockedPhases(proj).size).toBe(0);
  });

  it('locks phases after phase3c when gate3 is not approved', () => {
    const proj = makeProject({ gate1: true, gate2: true, gate3: false, gate5: true });
    const locked = getLockedPhases(proj);
    const phase3cIdx = PHASE_ORDER.indexOf('phase3c');
    for (let i = phase3cIdx + 1; i < PHASE_ORDER.length; i++) {
      expect(locked.has(PHASE_ORDER[i]), `${PHASE_ORDER[i]} should be locked`).toBe(true);
    }
    // phases up to and including phase3c should not be locked by gate3
    for (let i = 0; i <= phase3cIdx; i++) {
      // gate1/gate2 are approved, so phase1/phase2 are not locked; phase3 through phase3c are not locked by gate3
      expect(locked.has(PHASE_ORDER[i])).toBe(false);
    }
  });

  it('handles missing reviewGates gracefully (treats all as unapproved)', () => {
    const proj = { reviewGates: {} as any };
    const locked = getLockedPhases(proj);
    // All gates missing = unapproved → everything after phase1b locked
    expect(locked.size).toBeGreaterThan(0);
  });

  it('handles reviewGates: undefined gracefully', () => {
    const proj = { reviewGates: undefined as any };
    expect(() => getLockedPhases(proj)).not.toThrow();
  });

  it('accumulates locks from multiple unapproved gates', () => {
    const proj = makeProject({ gate1: false, gate2: false, gate3: false, gate5: true });
    const locked = getLockedPhases(proj);
    // gate1 unapproved locks everything after phase1b
    // gate2/gate3 unapproved lock everything after phase2a/phase3c
    // Union = everything after phase1b
    const phase1bIdx = PHASE_ORDER.indexOf('phase1b');
    for (let i = phase1bIdx + 1; i < PHASE_ORDER.length; i++) {
      expect(locked.has(PHASE_ORDER[i])).toBe(true);
    }
  });
});

describe('PHASE_ORDER', () => {
  it('has at least 6 phases', () => {
    expect(PHASE_ORDER.length).toBeGreaterThanOrEqual(6);
  });

  it('starts with phase0 (SDLC Orchestrator)', () => {
    expect(PHASE_ORDER[0]).toBe('phase0');
  });

  it('has no duplicates', () => {
    expect(new Set(PHASE_ORDER).size).toBe(PHASE_ORDER.length);
  });

  it('all phase IDs match pattern phaseN or phaseNb', () => {
    for (const ph of PHASE_ORDER) {
      expect(ph).toMatch(/^phase\d+[a-z]?$/);
    }
  });
});
