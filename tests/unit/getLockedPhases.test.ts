// tests/unit/getLockedPhases.test.ts
import { describe, it, expect } from 'vitest';
import { PHASE_ORDER } from '../../frontend/src/agents/constants';
import type { Project } from '../../frontend/src/types/project.types';

// ── Extracted pure function from ProjectWorkspace ─────────────────────────
const GATE_UNLOCKS_AFTER: Record<string, string> = {
  gate1: 'phase1',
  gate2_3: 'phase3',
  gate5: 'phase5',
  gate6: 'phase6',
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
  it('locks all phases after phase1 when gate1 is not approved', () => {
    const proj = makeProject({ gate1: false, gate2_3: true, gate5: true, gate6: true });
    const locked = getLockedPhases(proj);
    // phase1 index=0, cutoff=0 → phases at index>0 are locked
    const expectedLocked = PHASE_ORDER.slice(1);
    for (const ph of expectedLocked) {
      expect(locked.has(ph), `${ph} should be locked`).toBe(true);
    }
    expect(locked.has('phase1')).toBe(false);
  });

  it('does not lock phase1 when gate1 is approved', () => {
    const proj = makeProject({ gate1: true, gate2_3: true, gate5: true, gate6: true });
    const locked = getLockedPhases(proj);
    expect(locked.has('phase1')).toBe(false);
    expect(locked.has('phase2')).toBe(false);
  });

  it('returns empty set when all gates are approved', () => {
    const proj = makeProject({ gate1: true, gate2_3: true, gate5: true, gate6: true });
    expect(getLockedPhases(proj).size).toBe(0);
  });

  it('locks phases after phase3 when gate2_3 is not approved', () => {
    const proj = makeProject({ gate1: true, gate2_3: false, gate5: true, gate6: true });
    const locked = getLockedPhases(proj);
    const phase3Idx = PHASE_ORDER.indexOf('phase3');
    for (let i = phase3Idx + 1; i < PHASE_ORDER.length; i++) {
      expect(locked.has(PHASE_ORDER[i]), `${PHASE_ORDER[i]} should be locked`).toBe(true);
    }
    // phases up to and including phase3 should not be locked by gate2_3
    for (let i = 0; i <= phase3Idx; i++) {
      // gate1 is approved, so phase1 is not locked; phase2/3 not locked by gate2_3
      expect(locked.has(PHASE_ORDER[i])).toBe(false);
    }
  });

  it('handles missing reviewGates gracefully (treats all as unapproved)', () => {
    const proj = { reviewGates: {} as any };
    const locked = getLockedPhases(proj);
    // All gates missing = unapproved → everything after phase1 locked
    expect(locked.size).toBeGreaterThan(0);
  });

  it('handles reviewGates: undefined gracefully', () => {
    const proj = { reviewGates: undefined as any };
    expect(() => getLockedPhases(proj)).not.toThrow();
  });

  it('accumulates locks from multiple unapproved gates', () => {
    const proj = makeProject({ gate1: false, gate2_3: false, gate5: true, gate6: true });
    const locked = getLockedPhases(proj);
    // gate1 unapproved locks everything after phase1
    // gate2_3 unapproved locks everything after phase3
    // Union = everything after phase1
    const phase1Idx = PHASE_ORDER.indexOf('phase1');
    for (let i = phase1Idx + 1; i < PHASE_ORDER.length; i++) {
      expect(locked.has(PHASE_ORDER[i])).toBe(true);
    }
  });
});

describe('PHASE_ORDER', () => {
  it('has at least 6 phases', () => {
    expect(PHASE_ORDER.length).toBeGreaterThanOrEqual(6);
  });

  it('starts with phase1', () => {
    expect(PHASE_ORDER[0]).toBe('phase1');
  });

  it('has no duplicates', () => {
    expect(new Set(PHASE_ORDER).size).toBe(PHASE_ORDER.length);
  });

  it('all phase IDs match pattern phaseN', () => {
    for (const ph of PHASE_ORDER) {
      expect(ph).toMatch(/^phase\d+$/);
    }
  });
});
