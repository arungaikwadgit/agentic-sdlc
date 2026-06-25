/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, requireProjectRole } from '../middleware/auth';

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

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/projects — list all projects the authenticated user has access to */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Owned projects
    const { data: owned, error: e1 } = await supabaseAdmin
      .from('projects')
      .select('id, name, description, domain, status, created_at, updated_at, owner_id')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });

    if (e1) throw e1;

    // Member projects
    const { data: memberOf, error: e2 } = await supabaseAdmin
      .from('project_members')
      .select('role, projects(id, name, description, domain, status, created_at, updated_at, owner_id)')
      .eq('user_id', userId);

    if (e2) throw e2;

    const memberProjects = (memberOf ?? [])
      .filter((m) => m.projects)
      .map((m) => ({ ...(m.projects as object), userRole: m.role }));

    const ownedWithRole = (owned ?? []).map((p) => ({ ...p, userRole: 'owner' }));

    res.json([...ownedWithRole, ...memberProjects]);
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

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({
        name: body.name,
        description: body.description ?? '',
        domain: body.domain ?? '',
        status: 'draft',
        owner_id: userId,
        data: body.data ?? {},
      })
      .select()
      .single();

    if (error || !data) throw error ?? new Error('Insert failed');

    res.status(201).json(data);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error('[POST /projects]', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/** PATCH /api/projects/:id — update project (admin/owner only) */
router.patch('/:id', requireAuth, requireProjectRole('owner', 'admin'), async (req, res) => {
  try {
    const body = UpdateProjectSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update({ ...body, updated_at: new Date().toISOString() })
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

/** DELETE /api/projects/:id — owner only */
router.delete('/:id', requireAuth, requireProjectRole('owner'), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    res.status(204).send();
  } catch (err) {
    console.error('[DELETE /projects/:id]', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
