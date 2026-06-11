// tests/e2e/create-and-run.spec.ts (Appendix K3)
// Playwright E2E — project creation → pipeline run
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

test.describe('Project creation and pipeline run', () => {
  test('creates a project and starts the pipeline', async ({ page }) => {
    await page.goto(BASE_URL);

    // Dashboard should render
    await expect(page.getByRole('heading', { name: /agentic sdlc/i })).toBeVisible();

    // Open new project modal
    await page.getByRole('button', { name: /new project/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Fill in project details
    await page.getByLabel(/project name/i).fill('E2E Test Project');
    await page.getByLabel(/description/i).fill('An automated E2E test project for Playwright.');

    // Submit
    await page.getByRole('button', { name: /create/i }).click();

    // Should navigate to the project workspace
    await expect(page.getByText('E2E Test Project')).toBeVisible({ timeout: 5000 });

    // Start pipeline button should be present
    await expect(page.getByRole('button', { name: /start pipeline/i })).toBeVisible();
  });

  test('shows phase list in project workspace', async ({ page }) => {
    await page.goto(BASE_URL);

    // If a project already exists from prior test (shared storage), open it
    const projectCards = page.locator('[data-testid="project-card"]');
    const count = await projectCards.count();

    if (count > 0) {
      await projectCards.first().click();
      await expect(page.getByText(/phase/i)).toBeVisible({ timeout: 3000 });
    } else {
      // Create one first
      await page.getByRole('button', { name: /new project/i }).click();
      await page.getByLabel(/project name/i).fill('Phase Check Project');
      await page.getByLabel(/description/i).fill('Phase list check.');
      await page.getByRole('button', { name: /create/i }).click();
      await expect(page.getByText(/phase/i)).toBeVisible({ timeout: 5000 });
    }
  });
});
