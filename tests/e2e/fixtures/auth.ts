/**
 * E2E auth fixture — signs in before each test so the suite works
 * whether the app is running with Supabase (production) or without
 * it (admin-bypass / local dev).
 *
 * M-NEW-04 fix: without this, E2E tests fail in production because
 * every page redirects to the login screen when Supabase is enabled.
 *
 * Environment variables (set in CI or .env.test):
 *   E2E_BASE_URL          App URL  (default: http://localhost:5173)
 *   CI_SUPABASE_EMAIL     Test-user email   (optional — skip auth if unset)
 *   CI_SUPABASE_PASSWORD  Test-user password (optional — skip auth if unset)
 *   CI_ADMIN_BYPASS       Set to "true" to use admin@local / admin instead
 */
import { Page } from '@playwright/test';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

const SUPABASE_EMAIL    = process.env.CI_SUPABASE_EMAIL ?? '';
const SUPABASE_PASSWORD = process.env.CI_SUPABASE_PASSWORD ?? '';
const USE_ADMIN_BYPASS  = process.env.CI_ADMIN_BYPASS === 'true';

/**
 * Call this at the start of each test (or in a beforeEach) to ensure
 * the test user is signed in before interacting with the app.
 *
 * Local dev without Supabase: set CI_ADMIN_BYPASS=true.
 * CI with Supabase:           set CI_SUPABASE_EMAIL + CI_SUPABASE_PASSWORD.
 * If neither is set, this is a no-op (app has no login requirement).
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto(BASE_URL);

  const isLoginPage = await page.locator('input[autocomplete="email"]')
    .waitFor({ state: 'visible', timeout: 25_000 })
    .then(() => true)
    .catch(() => false);

  if (!isLoginPage) return;

  const email    = USE_ADMIN_BYPASS ? 'admin@local' : SUPABASE_EMAIL;
  const password = USE_ADMIN_BYPASS ? 'admin'       : SUPABASE_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'E2E auth: login page is visible but no credentials are configured.\n' +
      'Set CI_SUPABASE_EMAIL + CI_SUPABASE_PASSWORD, or CI_ADMIN_BYPASS=true.'
    );
  }

  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();

  // This SPA keeps the same URL while switching from login to dashboard.
  // Waiting for a /login URL transition can therefore succeed before auth finishes.
  await page.locator('input[autocomplete="email"]').waitFor({ state: 'hidden', timeout: 10_000 });
}
