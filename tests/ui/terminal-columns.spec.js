const { test, expect } = require('@playwright/test');

test.describe('Terminal column safety', () => {
  test('terminal container has a minimum width to prevent tiny column counts', async ({ page }) => {
    await page.goto('/');
    // #terminal-container must have min-width so fitAddon.fit() never calculates
    // fewer than ~25 columns regardless of window size or panel layout.
    const minWidthPx = await page.locator('#terminal-container').evaluate(el =>
      parseInt(getComputedStyle(el).minWidth) || 0
    );
    expect(minWidthPx).toBeGreaterThanOrEqual(200);
  });

  test('narrow viewport does not shrink terminal container below minimum', async ({ page }) => {
    await page.goto('/');
    // Set a very narrow viewport (narrower than sidebar + min terminal width)
    await page.setViewportSize({ width: 400, height: 600 });
    // Terminal container must still be at least min-width wide
    const width = await page.locator('#terminal-container').evaluate(el => el.offsetWidth);
    expect(width).toBeGreaterThanOrEqual(200);
  });
});
