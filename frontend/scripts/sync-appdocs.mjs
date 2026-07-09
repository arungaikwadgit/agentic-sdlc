#!/usr/bin/env node
/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Copies repo-root AppDocs/ (the 72-document prompt library) into
 * frontend/public/AppDocs/ so Vite serves it as static assets, fetchable at
 * runtime by documentAgentService.ts via fetch('/AppDocs/<category>/<file>').
 *
 * Why a copy instead of referencing AppDocs/ directly: Vite's dev server and
 * production build only serve files under the project root (frontend/) plus
 * whatever's in publicDir (frontend/public/ by default) — a repo-root sibling
 * folder like AppDocs/ is invisible to a deployed build otherwise.
 *
 * Run manually after editing any AppDocs/*.md prompt file:
 *   npm run sync-appdocs
 *
 * Not yet wired into `predev`/`prebuild` automatically — see
 * docs/Document-Agent-Feature-Plan.md Section 9 for why (avoiding an unflagged
 * change to existing build behavior in the same change that adds this script).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const source = join(repoRoot, 'AppDocs');
const dest = join(__dirname, '..', 'public', 'AppDocs');

if (!existsSync(source)) {
  console.error(`[sync-appdocs] Source folder not found: ${source}`);
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });

console.log(`[sync-appdocs] Copied ${source} -> ${dest}`);
