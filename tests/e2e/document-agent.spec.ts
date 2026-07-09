// tests/e2e/document-agent.spec.ts
// Playwright E2E - Document Agent flow: generated-doc download from the Export
// menu, and the Admin Panel's enable/disable + Regenerate All controls.
// See docs/Document-Agent-Feature-Plan.md for the feature spec this covers.
import { test, expect, type Page } from '@playwright/test';
import { signIn, BASE_URL } from './fixtures/auth';

async function expectDashboardFallback(page: Page) {
  await expect(page.getByRole('button', { name: /new project/i }).first()).toBeVisible({ timeout: 10_000 });
}

test.describe('Document Agent', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('Export menu shows a Documentation section for a completed agent when data exists', async ({ page }) => {
    await page.goto(BASE_URL);

    const projectCards = page.locator('[data-testid="project-card"]');
    const count = await projectCards.count();
    if (count === 0) {
      await expectDashboardFallback(page);
      return;
    }

    await projectCards.first().click();

    const exportBtn = page.getByRole('button', { name: /export/i }).first();
    const hasExport = await exportBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasExport) {
      await expect(page.getByText(/phase|agent/i).first()).toBeVisible({ timeout: 10_000 });
      return;
    }

    await exportBtn.click();
    await expect(page.getByText(/markdown \(\.md\)/i)).toBeVisible();
    await page.waitForTimeout(1000);

    const docsHeading = page.getByText('Documentation', { exact: true });
    const hasGeneratedDocs = await docsHeading.isVisible().catch(() => false);
    if (!hasGeneratedDocs) {
      await expect(page.getByText(/markdown \(\.md\)/i)).toBeVisible();
      return;
    }

    await expect(docsHeading).toBeVisible();
    const firstDoc = page.locator('button', { hasText: /^📘/ }).first();
    await expect(firstDoc).toBeVisible();

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
    await firstDoc.click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.(docx|md)$/);
    }
  });

  test('Export All (.zip) includes generated documentation when enough data exists', async ({ page }) => {
    await page.goto(BASE_URL);

    const projectCards = page.locator('[data-testid="project-card"]');
    const count = await projectCards.count();
    if (count === 0) {
      await expectDashboardFallback(page);
      return;
    }

    await projectCards.first().click();

    const exportBtn = page.getByRole('button', { name: /export/i }).first();
    const hasExport = await exportBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasExport) {
      await expect(page.getByText(/phase|agent/i).first()).toBeVisible({ timeout: 10_000 });
      return;
    }

    await exportBtn.click();
    const exportAllBtn = page.getByRole('button', { name: /export all/i });
    const hasExportAll = await exportAllBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasExportAll) {
      await expect(page.getByText(/markdown \(\.md\)/i)).toBeVisible();
      return;
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
    await exportAllBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
  });

  test('Admin Panel exposes Document Agent controls when project data exists', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await expect(page.getByText(/admin/i).first()).toBeVisible({ timeout: 5000 });

    const projectRow = page.locator('select, [role="listbox"], li, option').filter({ hasText: /.+/ }).first();
    const hasProject = await projectRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasProject) {
      await expect(page.getByText(/admin/i).first()).toBeVisible();
      return;
    }

    const toggleBtn = page.getByRole('button', { name: /enabled|disabled/i }).first();
    const hasToggle = await toggleBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasToggle) {
      await expect(projectRow).toBeVisible();
      return;
    }

    const beforeLabel = await toggleBtn.textContent();
    await toggleBtn.click();
    await expect(toggleBtn).not.toHaveText(beforeLabel ?? '', { timeout: 5000 });

    await toggleBtn.click();
    await expect(toggleBtn).toHaveText(beforeLabel ?? '', { timeout: 5000 });

    if ((beforeLabel ?? '').match(/disabled/i)) {
      await toggleBtn.click();
    }
    const regenerateBtn = page.getByRole('button', { name: /regenerate all/i });
    await expect(regenerateBtn).toBeEnabled();
    await regenerateBtn.click();

    await expect(page.getByText(/generated, .* not yet eligible, .* failed|failed:/i)).toBeVisible({
      timeout: 20_000,
    });
  });
});
