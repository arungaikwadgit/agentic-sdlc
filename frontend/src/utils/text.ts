/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

/** Up to 2 uppercase initials from a person's name, e.g. "Jane Doe" -> "JD". */
export function initials(name: string) {
  return name.split(' ').map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}
