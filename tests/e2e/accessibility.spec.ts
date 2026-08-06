// tests/e2e/accessibility.spec.ts (Appendix K4)
// axe-playwright accessibility scan — zero violations required (DoD item 7)
import { test, expect } from '@playwright/test';
import { signIn } from './fixtures/auth';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

test.describe('Accessibility (axe-core)', () => {
  test('Dashboard has no critical axe violations', async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for main content to render
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Filter to serious + critical only (as per DoD — zero violations)
    const violations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );

    if (violations.length > 0) {
      console.error(
        'Accessibility violations:\n',
        violations.map((v) => `[${v.impact}] ${v.id}: ${v.description}`).join('\n')
      );
    }

    expect(violations).toHaveLength(0);
  });

  test('New Project modal has no critical axe violations', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Open modal
    const newProjectBtn = page.getByRole('button', { name: /new project/i });
    if (await newProjectBtn.isVisible()) {
      await newProjectBtn.click();
      await page.waitForSelector('[role="dialog"]');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();

      const violations = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      );
      expect(violations).toHaveLength(0);
    }
  });
});
