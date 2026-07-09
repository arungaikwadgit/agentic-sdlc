/**
 * E2E auth fixture - signs in before each test so the suite works
 * whether the app is running with Supabase (production) or without
 * it (admin-bypass / local dev).
 *
 * Environment variables (set in CI or .env.test):
 *   E2E_BASE_URL          App URL  (default: http://localhost:5173)
 *   CI_SUPABASE_EMAIL     Test-user email   (optional - skip auth if unset)
 *   CI_SUPABASE_PASSWORD  Test-user password (optional - skip auth if unset)
 *   CI_ADMIN_BYPASS       Set to "true" to seed local admin-bypass mode
 */
import { expect, Page } from '@playwright/test';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

const SUPABASE_EMAIL    = process.env.CI_SUPABASE_EMAIL ?? '';
const SUPABASE_PASSWORD = process.env.CI_SUPABASE_PASSWORD ?? '';
const USE_ADMIN_BYPASS  = process.env.CI_ADMIN_BYPASS === 'true';

export async function signIn(page: Page): Promise<void> {
  if (USE_ADMIN_BYPASS) {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('__admin_mode', '1');
    });
    await page.goto(BASE_URL);
    await expect(page.getByRole('button', { name: /new project/i })).toBeVisible({ timeout: 15_000 });
    return;
  }

  await page.goto(BASE_URL);

  const emailInput = page.getByRole('textbox', { name: /email/i });
  const loginAppeared = await emailInput.waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (!loginAppeared) return;

  if (!SUPABASE_EMAIL || !SUPABASE_PASSWORD) {
    throw new Error(
      'E2E auth: login page is visible but no credentials are configured.\n' +
      'Set CI_SUPABASE_EMAIL + CI_SUPABASE_PASSWORD, or CI_ADMIN_BYPASS=true.'
    );
  }

  await emailInput.fill(SUPABASE_EMAIL);
  await page.locator('input[type="password"]').fill(SUPABASE_PASSWORD);
  await page.locator('button[type="submit"]').click();

  await expect(emailInput).toBeHidden({ timeout: 10_000 });
}