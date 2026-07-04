// tests/unit/projectAccess.test.ts
// Unit tests for lib/projectAccess.ts — per-project role/permission resolution.
// Covers the email-match and activeAdminId-fallback paths that already existed,
// plus the new project.ownerId safety-net fallback added to fix: project
// creators being locked out of their own Settings tab when data.teamMembers
// has no entry for them (new projects missing the seed, or legacy projects
// created before creator-seeding existed).
import { describe, it, expect } from 'vitest';
import {
  getProjectMember,
  isProjectAdminUser,
  getProjectExportPermission,
} from '../../frontend/src/lib/projectAccess';
import type { Project, TeamMember } from '../../frontend/src/types/project.types';

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: '',
    domain: 'fintech',
    status: 'draft',
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    agentRuns: {},
    reviewGates: {},
    promptOverrides: [],
    mode: 'simple',
    teamMembers: [],
    agentAssignments: [],
    ...overrides,
  } as unknown as Project;
}

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'member-1',
    name: 'Alice',
    email: 'alice@example.com',
    role: 'Product Manager',
    appRole: 'editor',
    avatarColor: '#fff',
    isAdmin: false,
    inviteStatus: 'accepted',
    ...overrides,
  };
}

describe('getProjectMember', () => {
  it('matches by email, case-insensitively and trimmed', () => {
    const proj = baseProject({ teamMembers: [member({ email: 'Alice@Example.com ' })] });
    const found = getProjectMember(proj, { userEmail: '  alice@example.com' });
    expect(found?.id).toBe('member-1');
  });

  it('falls back to fallbackMemberId (activeAdminId) when email does not match', () => {
    const proj = baseProject({
      teamMembers: [member({ id: 'm-2', email: 'bob@example.com' })],
      activeAdminId: 'm-2',
    });
    const found = getProjectMember(proj, { userEmail: 'nobody@example.com', fallbackMemberId: 'm-2' });
    expect(found?.id).toBe('m-2');
  });

  it('returns null when no email/fallback/owner match is found', () => {
    const proj = baseProject({ teamMembers: [member()] });
    const found = getProjectMember(proj, { userEmail: 'nobody@example.com', fallbackMemberId: 'does-not-exist' });
    expect(found).toBeNull();
  });

  it('synthesizes a project_owner member when the caller is project.ownerId and has no teamMembers entry', () => {
    const proj = baseProject({ teamMembers: [], ownerId: 'auth-user-42' });
    const found = getProjectMember(proj, { userEmail: 'creator@example.com', userId: 'auth-user-42' });
    expect(found).not.toBeNull();
    expect(found?.appRole).toBe('project_owner');
    expect(found?.isAdmin).toBe(true);
    expect(found?.email).toBe('creator@example.com');
  });

  it('does not synthesize an owner member when userId does not match project.ownerId', () => {
    const proj = baseProject({ teamMembers: [], ownerId: 'auth-user-42' });
    const found = getProjectMember(proj, { userEmail: 'someone-else@example.com', userId: 'auth-user-99' });
    expect(found).toBeNull();
  });

  it('does not synthesize an owner member when project has no ownerId (legacy, pre-owner_id projects)', () => {
    const proj = baseProject({ teamMembers: [] });
    const found = getProjectMember(proj, { userEmail: 'creator@example.com', userId: 'auth-user-42' });
    expect(found).toBeNull();
  });

  it('prefers a real teamMembers email match over the owner fallback', () => {
    const proj = baseProject({
      teamMembers: [member({ id: 'm-3', email: 'creator@example.com', appRole: 'viewer', isAdmin: false })],
      ownerId: 'auth-user-42',
    });
    const found = getProjectMember(proj, { userEmail: 'creator@example.com', userId: 'auth-user-42' });
    // Real (non-admin) record wins over the synthetic owner fallback.
    expect(found?.id).toBe('m-3');
    expect(found?.appRole).toBe('viewer');
  });
});

describe('isProjectAdminUser', () => {
  it('is true in adminMode regardless of membership', () => {
    const proj = baseProject();
    expect(isProjectAdminUser(proj, { adminMode: true })).toBe(true);
  });

  it('is true for the project owner via the ownerId fallback', () => {
    const proj = baseProject({ teamMembers: [], ownerId: 'auth-user-42' });
    expect(isProjectAdminUser(proj, { userEmail: 'creator@example.com', userId: 'auth-user-42' })).toBe(true);
  });

  it('is false for a non-admin member and for unrelated users', () => {
    const proj = baseProject({ teamMembers: [member({ isAdmin: false })], ownerId: 'auth-user-42' });
    expect(isProjectAdminUser(proj, { userEmail: 'alice@example.com', userId: 'someone-else' })).toBe(false);
    expect(isProjectAdminUser(proj, { userEmail: 'nobody@example.com', userId: 'nobody' })).toBe(false);
  });
});

describe('getProjectExportPermission', () => {
  it('grants export access to the owner via the ownerId fallback', () => {
    const proj = baseProject({ teamMembers: [], ownerId: 'auth-user-42' });
    const perm = getProjectExportPermission(proj, { userEmail: 'creator@example.com', userId: 'auth-user-42' });
    expect(perm.canExport).toBe(true);
    expect(perm.isAdmin).toBe(true);
    expect(perm.reason).toBeNull();
  });

  it('denies export with a reason when there is no member and no owner match', () => {
    const proj = baseProject({ teamMembers: [] });
    const perm = getProjectExportPermission(proj, { userEmail: 'nobody@example.com', userId: 'nobody' });
    expect(perm.canExport).toBe(false);
    expect(perm.isAdmin).toBe(false);
    expect(perm.member).toBeNull();
    expect(perm.reason).toMatch(/admins or members/i);
  });

  it('allows export for a non-admin member only when their role/id is allow-listed', () => {
    const proj = baseProject({
      teamMembers: [member({ id: 'm-4', appRole: 'reviewer', isAdmin: false })],
      exportAccess: { enabledRoleIds: ['reviewer'] },
    });
    const perm = getProjectExportPermission(proj, { userEmail: 'alice@example.com', userId: 'irrelevant' });
    expect(perm.canExport).toBe(true);
    expect(perm.isAdmin).toBe(false);
  });

  it('denies export for a non-admin member whose role/id is not allow-listed', () => {
    const proj = baseProject({
      teamMembers: [member({ id: 'm-5', appRole: 'viewer', isAdmin: false })],
      exportAccess: { enabledRoleIds: ['reviewer'] },
    });
    const perm = getProjectExportPermission(proj, { userEmail: 'alice@example.com', userId: 'irrelevant' });
    expect(perm.canExport).toBe(false);
    expect(perm.reason).toMatch(/does not currently have/i);
  });
});
