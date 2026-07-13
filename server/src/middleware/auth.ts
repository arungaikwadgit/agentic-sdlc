/**
 * 2026 Arun Gaikwad. All rights reserved.
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
  /** Supabase user_metadata.is_invited_user -- set (see
   * backend/src/proxy.js's provisionInviteeAccount) only on accounts that
   * were created purely because someone invited them, never on an organic
   * self-signup. Used to scope invited-only users to just the project(s)
   * they're a member of (no project creation, no visibility into anyone
   * else's projects). Undefined for the dev admin-bypass session. */
  isInvitedOnly?: boolean;
}

let cachedDevBypassResolvedId: string | null = null;

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

async function resolveDevBypassUserId(): Promise<string> {
  if (process.env.ADMIN_EMAIL_USER_ID?.trim()) {
    return process.env.ADMIN_EMAIL_USER_ID.trim();
  }

  if (cachedDevBypassResolvedId) {
    return cachedDevBypassResolvedId;
  }

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.warn('[auth] Failed to resolve dev bypass user id from Supabase:', error.message);
      break;
    }

    const users = data?.users ?? [];
    const matched = users.find((user) => (user.email ?? '').toLowerCase() === DEV_BYPASS_EMAIL);
    if (matched?.id) {
      cachedDevBypassResolvedId = matched.id;
      return matched.id;
    }

    if (users.length < perPage) {
      break;
    }
    page += 1;
  }

  console.warn(
    '[auth] Falling back to synthetic dev bypass user id because no Supabase auth user matched ADMIN_EMAIL_ALLOWLIST / ADMIN_EMAIL / VITE_ADMIN_EMAIL:',
    DEV_BYPASS_EMAIL,
  );
  return DEV_BYPASS_USER_ID;
}

/**
 * Verifies the Supabase JWT from the Authorization header.
 * In local development only, also accepts the admin-bypass bearer token so
 * frontend admin-mode can exercise the real /api/projects server routes.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (process.env.NODE_ENV !== 'production' && authHeader === ('Bearer ' + ADMIN_BYPASS_BEARER)) {
    const resolvedId = await resolveDevBypassUserId();
    req.user = {
      id: resolvedId,
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
      isInvitedOnly: data.user.user_metadata?.is_invited_user === true,
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
 * case-insensitive) on this service. If unset, no user is treated as an app admin.
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
 * Usage: requireProjectRole('project_owner', 'editor')
 *
 * team_members is the ONE place project-level roles live (see
 * backend/migrations/006_consolidate_team_members.sql) -- this used to check
 * a separate project_members table that nothing else in the app wrote to
 * consistently, which is what let an accepted invitee pass team_members-based
 * RLS but still get "Project not found" from this Express-layer check (or
 * vice versa). There is exactly one membership table now.
 */
export function requireProjectRole(...allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    const projectId = req.params.projectId || req.params.id;

    if (!userId || !projectId) {
      res.status(400).json({ error: 'Missing user or project context' });
      return;
    }

    if (isAppAdmin(req.user?.email)) {
      next();
      return;
    }

    const { data: member } = await supabaseAdmin
      .from('team_members')
      .select('app_role, invite_status')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .eq('invite_status', 'accepted')
      .maybeSingle();

    if (!member || !allowedRoles.includes(member.app_role)) {
      res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
      });
      return;
    }

    next();
  };
}
