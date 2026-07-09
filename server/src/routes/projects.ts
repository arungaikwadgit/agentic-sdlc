/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, requireProjectRole, requireAppAdmin, isAppAdmin } from '../middleware/auth';

const router = Router();

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

/** GET /api/projects/permissions/me — lets the frontend know whether the
 * current user is an app-wide admin, so it can show/hide delete & restore
 * controls without guessing from 403s. Placed before /:id so "permissions"
 * is never matched as a project id. */
router.get('/permissions/me', requireAuth, (req, res) => {
  res.json({ isAppAdmin: isAppAdmin(req.user?.email) });
});

/** GET /api/projects — list all projects the authenticated user has access to */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Owned projects
    const { data: owned, error: e1 } = await supabaseAdmin
      .from('projects')
      .select('id, name, description, domain, status, data, created_at, updated_at, owner_id')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });

    if (e1) throw e1;

    // Member projects
    const { data: memberOf, error: e2 } = await supabaseAdmin
      .from('project_members')
      .select('role, projects(id, name, description, domain, status, data, created_at, updated_at, owner_id)')
      .eq('user_id', userId);

    if (e2) throw e2;

    const memberProjects = (memberOf ?? [])
      .filter((m) => m.projects)
      .map((m) => ({ ...(m.projects as object), userRole: m.role }));

    const ownedWithRole = (owned ?? []).map((p) => ({ ...p, userRole: 'owner' }));
    const deduped = new Map<string, unknown>();
    for (const project of [...ownedWithRole, ...memberProjects]) {
      const id = (project as { id?: string }).id;
      if (!id) continue;
      if (!deduped.has(id) || (project as { userRole?: string }).userRole === 'owner') {
        deduped.set(id, project);
      }
    }

    res.json(Array.from(deduped.values()));
  } catch (err) {
    console.error('[GET /projects]', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/** GET /api/projects/:id — get a single project with full data */
router.get('/:id', requireAuth, requireProjectRole('owner', 'admin', 'member', 'viewer'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Project not found' });

    // Attach team members
    const { data: members } = await supabaseAdmin
      .from('project_members')
      .select('user_id, role, joined_at, invited_email')
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
    const body = CreateProjectSchema.parse(req.body);
    const userId = req.user!.id;
    const userEmail = req.user!.email || '';

    // Seed the creator as project_owner/admin directly in `data.teamMembers`.
    // The frontend's Settings-button gate (getProjectMember -> ROLE_PERMISSIONS)
    // reads project.data.teamMembers, NOT the project_members table below — so
    // without this, the creator would have `owner_id` + a 'admin' project_members
    // row but still show no team member, leaving Settings disabled for them.
    const existingData = (body.data ?? {}) as Record<string, unknown>;
    const existingTeamMembers = Array.isArray(existingData.teamMembers) ? existingData.teamMembers : [];
    const ownerMember = {
      id: uuidv4(),
      name: userEmail ? userEmail.split('@')[0] : 'Owner',
      email: userEmail,
      role: 'Owner',
      appRole: 'project_owner' as const,
      avatarColor: '#6366F1',
      isAdmin: true,
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

    const { error: membershipError } = await supabaseAdmin
      .from('project_members')
      .upsert({
        project_id: data.id,
        user_id: userId,
        role: 'admin',
        invited_email: req.user!.email || null,
        joined_at: new Date().toISOString(),
      }, { onConflict: 'project_id,user_id' });

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
router.patch('/:id', requireAuth, requireProjectRole('owner', 'admin'), async (req, res) => {
  try {
    const body = UpdateProjectSchema.parse(req.body);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('projects')
      .select('data')
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
