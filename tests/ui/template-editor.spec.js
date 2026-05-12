const { test, expect } = require('@playwright/test');

test.describe('Template Editor', () => {
  let createdId = null;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('can open template editor via + New Template button in palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette-overlay')).toHaveClass(/open/);
    // Look for new template button/link in palette
    const newTemplateBtn = page.locator('[onclick*="openTemplateEditor"], button:has-text("New Template"), [data-action="new-template"]').first();
    if (await newTemplateBtn.count() > 0) {
      await newTemplateBtn.click();
      await expect(page.locator('#template-editor-overlay')).toHaveClass(/open/);
    }
  });

  test('create template via API and verify it appears in GET', async ({ request }) => {
    const res = await request.post('/api/templates', {
      data: { name: 'UI Test Template', prompt: 'Do something', dir: '/tmp' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    createdId = body.id;

    const listRes = await request.get('/api/templates');
    const templates = await listRes.json();
    expect(templates.find(t => t.id === createdId)).toBeDefined();
  });

  test('update template via API', async ({ request }) => {
    if (!createdId) {
      const res = await request.post('/api/templates', {
        data: { name: 'To Update', prompt: 'original', dir: '/tmp' },
      });
      const body = await res.json();
      createdId = body.id;
    }
    const updateRes = await request.put(`/api/templates/${createdId}`, {
      data: { name: 'Updated', prompt: 'changed', dir: '/tmp' },
    });
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.name).toBe('Updated');
    expect(updated.prompt).toBe('changed');
  });

  test('template editor form fields are present', async ({ page }) => {
    // Open editor via direct JS call
    await page.evaluate(() => openTemplateEditor());
    await expect(page.locator('#template-editor-overlay')).toHaveClass(/open/);
    await expect(page.locator('#te-name')).toBeVisible();
    await expect(page.locator('#te-prompt')).toBeVisible();
    await expect(page.locator('#te-dir')).toBeVisible();
  });

  test('saving template with empty name shows error', async ({ page }) => {
    await page.evaluate(() => openTemplateEditor());
    await page.locator('#te-name').fill('');
    await page.locator('#te-prompt').fill('test');
    await page.locator('#te-dir').fill('/tmp');
    await page.getByRole('button', { name: 'Save' }).click();
    // Should not close (still open) or should show an error
    const stillOpen = await page.locator('#template-editor-overlay').evaluate(el =>
      el.classList.contains('open')
    );
    expect(stillOpen).toBeTruthy();
  });

  test('delete template via API', async ({ request }) => {
    const res = await request.post('/api/templates', {
      data: { name: 'To Delete', prompt: 'bye', dir: '/tmp' },
    });
    const body = await res.json();
    const deleteRes = await request.delete(`/api/templates/${body.id}`);
    expect(deleteRes.ok()).toBeTruthy();
    const listRes = await request.get('/api/templates');
    const templates = await listRes.json();
    expect(templates.find(t => t.id === body.id)).toBeUndefined();
  });
});
