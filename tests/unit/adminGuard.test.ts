// tests/unit/adminGuard.test.ts
import { describe, it, expect } from 'vitest';
import type { TeamMember } from '../../frontend/src/types/project.types';

// ── Pure helper extracted from ProjectSettings ─────────────────────────────
function wouldLeaveNoAdmin(members: TeamMember[], memberId: string): boolean {
  return members.filter((m) => m.isAdmin && m.id !== memberId).length === 0;
}

function canAddMember(
  members: TeamMember[],
  name: string,
  role: string,
): { ok: boolean; error?: string } {
  if (!name.trim()) return { ok: false, error: 'Name is required' };
  if (!role.trim()) return { ok: false, error: 'Role is required' };
  if (members.some((m) => m.name.toLowerCase() === name.trim().toLowerCase())) {
    return { ok: false, error: `A member named "${name.trim()}" already exists` };
  }
  return { ok: true };
}

const alice: TeamMember = {
  id: 'u1', name: 'Alice', email: 'alice@test.com',
  role: 'tech-lead', isAdmin: true, avatarColor: '#000',
};
const bob: TeamMember = {
  id: 'u2', name: 'Bob', email: 'bob@test.com',
  role: 'qa-engineer', isAdmin: false, avatarColor: '#111',
};
const carol: TeamMember = {
  id: 'u3', name: 'Carol', email: 'carol@test.com',
  role: 'product-manager', isAdmin: true, avatarColor: '#222',
};

// ── wouldLeaveNoAdmin ──────────────────────────────────────────────────────
describe('wouldLeaveNoAdmin', () => {
  it('returns true when the only admin is removed', () => {
    expect(wouldLeaveNoAdmin([alice, bob], 'u1')).toBe(true);
  });

  it('returns false when another admin still exists', () => {
    expect(wouldLeaveNoAdmin([alice, carol, bob], 'u1')).toBe(false);
  });

  it('returns false when removing a non-admin', () => {
    expect(wouldLeaveNoAdmin([alice, bob], 'u2')).toBe(false);
  });

  it('returns true for a single-member admin list', () => {
    expect(wouldLeaveNoAdmin([alice], 'u1')).toBe(true);
  });

  it('returns true for empty list (no admins remain regardless)', () => {
    // Empty team has 0 admins — removing any id still leaves 0 admins
    expect(wouldLeaveNoAdmin([], 'u1')).toBe(true);
  });

  it('handles memberId that does not exist in list', () => {
    // alice is still an admin even if ghost id is "removed"
    expect(wouldLeaveNoAdmin([alice], 'ghost')).toBe(false);
  });

  it('returns false when multiple admins and one is removed', () => {
    expect(wouldLeaveNoAdmin([alice, carol], 'u1')).toBe(false);
    expect(wouldLeaveNoAdmin([alice, carol], 'u3')).toBe(false);
  });

  it('returns true when all remaining members are non-admins', () => {
    const nonAdmin1: TeamMember = { ...bob, id: 'u4' };
    const nonAdmin2: TeamMember = { ...bob, id: 'u5', name: 'Dave' };
    expect(wouldLeaveNoAdmin([alice, nonAdmin1, nonAdmin2], 'u1')).toBe(true);
  });
});

// ── canAddMember ─────────────────────────────────────────────────────────
describe('canAddMember', () => {
  it('rejects empty name', () => {
    const r = canAddMember([], '', 'tech-lead');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/name/i);
  });

  it('rejects whitespace-only name', () => {
    const r = canAddMember([], '   ', 'tech-lead');
    expect(r.ok).toBe(false);
  });

  it('rejects empty role', () => {
    const r = canAddMember([], 'Alice', '');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/role/i);
  });

  it('rejects duplicate name (case-insensitive)', () => {
    const r = canAddMember([alice], 'alice', 'sre');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already exists/i);
  });

  it('rejects ALICE (uppercase) when alice already exists', () => {
    const r = canAddMember([alice], 'ALICE', 'devops-engineer');
    expect(r.ok).toBe(false);
  });

  it('allows adding unique name', () => {
    const r = canAddMember([alice, bob], 'Dave', 'devops-engineer');
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('allows first member with valid name and role', () => {
    const r = canAddMember([], 'Alice', 'tech-lead');
    expect(r.ok).toBe(true);
  });
});

// ── toggleAdmin guard ──────────────────────────────────────────────────────
describe('toggleAdmin guard (via wouldLeaveNoAdmin)', () => {
  it('blocks revoking admin from last admin', () => {
    const target = alice; // only admin
    const blocked = target.isAdmin && wouldLeaveNoAdmin([alice, bob], target.id);
    expect(blocked).toBe(true);
  });

  it('allows revoking admin when another admin exists', () => {
    const target = alice;
    const blocked = target.isAdmin && wouldLeaveNoAdmin([alice, carol, bob], target.id);
    expect(blocked).toBe(false);
  });

  it('always allows promoting a non-admin (no removal risk)', () => {
    const target = bob; // not admin — short-circuits to false
    const blocked = target.isAdmin && wouldLeaveNoAdmin([alice, bob], target.id);
    expect(blocked).toBe(false);
  });
});
