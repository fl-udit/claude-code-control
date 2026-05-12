const { test, expect } = require('@playwright/test');

async function openBrowser(page) {
  // Mock native picker so it falls back to the browse modal in headless tests
  await page.route('/api/pick-folder', route =>
    route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: 'not supported' }) })
  );
  await page.goto('/');
  await page.locator('.btn-new').click();
  await page.locator('.btn-browse').click();
  await expect(page.locator('#browse-modal-overlay')).toBeVisible();
}

test.describe('Directory Browser Modal', () => {
  test('shows a path in the path display', async ({ page }) => {
    await openBrowser(page);
    const pathText = await page.locator('#browse-path').textContent();
    expect(pathText.trim().length).toBeGreaterThan(0);
  });

  test('lists folder items', async ({ page }) => {
    await openBrowser(page);
    await page.waitForSelector('.browse-item');
    const items = page.locator('.browse-item');
    expect(await items.count()).toBeGreaterThan(0);
  });

  test('clicking a folder navigates into it', async ({ page }) => {
    await openBrowser(page);
    await page.waitForSelector('.browse-item');
    const before = await page.locator('#browse-path').textContent();
    await page.locator('.browse-item').first().click();
    await page.waitForFunction(
      (prev) => document.getElementById('browse-path')?.textContent !== prev,
      before,
      { timeout: 3000 }
    );
    const after = await page.locator('#browse-path').textContent();
    expect(after.trim()).not.toBe(before.trim());
  });

  test('Cancel closes modal without changing input', async ({ page }) => {
    await openBrowser(page);
    const inputBefore = await page.locator('#input-dir').inputValue();
    await page.locator('#browse-modal-overlay .btn-cancel').click();
    await expect(page.locator('#browse-modal-overlay')).not.toBeVisible();
    const inputAfter = await page.locator('#input-dir').inputValue();
    expect(inputAfter).toBe(inputBefore);
  });

  test('Select button fills the directory input with current path', async ({ page }) => {
    await openBrowser(page);
    // Wait for browseTo() to complete — items appear only after the fetch resolves
    await page.waitForSelector('.browse-item');
    const browsedPath = await page.locator('#browse-path').textContent();
    await page.locator('#browse-modal-overlay .btn-primary').click();
    await expect(page.locator('#browse-modal-overlay')).not.toBeVisible();
    const inputValue = await page.locator('#input-dir').inputValue();
    expect(inputValue).toBe(browsedPath.trim());
  });

  test('manual path input overrides browse selection', async ({ page }) => {
    await openBrowser(page);
    await page.locator('#browse-manual').fill('/tmp');
    await page.locator('#browse-modal-overlay .btn-primary').click();
    const inputValue = await page.locator('#input-dir').inputValue();
    expect(inputValue).toBe('/tmp');
  });

  test('modal z-index is above 130 (above template editor)', async ({ page }) => {
    await openBrowser(page);
    const zIndex = await page.locator('#browse-modal-overlay').evaluate(el =>
      parseInt(window.getComputedStyle(el).zIndex)
    );
    expect(zIndex).toBeGreaterThan(130);
  });

  test('modal is position fixed', async ({ page }) => {
    await openBrowser(page);
    const position = await page.locator('#browse-modal-overlay').evaluate(el =>
      window.getComputedStyle(el).position
    );
    expect(position).toBe('fixed');
  });
});
