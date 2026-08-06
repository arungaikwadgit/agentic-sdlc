#!/usr/bin/env node
/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Delete specific Supabase Auth users by email — for cleaning up stray test
 * accounts created while testing the invite-accept flow (e.g. a repeated
 * signUp() attempt failing with "User already registered" because an
 * earlier, incomplete test run already created the account).
 *
 * Usage:
 *   node scripts/cleanupInviteTestUsers.js email1@example.com email2@example.com
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env (already
 * present for other admin operations in this project). Uses Supabase's
 * Admin REST API with the service_role key, which bypasses RLS and can
 * delete ANY user — only pass emails you are certain are test accounts.
 * This script never bulk-deletes; it only removes the exact emails you
 * pass as arguments.
 */
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in backend/.env.');
  process.exit(1);
}

const targetEmails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
if (targetEmails.length === 0) {
  console.error('Usage: node scripts/cleanupInviteTestUsers.js email1@example.com [email2@example.com ...]');
  process.exit(1);
}

async function listAllUsers() {
  const users = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!res.ok) {
      throw new Error(`listUsers failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    const pageUsers = body.users ?? [];
    users.push(...pageUsers);
    if (pageUsers.length < perPage) break;
    page += 1;
  }
  return users;
}

async function deleteUser(id, email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!res.ok) {
    console.error(`  FAILED to delete ${email} (${id}): ${res.status} ${await res.text()}`);
    return false;
  }
  console.log(`  Deleted ${email} (${id})`);
  return true;
}

(async () => {
  console.log(`Looking up ${targetEmails.length} email(s) in ${SUPABASE_URL}...`);
  const allUsers = await listAllUsers();
  console.log(`Found ${allUsers.length} total user(s) in this Supabase project.`);

  let deletedCount = 0;
  for (const email of targetEmails) {
    const match = allUsers.find((u) => (u.email ?? '').toLowerCase() === email);
    if (!match) {
      console.log(`  No user found for ${email} — skipping.`);
      continue;
    }
    const ok = await deleteUser(match.id, email);
    if (ok) deletedCount += 1;
  }

  console.log(`Done. Deleted ${deletedCount} of ${targetEmails.length} requested user(s).`);
})().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
