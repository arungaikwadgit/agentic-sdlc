/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { expect, test } from '@playwright/test';
import { signIn } from './fixtures/auth';

test('persists the selected dashboard view across authenticated sessions', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);

  const tableView = page.getByRole('button', { name: 'Table view' });
  await expect(tableView).toBeVisible();

  if (await tableView.getAttribute('aria-pressed') === 'true') {
    const resetResponse = page.waitForResponse((response) =>
      response.url().includes('/api/user-preferences/dashboard-view') &&
      response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Tiles view' }).click();
    expect((await resetResponse).status()).toBe(200);
  }

  const saveResponse = page.waitForResponse((response) =>
    response.url().includes('/api/user-preferences/dashboard-view') &&
    response.request().method() === 'PUT',
  );
  await tableView.click();
  await expect(tableView).toHaveAttribute('aria-pressed', 'true');
  expect((await saveResponse).status()).toBe(200);

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.locator('input[autocomplete="email"]')).toBeVisible();

  await signIn(page);
  await expect(page.getByRole('button', { name: 'Table view' }))
    .toHaveAttribute('aria-pressed', 'true');
});
