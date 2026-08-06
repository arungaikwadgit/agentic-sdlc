// tests/unit/adminGuard.test.ts
//
// Pure re-implementations of the guard logic in ProjectSettings.tsx that
// protects against a project ever ending up with zero Project Owners.
//
// This used to test an `isAdmin` boolean toggle ("Make admin"/"Revoke
// admin") that was independent of a member's appRole -- that was exactly
// the duplicated-authorization bug the team_members/appRole consolidation
// closed (see the @deprecated note on TeamMember.isAdmin in
// project.types.ts). The toggle and its isAdmin-based guard are gone;
// Project Owner status is now granted/revoked only by changing appRole
// (via the role dropdown / invite modal), so the "last owner" guard is
// keyed off appRole === 'project_owner' instead.
import { describe, it, expect } from 'vitest';
import type { TeamMember } from '../../frontend/src/types/project.types';

// ── Pure helper mirroring wouldLeaveNoOwner in ProjectSettings.tsx ─────────
function wouldLeaveNoOwner(members: TeamMember[], memberId: string): boolean {
  return members.filter((m) => m.appRole === 'project_owner' && m.id !== memberId).length === 0;
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
  role: 'tech-lead', appRole: 'project_owner', avatarColor: '#000',
  inviteStatus: 'accepted',
};
const bob: TeamMember = {
  id: 'u2', name: 'Bob', email: 'bob@test.com',
  role: 'qa-engineer', appRole: 'editor', avatarColor: '#111',
  inviteStatus: 'accepted',
};
const carol: TeamMember = {
  id: 'u3', name: 'Carol', email: 'carol@test.com',
  role: 'product-manager', appRole: 'project_owner', avatarColor: '#222',
  inviteStatus: 'accepted',
};

// ── wouldLeaveNoOwner ──────────────────────────────────────────────────────
describe('wouldLeaveNoOwner', () => {
  it('returns true when the only Project Owner is removed', () => {
    expect(wouldLeaveNoOwner([alice, bob], 'u1')).toBe(true);
  });

  it('returns false when another Project Owner still exists', () => {
    expect(wouldLeaveNoOwner([alice, carol, bob], 'u1')).toBe(false);
  });

  it('returns false when removing a non-owner', () => {
    expect(wouldLeaveNoOwner([alice, bob], 'u2')).toBe(false);
  });

  it('returns true for a single-member owner list', () => {
    expect(wouldLeaveNoOwner([alice], 'u1')).toBe(true);
  });

  it('returns true for empty list (no owners remain regardless)', () => {
    // Empty team has 0 owners — removing any id still leaves 0 owners
    expect(wouldLeaveNoOwner([], 'u1')).toBe(true);
  });

  it('handles memberId that does not exist in list', () => {
    // alice is still an owner even if ghost id is "removed"
    expect(wouldLeaveNoOwner([alice], 'ghost')).toBe(false);
  });

  it('returns false when multiple owners and one is removed', () => {
    expect(wouldLeaveNoOwner([alice, carol], 'u1')).toBe(false);
    expect(wouldLeaveNoOwner([alice, carol], 'u3')).toBe(false);
  });

  it('returns true when all remaining members are non-owners', () => {
    const nonOwner1: TeamMember = { ...bob, id: 'u4' };
    const nonOwner2: TeamMember = { ...bob, id: 'u5', name: 'Dave' };
    expect(wouldLeaveNoOwner([alice, nonOwner1, nonOwner2], 'u1')).toBe(true);
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

// ── removeMember guard ──────────────────────────────────────────────────────
describe('removeMember guard (via wouldLeaveNoOwner)', () => {
  it('blocks removing the last Project Owner', () => {
    const target = alice; // only owner
    const blocked = target.appRole === 'project_owner' && wouldLeaveNoOwner([alice, bob], target.id);
    expect(blocked).toBe(true);
  });

  it('allows removing a Project Owner when another owner exists', () => {
    const target = alice;
    const blocked = target.appRole === 'project_owner' && wouldLeaveNoOwner([alice, carol, bob], target.id);
    expect(blocked).toBe(false);
  });

  it('always allows removing a non-owner (no vacancy risk)', () => {
    const target = bob; // not an owner — short-circuits to false
    const blocked = target.appRole === 'project_owner' && wouldLeaveNoOwner([alice, bob], target.id);
    expect(blocked).toBe(false);
  });
});

// ── role-change (downgrade) guard ───────────────────────────────────────────
// Mirrors the guard added to handleInviteSubmit in ProjectSettings.tsx: the
// only place an existing member's appRole changes is the invite/edit-role
// modal, and demoting the last Project Owner away from project_owner must
// be blocked the same way removing them is.
describe('role-downgrade guard (via wouldLeaveNoOwner)', () => {
  function blocksDowngrade(members: TeamMember[], target: TeamMember, nextAppRole: TeamMember['appRole']): boolean {
    return target.appRole === 'project_owner' && nextAppRole !== 'project_owner' && wouldLeaveNoOwner(members, target.id);
  }

  it('blocks demoting the only Project Owner to editor', () => {
    expect(blocksDowngrade([alice, bob], alice, 'editor')).toBe(true);
  });

  it('allows demoting a Project Owner when another owner remains', () => {
    expect(blocksDowngrade([alice, carol, bob], alice, 'editor')).toBe(false);
  });

  it('allows re-assigning the only owner to project_owner (no-op role change)', () => {
    expect(blocksDowngrade([alice, bob], alice, 'project_owner')).toBe(false);
  });

  it('does not block changing a non-owner member role', () => {
    expect(blocksDowngrade([alice, bob], bob, 'viewer')).toBe(false);
  });
});
