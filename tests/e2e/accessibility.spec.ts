// tests/e2e/accessibility.spec.ts (Appendix K4)
// axe-playwright accessibility scan - zero serious/critical violations required
import { test, expect } from '@playwright/test';
import { signIn } from './fixtures/auth';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility (axe-core)', () => {
  test('Dashboard has no critical axe violations', async ({ page }) => {
    await signIn(page);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

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

  test('Simple Project form has no critical axe violations', async ({ page }) => {
    await signIn(page);
    await page.waitForLoadState('networkidle');

    const simpleBtn = page.getByRole('button', { name: /simple/i });
    if (await simpleBtn.isVisible()) {
      await simpleBtn.click();
      await expect(page.getByRole('heading', { name: /new project/i })).toBeVisible({ timeout: 10_000 });

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