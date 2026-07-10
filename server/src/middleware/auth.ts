/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';

const ADMIN_BYPASS_BEARER = 'admin-local-bypass-token';
const DEV_BYPASS_USER_ID = '__admin_local__';
const DEV_BYPASS_EMAIL = (
  (process.env.ADMIN_EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((e) => e.trim())
    .find(Boolean) ??
  process.env.ADMIN_EMAIL ??
  process.env.VITE_ADMIN_EMAIL ??
  'admin@local'
).toLowerCase();

export interface AuthUser {
  id: string;
  email: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Verifies the Supabase JWT from the Authorization header.
 * In local development only, also accepts the admin-bypass bearer token so
 * frontend admin-mode can exercise the real /api/projects server routes.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (process.env.NODE_ENV !== 'production' && authHeader === ('Bearer ' + ADMIN_BYPASS_BEARER)) {
    req.user = {
      id: DEV_BYPASS_USER_ID,
      email: DEV_BYPASS_EMAIL,
      role: 'authenticated',
    };
    next();
    return;
  }

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.user = {
      id: data.user.id,
      email: data.user.email ?? '',
      role: data.user.role,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Token verification failed' });
  }
}

/**
 * App-wide system administrators - distinct from `project_members.role`
 * (which is per-project) and from the frontend's local-dev-only `isAdminMode()`
 * bypass. Configure via the ADMIN_EMAIL_ALLOWLIST env var (comma-separated,
 * case-insensitive) on this service in Railway. If unset, no user is treated
 * as an app admin and admin-gated routes (e.g. project delete/restore) will
 * 403 for everyone until it's configured.
 */
const ADMIN_EMAIL_ALLOWLIST = new Set(
  (process.env.ADMIN_EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export function isAppAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAIL_ALLOWLIST.has(email.toLowerCase());
}

/** Requires the authenticated user's email to be in ADMIN_EMAIL_ALLOWLIST. */
export function requireAppAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isAppAdmin(req.user?.email)) {
    next();
    return;
  }
  res.status(403).json({ error: 'This action requires app administrator access.' });
}

/**
 * Check that the current user has one of the allowed roles on a project.
 * Usage: requireProjectRole('owner', 'admin')
 */
export function requireProjectRole(...allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    const projectId = req.params.projectId || req.params.id;

    if (!userId || !projectId) {
      res.status(400).json({ error: 'Missing user or project context' });
      return;
    }

    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();

    if (project?.owner_id === userId) {
      next();
      return;
    }

    const { data: member } = await supabaseAdmin
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();

    if (!member || !allowedRoles.includes(member.role)) {
      res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
      });
      return;
    }

    next();
  };
}
