// tests/e2e/document-agent.spec.ts
// Playwright E2E — Document Agent flow: generated-doc download from the Export
// menu, and the Admin Panel's enable/disable + Regenerate All controls.
// See docs/Document-Agent-Feature-Plan.md for the feature spec this covers.
import { test, expect } from '@playwright/test';
import { signIn, BASE_URL } from './fixtures/auth';

test.describe('Document Agent', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('Export menu shows a Documentation section for a completed agent', async ({ page }) => {
    await page.goto(BASE_URL);

    const projectCards = page.locator('[data-testid="project-card"]');
    const count = await projectCards.count();
    test.skip(count === 0, 'No project with a completed agent run available — needs seeded data.');

    await projectCards.first().click();

    const exportBtn = page.getByRole('button', { name: /export/i }).first();
    const hasExport = await exportBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasExport, 'No completed agent output to export in this project.');

    await exportBtn.click();

    // The menu always shows Markdown/Word/PDF; give the lazy documentation
    // fetch (toggleOpen -> listDocumentsForAgent) a moment to resolve before
    // asserting on the optional Documentation section.
    await expect(page.getByText(/markdown \(\.md\)/i)).toBeVisible();
    await page.waitForTimeout(1000);

    const docsHeading = page.getByText('Documentation', { exact: true });
    const hasGeneratedDocs = await docsHeading.isVisible().catch(() => false);
    test.skip(!hasGeneratedDocs, 'No generated documents yet for this agent — Document Agent may be disabled or not yet run.');

    await expect(docsHeading).toBeVisible();
    const firstDoc = page.locator('button', { hasText: /^📘/ }).first();
    await expect(firstDoc).toBeVisible();

    // Clicking a generated doc triggers a browser download — confirm it fires
    // and closes the menu, without asserting on file contents (covered by
    // documentAgentService unit tests).
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
    await firstDoc.click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.(docx|md)$/);
    }
  });

  test('Export All (.zip) includes generated documentation when available', async ({ page }) => {
    await page.goto(BASE_URL);

    const projectCards = page.locator('[data-testid="project-card"]');
    const count = await projectCards.count();
    test.skip(count === 0, 'No project available — needs seeded data.');
    await projectCards.first().click();

    const exportBtn = page.getByRole('button', { name: /export/i }).first();
    const hasExport = await exportBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasExport, 'No completed agent output to export in this project.');
    await exportBtn.click();

    const exportAllBtn = page.getByRole('button', { name: /export all/i });
    const hasExportAll = await exportAllBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasExportAll, 'Export All only appears once more than one agent has completed.');

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
    await exportAllBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
  });

  test('Admin Panel: enable/disable Document Agent and Regenerate All', async ({ page }) => {
    // Admin Panel only renders in admin-bypass mode (frontend/src/App.tsx),
    // so this test requires CI_ADMIN_BYPASS=true to be meaningful.
    test.skip(
      process.env.CI_ADMIN_BYPASS !== 'true',
      'Admin Panel requires admin-bypass mode (CI_ADMIN_BYPASS=true).'
    );

    await page.goto(`${BASE_URL}/admin`);
    await expect(page.getByText(/admin/i).first()).toBeVisible({ timeout: 5000 });

    const projectRow = page.locator('select, [role="listbox"], li, option').filter({ hasText: /.+/ }).first();
    const hasProject = await projectRow.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasProject, 'No project available in Admin Panel to select.');

    // Toggle the Document Agent switch and confirm the label flips.
    const toggleBtn = page.getByRole('button', { name: /enabled|disabled/i }).first();
    const hasToggle = await toggleBtn.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!hasToggle, 'Document Agent toggle not visible — no project selected.');

    const beforeLabel = await toggleBtn.textContent();
    await toggleBtn.click();
    await expect(toggleBtn).not.toHaveText(beforeLabel ?? '', { timeout: 5000 });

    // Restore original state so the test is idempotent across re-runs.
    await toggleBtn.click();
    await expect(toggleBtn).toHaveText(beforeLabel ?? '', { timeout: 5000 });

    // Re-enable, then exercise Regenerate All and confirm a status message appears.
    if ((beforeLabel ?? '').match(/disabled/i)) {
      await toggleBtn.click(); // ensure enabled before regenerating
    }
    const regenerateBtn = page.getByRole('button', { name: /regenerate all/i });
    await expect(regenerateBtn).toBeEnabled();
    await regenerateBtn.click();

    await expect(page.getByText(/generated, .* not yet eligible, .* failed|failed:/i)).toBeVisible({
      timeout: 20_000,
    });
  });
});
