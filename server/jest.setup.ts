/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * Runs before any test module is loaded (see jest.config.js's `setupFiles`).
 * src/lib/supabase.ts throws at import time if SUPABASE_URL/SUPABASE_SERVICE_KEY
 * are missing, and nearly every route/middleware module transitively imports
 * it -- so unit tests that never actually touch a real database still need
 * placeholder values present before the first `require`. Real integration
 * tests that need a live database should set POSTGRES_URL_TEST /
 * SUPABASE_URL_LOCAL themselves (see backend/package.json's
 * `migrate:up:test` for the equivalent pattern already used in that
 * service) -- this file intentionally only unblocks import-time crashes,
 * it does not stand up a real backend.
 */
process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY ??= 'test-placeholder-service-key';
