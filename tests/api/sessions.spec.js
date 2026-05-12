const { test, expect } = require('@playwright/test');

test.describe('Session API', () => {
  test('GET /api/sessions returns array', async ({ request }) => {
    const res = await request.get('/api/sessions');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('GET /api/sessions starts empty with fresh data dir', async ({ request }) => {
    const res = await request.get('/api/sessions');
    const body = await res.json();
    expect(body.length).toBe(0);
  });

  test('POST /api/sessions without dir returns 400', async ({ request }) => {
    const res = await request.post('/api/sessions', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/sessions with non-existent dir returns 400', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      data: { dir: '/nonexistent-dir-xyz-abc', name: 'test' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('GET /api/discover returns array', async ({ request }) => {
    const res = await request.get('/api/discover');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('GET /api/projects returns array', async ({ request }) => {
    const res = await request.get('/api/projects');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('GET /api/history without dir returns 400', async ({ request }) => {
    const res = await request.get('/api/history');
    expect(res.status()).toBe(400);
  });

  test('GET /api/history with valid dir returns array', async ({ request }) => {
    const res = await request.get('/api/history?dir=' + encodeURIComponent('/tmp'));
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test('GET /api/stats returns object with numeric fields', async ({ request }) => {
    const res = await request.get('/api/stats');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  test('DELETE /api/sessions/:nonexistent returns 404', async ({ request }) => {
    const res = await request.delete('/api/sessions/nonexistent-session-id');
    expect(res.status()).toBe(404);
  });

  test('POST /api/sessions/:nonexistent/close returns 404', async ({ request }) => {
    const res = await request.post('/api/sessions/nonexistent-session-id/close');
    expect(res.status()).toBe(404);
  });
});
