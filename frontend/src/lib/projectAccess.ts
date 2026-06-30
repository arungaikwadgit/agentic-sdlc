import type { AppRole, Project, TeamMember } from '@/types/project.types';

export interface ProjectAccessContext {
  adminMode?: boolean;
  userEmail?: string | null;
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

export function getProjectMember(project: Project, ctx: ProjectAccessContext): TeamMember | null {
  const members = project.teamMembers ?? [];
  const byEmail = norm(ctx.userEmail);
  if (byEmail) {
    const found = members.find((m) => norm(m.email) === byEmail);
    if (found) return found;
  }
  if (ctx.fallbackMemberId) {
    return members.find((m) => m.id === ctx.fallbackMemberId) ?? null;
  }
  return null;
}

export function isProjectAdminUser(project: Project, ctx: ProjectAccessContext): boolean {
  if (ctx.adminMode) return true;
  const member = getProjectMember(project, ctx);
  return !!member?.isAdmin;
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
