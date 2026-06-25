/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Current user identity — stored in IndexedDB settings.
 *
 * A "user" in this app is identified by their email address.
 * - The project creator is implicitly the owner (no stored identity needed for them,
 *   but we store one so the dashboard can distinguish their projects from invited ones).
 * - Invite acceptors: after clicking the magic link and accepting, their email +
 *   the accepted projectId are persisted here so the dashboard can filter correctly.
 *
 * If no identity is stored (fresh install, or existing user before this feature),
 * ALL projects are shown — backward-compatible.
 */

import { db } from '@/db/database';

export interface UserIdentity {
  /** Email address — primary identifier */
  email: string;
  /** Display name (optional) */
  name?: string;
  /**
   * Projects this user was explicitly invited to and has accepted.
   * Distinct from owned projects (which are tagged with ownerId on the project itself).
   */
  acceptedProjectIds: string[];
}

const SETTINGS_KEY = 'user:identity';

export async function getCurrentUser(): Promise<UserIdentity | null> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) return null;
  return row.value as UserIdentity;
}

export async function setCurrentUser(identity: UserIdentity): Promise<void> {
  await db.settings.put({ key: SETTINGS_KEY, value: identity });
}

/**
 * Record that the current user has accepted an invite to a project.
 * Creates / updates the identity entry.
 */
export async function recordAcceptedInvite(
  email: string,
  name: string | undefined,
  projectId: string,
): Promise<void> {
  const existing = await getCurrentUser();
  const ids = existing?.acceptedProjectIds ?? [];
  if (!ids.includes(projectId)) ids.push(projectId);
  await setCurrentUser({ email: email.toLowerCase(), name, acceptedProjectIds: ids });
}

/**
 * Mark the current user as the owner of a project.
 * This is called when a project is created.
 * If no identity exists yet, one is bootstrapped with a placeholder email.
 */
export async function ensureOwnerIdentity(email?: string): Promise<string | null> {
  const existing = await getCurrentUser();
  if (existing) return existing.email;
  if (!email) return null;   // can't create identity without an email
  await setCurrentUser({ email: email.toLowerCase(), acceptedProjectIds: [] });
  return email.toLowerCase();
}

/**
 * Clear identity (log out / switch user).
 */
export async function clearCurrentUser(): Promise<void> {
  await db.settings.delete(SETTINGS_KEY);
}
