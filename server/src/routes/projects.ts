/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, requireProjectRole, requireAppAdmin, isAppAdmin } from '../middleware/auth';
import { buildArtifactMemoryDigest, selectProjectMemoryContext, type ProjectMemoryRecord } from '../services/projectMemory';

const router = Router();

// team_members is the ONE place project roles/access live now (see
// backend/migrations/006_consolidate_team_members.sql -- project_members was
// dropped, it was a leftover from an earlier, abandoned design that nothing
// in this project's real migration history ever wrote to consistently).
const TEAM_ROLES = ['project_owner', 'editor', 'reviewer', 'viewer'] as const;
type TeamRole = (typeof TEAM_ROLES)[number];

function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === 'string' && (TEAM_ROLES as readonly string[]).includes(value);
}

/** Scans all Supabase auth users to find one by email (case-insensitive).
 * There's no direct "get user by email" in the admin API, so this pages
 * through listUsers() the same way backend/src/proxy.js's
 * findSupabaseUserByEmail() does. Only called for team members who don't
 * already have a user_id on save, so the volume is small in practice. */
async function findUserIdByEmail(email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}

interface JsonTeamMember {
  email?: unknown;
  name?: unknown;
  role?: unknown;        // job title (e.g. "Product Manager") -- maps to team_members.job_role
  appRole?: unknown;     // RBAC role -- maps to team_members.app_role
  avatarColor?: unknown;
  inviteStatus?: unknown;
}

/**
 * Keeps the real team_members table in sync with whatever the Team panel
 * just saved into data.teamMembers (add without invite, role change,
 * removal -- all of which save through PATCH /:id below, which is the only
 * place data.teamMembers is written from). team_members is what
 * requireProjectRole(), the projects list below, and the database's own RLS
 * policies all check -- without this sync, an edit made here would show up
 * in the UI (since the UI reads data.teamMembers back) but never actually
 * change anyone's real access, which is the exact bug this whole
 * consolidation was meant to close.
 *
 * Removed members are marked invite_status='revoked' rather than deleted,
 * to keep invite_log's audit trail intact (it references team_member_id).
 *
 * Best-effort: failures here are logged but never fail the save itself.
 */
async function syncTeamMembersFromProjectData(
  projectId: string,
  ownerId: string,
  teamMembers: unknown,
): Promise<void> {
  if (!Array.isArray(teamMembers)) return;

  const members = (teamMembers as JsonTeamMember[]).filter(
    (m): m is JsonTeamMember & { email: string } =>
      !!m && typeof m === 'object' && typeof m.email === 'string' && m.email.trim() !== '' && isTeamRole(m.appRole),
  );

  const { data: currentRows } = await supabaseAdmin
    .from('team_members')
    .select('id, email, user_id')
    .eq('project_id', projectId);

  const currentByEmail = new Map((currentRows ?? []).map((r) => [r.email.toLowerCase(), r]));
  const jsonEmails = new Set(members.map((m) => m.email.trim().toLowerCase()));

  for (const m of members) {
    const email = m.email.trim().toLowerCase();
    const existing = currentByEmail.get(email);
    const accepted = m.inviteStatus === 'accepted';

    let userId = existing?.user_id ?? null;
    if (!userId && accepted) {
      userId = await findUserIdByEmail(email).catch(() => null);
    }

    try {
      await supabaseAdmin
        .from('team_members')
        .upsert(
          {
            project_id: projectId,
            email,
            name: typeof m.name === 'string' && m.name.trim() ? m.name : email.split('@')[0],
            app_role: m.appRole,
            job_role: typeof m.role === 'string' ? m.role : null,
            avatar_color: typeof m.avatarColor === 'string' ? m.avatarColor : null,
            invite_status: accepted ? 'accepted' : (existing ? undefined : 'pending'),
            user_id: userId,
          },
          { onConflict: 'project_id,email' },
        );
    } catch (err) {
      console.error(`[syncTeamMembersFromProjectData] upsert failed for ${email}:`, err);
    }
  }

  // Revoke anyone no longer present in the saved teamMembers array -- never
  // the project's actual owner, even if they were somehow edited out.
  for (const row of currentRows ?? []) {
    if (row.user_id === ownerId) continue;
    if (!jsonEmails.has(row.email.toLowerCase())) {
      try {
        await supabaseAdmin.from('team_members').update({ invite_status: 'revoked' }).eq('id', row.id);
      } catch (err) {
        console.error(`[syncTeamMembersFromProjectData] revoke failed for ${row.email}:`, err);
      }
    }
  }
}

// ── Validation schemas ────────────────────────────────────────────────────────

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  domain: z.string().optional(),
  techStack: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});

const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  status: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});

const DeleteProjectSchema = z.object({
  remarks: z.string().trim().min(1, 'Remarks are required to delete a project').max(500),
});

const AgentMemoryParamsSchema = z.object({
  id: z.string().uuid(),
  agentKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/),
});

const AgentMemoryQuerySchema = z.object({
  dependencies: z.string().max(1_000).optional(),
  maxChars: z.coerce.number().int().min(1_000).max(12_000).default(6_000),
  limit: z.coerce.number().int().min(1).max(12).default(6),
});

const CaptureAgentMemorySchema = z.object({
  runtimeRunId: z.string().uuid().nullable().optional(),
});

/** Fields inside the `data` JSONB blob that only the dedicated delete/restore
 * routes below are allowed to set. The generic PATCH route below always
 * overwrites these with the current DB values, regardless of what a client
 * sends, so a non-admin edit can never sneak a delete or restore through. */
const ARCHIVE_FIELDS = ['archived', 'archivedReason', 'archivedAt', 'archivedBy'] as const;

function pickArchiveFields(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ARCHIVE_FIELDS) {
    if (data && key in data) out[key] = data[key];
  }
  return out;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/projects/permissions/me — expose app-admin status to the frontend. */
router.get('/permissions/me', requireAuth, (req, res) => {
  res.json({ isAppAdmin: isAppAdmin(req.user?.email) });
});

type ProjectListRow = Record<string, unknown> & {
  id: string;
  owner_id?: string;
  updated_at?: string;
};

async function attachCreatorMetadata(projects: ProjectListRow[]): Promise<ProjectListRow[]> {
  if (projects.length === 0) return projects;

  const { data: owners, error } = await supabaseAdmin
    .from('team_members')
    .select('project_id, user_id, email, name, app_role, job_role')
    .in('project_id', projects.map((project) => project.id))
    .eq('app_role', 'project_owner')
    .eq('invite_status', 'accepted');

  if (error) throw error;
  const ownersByProject = new Map<string, typeof owners>();
  for (const owner of owners ?? []) {
    const projectOwners = ownersByProject.get(owner.project_id as string) ?? [];
    projectOwners.push(owner);
    ownersByProject.set(owner.project_id as string, projectOwners);
  }

  return projects.map((project) => {
    const projectOwners = ownersByProject.get(project.id) ?? [];
    const owner = projectOwners.find((candidate) => candidate.user_id === project.owner_id)
      ?? projectOwners[0];
    return {
      ...project,
      creator_name: owner?.name ?? owner?.email ?? 'Unknown creator',
      creator_email: owner?.email ?? null,
      creator_role: 'Project Owner',
    };
  });
}

/** GET /api/projects — list visible projects, or all projects for an app admin. */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    let projects: ProjectListRow[];

    if (isAppAdmin(req.user?.email)) {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .select('id, name, description, domain, status, data, created_at, updated_at, owner_id')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      projects = (data ?? []) as ProjectListRow[];
    } else {
      const { data: memberOf, error } = await supabaseAdmin
        .from('team_members')
        .select('app_role, projects!team_members_project_id_fkey(id, name, description, domain, status, data, created_at, updated_at, owner_id)')
        .eq('user_id', userId)
        .eq('invite_status', 'accepted');

      if (error) throw error;
      projects = (memberOf ?? [])
        .filter((membership) => membership.projects)
        .map((membership) => ({
          ...(membership.projects as unknown as ProjectListRow),
          userRole: (membership.projects as { owner_id?: string }).owner_id === userId
            ? 'owner'
            : membership.app_role,
        }))
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
    }

    res.json(await attachCreatorMetadata(projects));
  } catch (err) {
    console.error('[GET /projects]', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/** GET /api/projects/:id — get a single project with full data */
/**
 * Backend-owned, relevance-ranked, and bounded memory assembly for an agent.
 */
router.get(
  '/:id/agent-context/:agentKey',
  requireAuth,
  requireProjectRole('project_owner', 'editor', 'reviewer', 'viewer'),
  async (req, res) => {
    try {
      const params = AgentMemoryParamsSchema.parse(req.params);
      const query = AgentMemoryQuerySchema.parse(req.query);
      const dependencies = (query.dependencies ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter((key) => /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key));

      const { data: project, error: projectError } = await supabaseAdmin
        .from('projects')
        .select('id, domain')
        .eq('id', params.id)
        .single();
      if (projectError || !project) return res.status(404).json({ error: 'Project not found' });

      const { data: projectRecords, error: projectMemoryError } = await supabaseAdmin
        .from('memory_records')
        .select('id, project_id, scope, domain_id, approved, title, content, tags, updated_at')
        .eq('project_id', params.id)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (projectMemoryError) throw projectMemoryError;

      let domainRecords: ProjectMemoryRecord[] = [];
      if (project.domain) {
        const { data, error } = await supabaseAdmin
          .from('memory_records')
          .select('id, project_id, scope, domain_id, approved, title, content, tags, updated_at')
          .eq('scope', 'domain_shared')
          .eq('domain_id', project.domain)
          .eq('approved', true)
          .order('updated_at', { ascending: false })
          .limit(25);
        if (error) throw error;
        domainRecords = (data ?? []) as ProjectMemoryRecord[];
      }

      res.json(selectProjectMemoryContext({
        records: [...((projectRecords ?? []) as ProjectMemoryRecord[]), ...domainRecords],
        projectId: params.id,
        agentKey: params.agentKey,
        dependencyKeys: dependencies,
        maxChars: query.maxChars,
        limit: query.limit,
      }));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
      console.error('[GET /projects/:id/agent-context/:agentKey]', err);
      res.status(500).json({ error: 'Failed to assemble project memory context' });
    }
  },
);

/**
 * Capture a deterministic, zero-LLM-cost digest from the persisted output.
 * One generated record per agent is updated on rerun instead of accumulating.
 */
router.post(
  '/:id/agent-context/:agentKey/capture',
  requireAuth,
  requireProjectRole('project_owner', 'editor'),
  async (req, res) => {
    try {
      const params = AgentMemoryParamsSchema.parse(req.params);
      const body = CaptureAgentMemorySchema.parse(req.body ?? {});
      const { data: project, error: projectError } = await supabaseAdmin
        .from('projects')
        .select('id, data')
        .eq('id', params.id)
        .single();
      if (projectError || !project) return res.status(404).json({ error: 'Project not found' });

      const projectData = (project.data ?? {}) as Record<string, unknown>;
      const agentRuns = (projectData.agentRuns ?? {}) as Record<string, { output?: unknown }>;
      const run = agentRuns[params.agentKey];
      if (!run || typeof run.output !== 'string' || !run.output.trim()) {
        return res.status(409).json({ error: 'No completed persisted output is available for this agent' });
      }

      const sourceTag = `source-agent:${params.agentKey}`;
      const stableTags = ['kind:agent-output-summary', sourceTag];
      const tags = body.runtimeRunId ? [...stableTags, `run:${body.runtimeRunId}`] : stableTags;
      const content = buildArtifactMemoryDigest(run.output);
      const title = `${params.agentKey} latest artifact memory`;

      const { data: existingRows, error: existingError } = await supabaseAdmin
        .from('memory_records')
        .select('id')
        .eq('project_id', params.id)
        .eq('scope', 'project')
        .contains('tags', stableTags)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (existingError) throw existingError;

      const existingId = existingRows?.[0]?.id as string | undefined;
      const mutation = existingId
        ? supabaseAdmin.from('memory_records').update({ title, content, tags, approved: false }).eq('id', existingId)
        : supabaseAdmin.from('memory_records').insert({
            project_id: params.id,
            scope: 'project',
            title,
            content,
            tags,
            approved: false,
          });
      const { data, error } = await mutation.select().single();
      if (error || !data) throw error ?? new Error('Memory capture failed');
      res.status(existingId ? 200 : 201).json(data);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
      console.error('[POST /projects/:id/agent-context/:agentKey/capture]', err);
      res.status(500).json({ error: 'Failed to capture project memory' });
    }
  },
);

/** Clear only generated summaries. Curated project/domain memory survives. */
router.delete(
  '/:id/agent-context',
  requireAuth,
  requireProjectRole('project_owner'),
  async (req, res) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const { error } = await supabaseAdmin
        .from('memory_records')
        .delete()
        .eq('project_id', id)
        .eq('scope', 'project')
        .contains('tags', ['kind:agent-output-summary']);
      if (error) throw error;
      res.status(204).send();
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
      console.error('[DELETE /projects/:id/agent-context]', err);
      res.status(500).json({ error: 'Failed to clear generated project memory' });
    }
  },
);

router.get('/:id', requireAuth, requireProjectRole('project_owner', 'editor', 'reviewer', 'viewer'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Project not found' });

    // Attach team members from the canonical team_members table (not
    // data.teamMembers -- that JSONB blob is still what the frontend renders
    // today for backward compatibility, but team_members is the real,
    // access-control-relevant list; exposing both lets a future frontend
    // pass switch over without another schema change).
    const { data: members } = await supabaseAdmin
      .from('team_members')
      .select('id, user_id, email, name, app_role, job_role, avatar_color, invite_status, invited_at, accepted_at')
      .eq('project_id', req.params.id);

    res.json({ ...data, members: members ?? [] });
  } catch (err) {
    console.error('[GET /projects/:id]', err);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

/** POST /api/projects — create a new project */
router.post('/', requireAuth, async (req, res) => {
  try {
    // Invited-only accounts (see AuthUser.isInvitedOnly) are scoped to the
    // project(s) they were invited to -- they don't get to create separate
    // projects of their own. This mirrors the frontend hiding the
    // "+ New Project" button for the same users, but enforced server-side
    // so it's a real boundary, not just a hidden button.
    if (req.user?.isInvitedOnly) {
      res.status(403).json({ error: 'Your account only has access to the project(s) you were invited to.' });
      return;
    }

    const body = CreateProjectSchema.parse(req.body);
    const userId = req.user!.id;
    const userEmail = req.user!.email || '';

    // Seed the creator as project_owner directly in `data.teamMembers`.
    // The frontend's Settings-edit gate (getProjectMember -> appRole ===
    // 'project_owner', see frontend/src/lib/projectAccess.ts) reads
    // project.data.teamMembers, NOT the team_members table synced below — so
    // without this, the creator would have `owner_id` + a team_members row
    // but still show no entry here, leaving Settings disabled for them.
    // (No `isAdmin` field is set — that boolean is deprecated in favor of
    // appRole === 'project_owner' as the sole authority; see the
    // @deprecated note on TeamMember.isAdmin in project.types.ts.)
    const existingData = (body.data ?? {}) as Record<string, unknown>;
    const existingTeamMembers = Array.isArray(existingData.teamMembers) ? existingData.teamMembers : [];
    const ownerMember = {
      id: uuidv4(),
      name: userEmail ? userEmail.split('@')[0] : 'Owner',
      email: userEmail,
      role: 'Owner',
      appRole: 'project_owner' as const,
      avatarColor: '#6366F1',
      inviteStatus: 'accepted' as const,
      acceptedAt: Date.now(),
    };
    const projectData = {
      ...existingData,
      teamMembers: [ownerMember, ...existingTeamMembers],
      activeAdminId: ownerMember.id,
    };

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({
        name: body.name,
        description: body.description ?? '',
        domain: body.domain ?? '',
        status: 'draft',
        owner_id: userId,
        data: projectData,
      })
      .select()
      .single();

    if (error || !data) throw error ?? new Error('Insert failed');

    // The ACTUAL bug this consolidation started from: this used to only
    // insert into project_members (now dropped) + the data.teamMembers JSONB
    // blob above -- never into team_members itself. Confirmed against
    // production before this change: 4 of 5 existing projects had zero
    // team_members row for their own creator. team_members is the one place
    // this needs to exist now (requireProjectRole, GET / above, and the
    // database's own RLS all read it).
    const { error: membershipError } = await supabaseAdmin
      .from('team_members')
      .upsert(
        {
          project_id: data.id,
          user_id: userId,
          email: userEmail,
          name: ownerMember.name,
          app_role: 'project_owner',
          invite_status: 'accepted',
          invited_at: new Date().toISOString(),
          accepted_at: new Date().toISOString(),
        },
        { onConflict: 'project_id,email' },
      );

    if (membershipError) {
      await supabaseAdmin.from('projects').delete().eq('id', data.id);
      throw membershipError;
    }

    res.status(201).json(data);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error('[POST /projects]', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/** PATCH /api/projects/:id — update project (admin/owner only).
 * Archive-state fields (archived, archivedReason, archivedAt, archivedBy) are
 * always forced back to whatever is currently in the DB, no matter what the
 * client sends — only the dedicated DELETE and /restore routes below (both
 * app-admin gated) may change them. This closes off a path where any project
 * owner/admin could otherwise silently un-delete or delete-without-remarks a
 * project through a routine edit. */
/** Only Project Owner (or an app admin, via requireProjectRole's bypass) may
 * save changes -- Editor/Reviewer/Viewer can view everything in Settings but
 * cannot change anything, per the confirmed requirement: "Project
 * Owner/Admin can see and change anything. others can view but cant
 * change." */
router.patch('/:id', requireAuth, requireProjectRole('project_owner'), async (req, res) => {
  try {
    const body = UpdateProjectSchema.parse(req.body);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('projects')
      .select('data, owner_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Project not found' });

    const mergedData = {
      ...(body.data ?? {}),
      ...pickArchiveFields(existing.data as Record<string, unknown> | null),
    };

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update({ ...body, data: mergedData, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) throw error ?? new Error('Update failed');

    // Keep team_members in sync with whatever the Team panel just saved into
    // data.teamMembers (add without invite, role change, removal). Fire-and-
    // log: never blocks the response, since the project itself already saved.
    syncTeamMembersFromProjectData(req.params.id, existing.owner_id as string, mergedData.teamMembers)
      .catch((err) => console.error('[PATCH /projects/:id] syncTeamMembersFromProjectData failed:', err));

    res.json(data);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error('[PATCH /projects/:id]', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/** DELETE /api/projects/:id — app admin only, requires remarks.
 * This is a SOFT delete: the row is never removed from Postgres. It flips
 * `data.archived = true` and records the remarks, timestamp, and admin email,
 * so it can be restored later via POST /:id/restore. (Previously this route
 * did a real `.delete()` — a permanent, unrecoverable removal — even though
 * the Dashboard's own confirm dialog already claimed the project "will be
 * archived and can be restored later". This route now actually matches that
 * promise.) */
router.delete('/:id', requireAuth, requireAppAdmin, async (req, res) => {
  try {
    const body = DeleteProjectSchema.parse(req.body ?? {});

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('projects')
      .select('data')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Project not found' });

    const mergedData = {
      ...(existing.data as Record<string, unknown> ?? {}),
      archived: true,
      archivedReason: body.remarks,
      archivedAt: Date.now(),
      archivedBy: req.user!.email,
    };

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update({ data: mergedData, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) throw error ?? new Error('Soft delete failed');

    res.status(200).json(data);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Remarks are required' });
    console.error('[DELETE /projects/:id]', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

/** POST /api/projects/:id/restore — app admin only.
 * Un-deletes a soft-deleted project by clearing the archive fields. */
router.post('/:id/restore', requireAuth, requireAppAdmin, async (req, res) => {
  try {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('projects')
      .select('data')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Project not found' });

    const mergedData = { ...(existing.data as Record<string, unknown> ?? {}) };
    delete mergedData.archived;
    delete mergedData.archivedReason;
    delete mergedData.archivedAt;
    delete mergedData.archivedBy;

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update({ data: mergedData, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) throw error ?? new Error('Restore failed');

    res.status(200).json(data);
  } catch (err) {
    console.error('[POST /projects/:id/restore]', err);
    res.status(500).json({ error: 'Failed to restore project' });
  }
});

export default router;
