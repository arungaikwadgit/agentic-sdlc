/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

/** Up to 2 uppercase initials from a person's name, e.g. "Jane Doe" -> "JD". */
export function initials(name: string) {
  return name.split(' ').map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

/**
 * Display-layer humanization for names derived from an email local-part
 * (2026-07-17). No account in this app ever collects a real "full name" at
 * signup — TeamMember.name for a project's creator is seeded directly from
 * `email.split('@')[0]` (see server/src/routes/projects.ts), so the
 * "Created by" column and similar UI show raw slugs like "arun.gaikwad"
 * instead of "Arun Gaikwad". This is a cosmetic transform only — it does
 * NOT fabricate a real name, it just formats the slug a human would
 * recognize as one: split on ".", "_", "-", title-case each part.
 * "arun.gaikwad" -> "Arun Gaikwad"; "preeti.hingorani" -> "Preeti Hingorani".
 * Already-proper names ("Jane Doe") pass through unchanged (no separators
 * to split on, first letter already capitalized).
 */
export function humanizeName(raw?: string | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  // Already looks like a normal name (contains a space, or has no
  // slug-style separators at all) — leave it as-is rather than risk
  // mangling a real name that happens to already be well-formed.
  if (!/[._-]/.test(value)) return value;
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
