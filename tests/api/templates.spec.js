const { test, expect } = require('@playwright/test');

let createdId = null;

test.describe('Template API', () => {
  test('GET /api/templates returns array', async ({ request }) => {
    const res = await request.get('/api/templates');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('POST /api/templates creates a template', async ({ request }) => {
    const res = await request.post('/api/templates', {
      data: { name: 'Test Template', prompt: 'Hello world', dir: '/tmp' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('Test Template');
    expect(body.prompt).toBe('Hello world');
    expect(body.dir).toBe('/tmp');
    createdId = body.id;
  });

  test('POST /api/templates missing name returns 400', async ({ request }) => {
    const res = await request.post('/api/templates', {
      data: { prompt: 'Hello', dir: '/tmp' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/templates missing prompt returns 400', async ({ request }) => {
    const res = await request.post('/api/templates', {
      data: { name: 'No Prompt', dir: '/tmp' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/templates missing dir returns 400', async ({ request }) => {
    const res = await request.post('/api/templates', {
      data: { name: 'No Dir', prompt: 'Hello' },
    });
    expect(res.status()).toBe(400);
  });

  test('created template appears in GET /api/templates', async ({ request }) => {
    const res = await request.get('/api/templates');
    const body = await res.json();
    const found = body.find(t => t.id === createdId);
    expect(found).toBeDefined();
    expect(found.name).toBe('Test Template');
  });

  test('PUT /api/templates/:id updates template', async ({ request }) => {
    const res = await request.put(`/api/templates/${createdId}`, {
      data: { name: 'Updated Name', prompt: 'Updated prompt', dir: '/tmp' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.name).toBe('Updated Name');
    expect(body.prompt).toBe('Updated prompt');
  });

  test('PUT /api/templates/:nonexistent returns 404', async ({ request }) => {
    const res = await request.put('/api/templates/nonexistent-id-xyz', {
      data: { name: 'X', prompt: 'Y', dir: '/tmp' },
    });
    expect(res.status()).toBe(404);
  });

  test('updated values persist in GET /api/templates', async ({ request }) => {
    const res = await request.get('/api/templates');
    const body = await res.json();
    const found = body.find(t => t.id === createdId);
    expect(found.name).toBe('Updated Name');
  });

  test('DELETE /api/templates/:id returns 200', async ({ request }) => {
    const res = await request.delete(`/api/templates/${createdId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('deleted template no longer in GET /api/templates', async ({ request }) => {
    const res = await request.get('/api/templates');
    const body = await res.json();
    const found = body.find(t => t.id === createdId);
    expect(found).toBeUndefined();
  });

  test('DELETE /api/templates/:nonexistent returns 200 silently', async ({ request }) => {
    const res = await request.delete('/api/templates/nonexistent-id-xyz');
    expect(res.ok()).toBeTruthy();
  });
});
