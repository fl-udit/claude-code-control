const { test, expect } = require('@playwright/test');

test.describe('Template Palette (Cmd+K)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Meta+K opens the palette overlay', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette-overlay')).toHaveClass(/open/);
  });

  test('Escape closes the palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette-overlay')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette-overlay')).not.toHaveClass(/open/);
  });

  test('palette search input is focused when opened', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette-search')).toBeFocused();
  });

  test('typing in palette filters results', async ({ page }) => {
    // Create a template first via API
    await page.request.post('/api/templates', {
      data: { name: 'FilterMe XYZ', prompt: 'test', dir: '/tmp' },
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Meta+k');
    await page.locator('#palette-search').fill('FilterMe');
    const rows = page.locator('.palette-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Typing something that matches nothing
    await page.locator('#palette-search').fill('zzznomatch999');
    const emptyCount = await page.locator('.palette-row:visible').count();
    expect(emptyCount).toBe(0);
  });

  test('second Meta+K press closes the palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette-overlay')).toHaveClass(/open/);
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette-overlay')).not.toHaveClass(/open/);
  });
});
