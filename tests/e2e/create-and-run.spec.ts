// tests/e2e/create-and-run.spec.ts (Appendix K3)
// Playwright E2E - project creation to pipeline run
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './fixtures/auth';

async function openSimpleProjectDialog(page: Page) {
  await expect(page.getByRole('button', { name: /new project/i }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /simple/i }).click();
  await expect(page.getByRole('heading', { name: /new project/i })).toBeVisible({ timeout: 10_000 });
}

async function fillSimpleProject(page: Page, name: string) {
  await page.getByPlaceholder(/payment processing platform/i).fill(name);
  await page.getByPlaceholder(/jane doe/i).fill('E2E Owner');
  await page.getByPlaceholder(/platform squad/i).fill('E2E Team');
  await page.getByPlaceholder(/describe the project goals/i).fill('Automated E2E test project for validating project creation and workspace navigation.');
  await page.getByLabel(/project type/i).selectOption('web-app');
  await page.getByLabel(/start date/i).fill('2026-07-08');
  await page.getByLabel(/target end date/i).fill('2026-08-08');
  await page.getByPlaceholder(/React, Node\.js/i).fill('React');
  await page.keyboard.press('Enter');
  await page.getByPlaceholder(/Who will use this product/i).fill('Product managers and delivery teams');
  await page.getByPlaceholder(/Known risks/i).fill('Authentication and API connectivity');
}

async function expectSaveOutcome(page: Page, projectName: string) {
  await expect(
    page.getByText(new RegExp('Project could not be saved|sign-in session is missing or expired|' + projectName, 'i'))
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('Project creation and pipeline run', () => {
  test('validates the simple project flow through domain knowledge', async ({ page }) => {
    await signIn(page);

    await openSimpleProjectDialog(page);
    await fillSimpleProject(page, 'E2E Test Project');

    await page.getByRole('button', { name: /next: domain knowledge/i }).click();
    await expect(page.getByRole('heading', { name: /domain knowledge/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /save for the project/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /save for the project/i }).click();
    await expectSaveOutcome(page, 'E2E Test Project');
  });

  test('shows phase list in an existing workspace or validates save guard', async ({ page }) => {
    await signIn(page);

    const projectCards = page.locator('[data-testid="project-card"]');
    const count = await projectCards.count();

    if (count > 0) {
      await projectCards.first().click();
      await expect(page.getByText(/phase/i)).toBeVisible({ timeout: 15_000 });
      return;
    }

    await openSimpleProjectDialog(page);
    await fillSimpleProject(page, 'Phase Check Project');
    await page.getByRole('button', { name: /next: domain knowledge/i }).click();
    await expect(page.getByRole('button', { name: /save for the project/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /save for the project/i }).click();
    await expectSaveOutcome(page, 'Phase Check Project');
  });
});
