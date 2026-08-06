/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

/**
 * /api/invites — team invite link system
 *
 * POST /api/invites             → create an invite (owner/admin)
 * GET  /api/invites/:token      → lookup invite info (public, no auth required)
 * POST /api/invites/:token/accept → accept invite (authenticated user)
 * GET  /api/invites/project/:id  → list pending invites for a project (owner/admin)
 * DELETE /api/invites/:id       → revoke an invite (owner/admin)
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, requireProjectRole } from '../middleware/auth';

const router = Router();

const CreateInviteSchema = z.object({
  projectId: z.string().uuid(),
  role: z.enum(['member', 'viewer']).default('member'),
  email: z.string().email().optional(),           // optional: lock invite to a specific email
  expiresInDays: z.number().min(1).max(30).default(7),
});

/**
 * POST /api/invites
 * Create a new invite link for a project.
 * Only owners and admins can invite people.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const body = CreateInviteSchema.parse(req.body);

    // Verify the caller is owner or admin on this project
    const userId = req.user!.id;
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('owner_id')
      .eq('id', body.projectId)
      .single();

    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.owner_id !== userId) {
      const { data: member } = await supabaseAdmin
        .from('project_members')
        .select('role')
        .eq('project_id', body.projectId)
        .eq('user_id', userId)
        .single();

      if (!member || !['owner', 'admin'].includes(member.role)) {
        return res.status(403).json({ error: 'Only project owners or admins can create invites' });
      }
    }

    const token = randomBytes(24).toString('hex');  // 48-char URL-safe hex token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + body.expiresInDays);

    const { data: invite, error } = await supabaseAdmin
      .from('invites')
      .insert({
        project_id: body.projectId,
        token,
        role: body.role,
        invited_email: body.email ?? null,
        created_by: userId,
        expires_at: expiresAt.toISOString(),
        accepted: false,
      })
      .select()
      .single();

    if (error || !invite) throw error ?? new Error('Failed to create invite');

    res.status(201).json({
      ...invite,
      inviteUrl: `/invite/${token}`,   // frontend constructs the full URL
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error('[POST /invites]', err);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

/**
 * GET /api/invites/:token
 * Look up invite details by token — used on the "you've been invited" landing page.
 * No auth required so unauthenticated users can see the invite before signing up.
 */
router.get('/:token', async (req, res) => {
  try {
    const { data: invite, error } = await supabaseAdmin
      .from('invites')
      .select('id, role, invited_email, expires_at, accepted, projects(id, name, description)')
      .eq('token', req.params.token)
      .single();

    if (error || !invite) return res.status(404).json({ error: 'Invite not found or expired' });

    if (invite.accepted) return res.status(410).json({ error: 'This invite has already been used' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'This invite has expired' });

    // Return invite info without exposing the raw token
    res.json({
      id: invite.id,
      role: invite.role,
      invitedEmail: invite.invited_email,
      expiresAt: invite.expires_at,
      project: invite.projects,
    });
  } catch (err) {
    console.error('[GET /invites/:token]', err);
    res.status(500).json({ error: 'Failed to look up invite' });
  }
});

/**
 * POST /api/invites/:token/accept
 * Accept an invite — adds the authenticated user as a project member.
 * If the invite was email-locked, the user's email must match.
 */
router.post('/:token/accept', requireAuth, async (req, res) => {
  try {
    const { data: invite, error } = await supabaseAdmin
      .from('invites')
      .select('*')
      .eq('token', req.params.token)
      .single();

    if (error || !invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.accepted) return res.status(410).json({ error: 'This invite has already been used' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'This invite has expired' });

    // Email lock check
    if (invite.invited_email && invite.invited_email !== req.user!.email) {
      return res.status(403).json({ error: 'This invite was sent to a different email address' });
    }

    // Check if user is already a member
    const { data: existing } = await supabaseAdmin
      .from('project_members')
      .select('id')
      .eq('project_id', invite.project_id)
      .eq('user_id', req.user!.id)
      .single();

    if (existing) return res.status(409).json({ error: 'You are already a member of this project' });

    // Add to project_members
    const { error: memberError } = await supabaseAdmin
      .from('project_members')
      .insert({
        project_id: invite.project_id,
        user_id: req.user!.id,
        role: invite.role,
        invited_email: invite.invited_email,
        joined_at: new Date().toISOString(),
      });

    if (memberError) throw memberError;

    // Mark invite as accepted
    await supabaseAdmin
      .from('invites')
      .update({ accepted: true, accepted_by: req.user!.id, accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    res.json({ success: true, projectId: invite.project_id, role: invite.role });
  } catch (err) {
    console.error('[POST /invites/:token/accept]', err);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

/**
 * GET /api/invites/project/:projectId
 * List pending invites for a project — owner/admin view.
 */
router.get('/project/:projectId', requireAuth, requireProjectRole('owner', 'admin'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('invites')
      .select('id, role, invited_email, expires_at, accepted, created_at, created_by')
      .eq('project_id', req.params.projectId)
      .eq('accepted', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    console.error('[GET /invites/project/:projectId]', err);
    res.status(500).json({ error: 'Failed to list invites' });
  }
});

/**
 * DELETE /api/invites/:id
 * Revoke a pending invite (owner/admin only).
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // Get invite to find project context for RBAC check
    const { data: invite } = await supabaseAdmin
      .from('invites')
      .select('project_id')
      .eq('id', req.params.id)
      .single();

    if (!invite) return res.status(404).json({ error: 'Invite not found' });

    // Manually verify owner/admin (we don't have project id in params for the generic RBAC middleware)
    const userId = req.user!.id;
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('owner_id')
      .eq('id', invite.project_id)
      .single();

    if (project?.owner_id !== userId) {
      const { data: member } = await supabaseAdmin
        .from('project_members')
        .select('role')
        .eq('project_id', invite.project_id)
        .eq('user_id', userId)
        .single();

      if (!member || !['owner', 'admin'].includes(member.role)) {
        return res.status(403).json({ error: 'Only project owners or admins can revoke invites' });
      }
    }

    const { error } = await supabaseAdmin
      .from('invites')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('[DELETE /invites/:id]', err);
    res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

export default router;
