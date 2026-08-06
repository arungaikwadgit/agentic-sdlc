#!/usr/bin/env node
/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * One-off diagnostic: prints the actual state of `projects` and
 * `team_members` in the configured Postgres, plus the Supabase Auth UIDs for
 * a couple of emails, so a "invitee accepted but doesn't see the project" /
 * "admin dashboard shows no projects" report can be root-caused from real
 * data instead of guessing. Read-only — makes no changes.
 *
 * Usage:
 *   node scripts/diagnoseProjectVisibility.js [email1 email2 ...]
 *
 * Requires POSTGRES_URL_LOCAL/POSTGRES_URL and SUPABASE_URL/SUPABASE_SERVICE_KEY
 * in backend/.env (all already present for other operations in this project).
 */
require('dotenv').config();
const { Pool } = require('pg');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const dbConnectionString = process.env.POSTGRES_URL_LOCAL || process.env.POSTGRES_URL;

const targetEmails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
if (targetEmails.length === 0) {
  targetEmails.push('arun.gaikwad@gmail.com');
}

function isLocalHost(connStr) {
  const host = (connStr ?? '').replace(/^[a-z]+:\/\/[^@]*@/, '').split(/[:/]/)[0];
  return /^(localhost|127\.0\.0\.1|db)$/i.test(host);
}

async function main() {
  if (!dbConnectionString) {
    console.error('No POSTGRES_URL_LOCAL / POSTGRES_URL configured.');
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY.');
    process.exit(1);
  }

  console.log('=== Supabase Auth users matching:', targetEmails.join(', '), '===');
  let page = 1;
  const matchedUsers = [];
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok) { console.error('listUsers failed:', res.status, await res.text()); break; }
    const body = await res.json();
    const users = body.users ?? [];
    for (const u of users) {
      if (targetEmails.includes((u.email ?? '').toLowerCase())) {
        matchedUsers.push({ id: u.id, email: u.email });
      }
    }
    if (users.length < 200) break;
    page += 1;
  }
  if (matchedUsers.length === 0) {
    console.log('  (no matching Supabase Auth users found)');
  } else {
    matchedUsers.forEach((u) => console.log(`  ${u.email} -> user_id=${u.id}`));
  }

  console.log('\n=== Postgres (' + (isLocalHost(dbConnectionString) ? 'local' : 'remote/Supabase') + ') ===');
  const pool = new Pool({
    connectionString: dbConnectionString,
    ssl: isLocalHost(dbConnectionString) ? false : { rejectUnauthorized: false },
  });

  try {
    const projects = await pool.query('SELECT id, name, owner_id, created_at FROM projects ORDER BY created_at DESC LIMIT 20');
    console.log('\n-- projects (most recent 20) --');
    if (projects.rows.length === 0) console.log('  (no rows)');
    projects.rows.forEach((p) => console.log(`  id=${p.id} name=${JSON.stringify(p.name)} owner_id=${p.owner_id} created_at=${p.created_at}`));

    const members = await pool.query('SELECT project_id, user_id, email, app_role, invite_status, accepted_at FROM team_members ORDER BY invited_at DESC LIMIT 40');
    console.log('\n-- team_members (most recent 40) --');
    if (members.rows.length === 0) console.log('  (no rows)');
    members.rows.forEach((m) => console.log(`  project_id=${m.project_id} user_id=${m.user_id} email=${m.email} app_role=${m.app_role} invite_status=${m.invite_status} accepted_at=${m.accepted_at}`));
  } catch (err) {
    console.error('Query failed:', err.message);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
