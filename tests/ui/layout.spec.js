const { test, expect } = require('@playwright/test');

test.describe('Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page title is Claude Code Control', async ({ page }) => {
    await expect(page).toHaveTitle(/Claude Code Control/);
  });

  test('sidebar shows Sessions heading', async ({ page }) => {
    await expect(page.locator('.sidebar-header span')).toHaveText('Sessions');
  });

  test('+ New button is visible', async ({ page }) => {
    await expect(page.locator('.btn-new')).toBeVisible();
  });

  test('search sessions input is visible', async ({ page }) => {
    await expect(page.locator('#session-search')).toBeVisible();
  });

  test('app logo/title is visible', async ({ page }) => {
    await expect(page.getByText('Claude Code Control')).toBeVisible();
  });

  test('empty state is shown when no sessions', async ({ page }) => {
    const terminal = page.locator('#terminal-header');
    await expect(terminal).not.toBeVisible();
  });

  test('page loads without JavaScript errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });
});
