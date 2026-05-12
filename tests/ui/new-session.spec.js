const { test, expect } = require('@playwright/test');

test.describe('New Session Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('clicking + New opens the modal', async ({ page }) => {
    await page.locator('.btn-new').click();
    await expect(page.locator('#modal-overlay')).toHaveClass(/open/);
  });

  test('modal has directory input', async ({ page }) => {
    await page.locator('.btn-new').click();
    await expect(page.locator('#input-dir')).toBeVisible();
  });

  test('modal has session name input', async ({ page }) => {
    await page.locator('.btn-new').click();
    await expect(page.locator('#input-name')).toBeVisible();
  });

  test('modal has browse folder button', async ({ page }) => {
    await page.locator('.btn-new').click();
    await expect(page.locator('.btn-browse')).toBeVisible();
  });

  test('Cancel button closes the modal', async ({ page }) => {
    await page.locator('.btn-new').click();
    await page.locator('#modal-overlay .btn-cancel').click();
    await expect(page.locator('#modal-overlay')).not.toHaveClass(/open/);
  });

  test('submitting with empty dir shows error', async ({ page }) => {
    await page.locator('.btn-new').click();
    await page.locator('#input-dir').fill('');
    await page.locator('#modal-overlay .btn-primary[onclick="createSession()"]').click();
    await expect(page.locator('#error-msg')).toBeVisible();
  });

  test('submitting with non-existent dir shows error', async ({ page }) => {
    await page.locator('.btn-new').click();
    await page.locator('#input-dir').fill('/nonexistent-dir-xyz-abc');
    await page.locator('#modal-overlay .btn-primary[onclick="createSession()"]').click();
    await expect(page.locator('#error-msg')).toBeVisible();
  });

  test('browse button opens directory browser modal', async ({ page }) => {
    await page.route('/api/pick-folder', route =>
      route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: 'not supported' }) })
    );
    await page.locator('.btn-new').click();
    await page.locator('.btn-browse').click();
    await expect(page.locator('#browse-modal-overlay')).toBeVisible();
  });

  test('directory browser appears on top of session modal', async ({ page }) => {
    await page.route('/api/pick-folder', route =>
      route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: 'not supported' }) })
    );
    await page.locator('.btn-new').click();
    await page.locator('.btn-browse').click();
    await expect(page.locator('#browse-modal-overlay')).toBeVisible();

    const browseZ = await page.locator('#browse-modal-overlay').evaluate(el =>
      parseInt(window.getComputedStyle(el).zIndex)
    );
    const sessionZ = await page.locator('#modal-overlay').evaluate(el =>
      parseInt(window.getComputedStyle(el).zIndex)
    );
    expect(browseZ).toBeGreaterThan(sessionZ);
  });
});
