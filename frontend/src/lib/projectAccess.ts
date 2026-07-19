import type { AppRole, Project, ReviewGateId, TeamMember } from '@/types/project.types';
import { ROLE_PERMISSIONS } from '@/types/project.types';
import type { AgentId } from '@/types/agent.types';

export interface ProjectAccessContext {
  adminMode?: boolean;
  userEmail?: string | null;
  userId?: string | null;
  fallbackMemberId?: string | null;
}

export interface ExportPermissionState {
  canExport: boolean;
  isAdmin: boolean;
  member: TeamMember | null;
  reason: string | null;
}

function norm(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Synthesizes a virtual project_owner TeamMember for the Postgres row owner
 * (project.ownerId, set once at creation and immutable) when data.teamMembers
 * has no matching entry for them. This is a safety net for projects created
 * before creator-seeding existed (or any partial write) -- the person who
 * created the project should never be locked out of their own Settings tab.
 */
function ownerFallbackMember(project: Project, ctx: ProjectAccessContext): TeamMember | null {
  if (!ctx.userId || !project.ownerId) return null;
  if (project.ownerId !== ctx.userId) return null;
  return {
    id: `owner:${project.ownerId}`,
    name: ctx.userEmail ? ctx.userEmail.split('@')[0] : 'Owner',
    email: ctx.userEmail ?? '',
    role: 'Owner',
    appRole: 'project_owner',
    avatarColor: '#6366F1',
    inviteStatus: 'accepted',
  };
}

export function getProjectMember(project: Project, ctx: ProjectAccessContext): TeamMember | null {
  const members = project.teamMembers ?? [];
  const byEmail = norm(ctx.userEmail);
  if (byEmail) {
    const found = members.find((m) => norm(m.email) === byEmail);
    if (found) return found;
  }
  if (ctx.fallbackMemberId) {
    const found = members.find((m) => m.id === ctx.fallbackMemberId);
    if (found) return found;
  }
  return ownerFallbackMember(project, ctx);
}

/**
 * The ONE place "can this person administer this project" is decided.
 * Authoritative source is appRole === 'project_owner' -- there used to be
 * a second, independent TeamMember.isAdmin boolean that could drift from
 * appRole (see the @deprecated note on that field in project.types.ts);
 * that duplication is retired as of this function.
 */
export function isProjectAdminUser(project: Project, ctx: ProjectAccessContext): boolean {
  if (ctx.adminMode) return true;
  const member = getProjectMember(project, ctx);
  return member?.appRole === 'project_owner';
}

export function getProjectExportPermission(project: Project, ctx: ProjectAccessContext): ExportPermissionState {
  const member = getProjectMember(project, ctx);
  const isAdmin = isProjectAdminUser(project, ctx);
  if (isAdmin) {
    return { canExport: true, isAdmin: true, member, reason: null };
  }

  if (!member) {
    return {
      canExport: false,
      isAdmin: false,
      member: null,
      reason: 'Export is available only to admins or members explicitly granted export access for this project.',
    };
  }

  const exportAccess = project.exportAccess;
  const allowedRoles = new Set<AppRole>(exportAccess?.enabledRoleIds ?? []);
  const allowedMembers = new Set<string>(exportAccess?.enabledMemberIds ?? []);
  const allowed = allowedMembers.has(member.id) || allowedRoles.has(member.appRole);

  return {
    canExport: allowed,
    isAdmin: false,
    member,
    reason: allowed
      ? null
      : 'Your role does not currently have download/export access for this project.',
  };
}

// Job titles (TeamMember.role, free text) that may act on a review gate in
// addition to the Project Owner and app admins — picked explicitly by Arun
// from the full ROLE_TEMPLATES catalog (see data/roleTemplates.ts) plus one
// custom addition (Delivery Manager isn't a ROLE_TEMPLATES entry, so it only
// matches a member whose job title was typed exactly that way via the
// custom-role field — it won't appear as a quick-apply suggestion). Matched
// case-insensitively; a misspelled title (e.g. "Sr. PM") will not match.
const REVIEW_GATE_APPROVER_TITLES = new Set(
  ['Product Manager', 'Project Manager', 'Engineering Manager', 'Delivery Manager', 'Architect'].map((t) => t.toLowerCase())
);
const REVIEW_GATE_APPROVER_TITLES_LABEL = 'Project Owner, Product Manager, Project Manager, Engineering Manager, Delivery Manager, Architect, or an admin';

export interface ReviewGateAccessContext extends ProjectAccessContext {
  /** Real, production-recognized app admin (AuthContext's isAppAdmin) — distinct
   *  from `adminMode` (the local-dev bypass), which already implies this. */
  isAppAdmin?: boolean;
}

export interface ReviewGatePermissionState {
  canAct: boolean;
  member: TeamMember | null;
  reason: string | null;
}

/**
 * Gate 0 may be approved/rejected only by the Project Owner or an app admin
 * (including the local development admin bypass). Later gates additionally
 * allow members whose job title is in REVIEW_GATE_APPROVER_TITLES. Everyone
 * else can view gate outputs but cannot approve or reject.
 */
export function getReviewGatePermission(
  project: Project,
  ctx: ReviewGateAccessContext,
  gateId?: ReviewGateId,
): ReviewGatePermissionState {
  const member = getProjectMember(project, ctx);
  if (ctx.adminMode || ctx.isAppAdmin) return { canAct: true, member, reason: null };
  if (!member) {
    return { canAct: false, member: null, reason: 'You are not a member of this project.' };
  }
  if (member.appRole === 'project_owner') return { canAct: true, member, reason: null };
  if (gateId === 'gate0') {
    return {
      canAct: false,
      member,
      reason: 'Only the Project Owner or an admin can approve or reject the governed execution plan.',
    };
  }
  if (REVIEW_GATE_APPROVER_TITLES.has(norm(member.role))) return { canAct: true, member, reason: null };
  return {
    canAct: false,
    member,
    reason: `Only the ${REVIEW_GATE_APPROVER_TITLES_LABEL} can approve or reject this gate.`,
  };
}

export interface AgentRunPermissionState {
  canRun: boolean;
  /** True when this member is restricted to a specific agent set (agentAccessScoped) — as opposed to being denied for a role-level reason (e.g. Reviewer/Viewer). */
  isScoped: boolean;
  member: TeamMember | null;
  reason: string | null;
}

/**
 * Per-agent run/edit permission — the UI half of the mandatory-agent-
 * assignment feature (2026-07-11; see InviteModal in ProjectSettings.tsx and
 * authorizeAgentRun() in backend/src/proxy.js, which is the enforced half).
 *
 * Project Owners and admin-mode always get canRun: true regardless of
 * assignment. Reviewer/Viewer are denied here for the ordinary role-level
 * reason (ROLE_PERMISSIONS.canRunAgents === false), unrelated to scoping.
 * An Editor is restricted to project.agentAssignments entries that include
 * their member id only when TeamMember.agentAccessScoped is true; legacy/
 * grandfathered Editors (agentAccessScoped falsy) keep full access, same as
 * before this feature existed.
 */
export function getAgentRunPermission(
  project: Project,
  ctx: ProjectAccessContext,
  agentId: AgentId
): AgentRunPermissionState {
  if (ctx.adminMode) return { canRun: true, isScoped: false, member: null, reason: null };

  const member = getProjectMember(project, ctx);
  if (!member) {
    return { canRun: false, isScoped: false, member: null, reason: 'You are not a member of this project.' };
  }

  if (!ROLE_PERMISSIONS[member.appRole].canRunAgents) {
    return { canRun: false, isScoped: false, member, reason: 'Your assigned project role cannot run agents.' };
  }

  if (member.appRole === 'project_owner' || !member.agentAccessScoped) {
    return { canRun: true, isScoped: false, member, reason: null };
  }

  const assignments = project.agentAssignments ?? [];
  const assigned = assignments.some((a) => a.agentId === agentId && a.memberIds.includes(member.id));
  return {
    canRun: assigned,
    isScoped: true,
    member,
    reason: assigned ? null : 'You are not assigned to run this agent for this project.',
  };
}
