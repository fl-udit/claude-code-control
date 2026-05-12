const { test, expect } = require('@playwright/test');
const os = require('os');
const path = require('path');

test.describe('GET /api/browse', () => {
  test('returns 200 with path and dirs array', async ({ request }) => {
    const res = await request.get('/api/browse');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('path');
    expect(Array.isArray(body.dirs)).toBeTruthy();
  });

  test('defaults to home directory when no path given', async ({ request }) => {
    const res = await request.get('/api/browse');
    const body = await res.json();
    expect(body.path).toBe(os.homedir());
  });

  test('returns entries for /tmp', async ({ request }) => {
    const res = await request.get('/api/browse?path=' + encodeURIComponent('/tmp'));
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.path).toBe('/tmp');
    expect(Array.isArray(body.dirs)).toBeTruthy();
  });

  test('returns 400 for non-existent path', async ({ request }) => {
    const res = await request.get('/api/browse?path=' + encodeURIComponent('/nonexistent-xyz-abc-999'));
    expect(res.status()).toBe(400);
  });

  test('dirs are sorted alphabetically', async ({ request }) => {
    const res = await request.get('/api/browse?path=' + encodeURIComponent('/tmp'));
    const body = await res.json();
    const names = body.dirs.map(d => d.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test('each dir entry has name and path fields', async ({ request }) => {
    const res = await request.get('/api/browse');
    const body = await res.json();
    for (const dir of body.dirs) {
      expect(dir).toHaveProperty('name');
      expect(dir).toHaveProperty('path');
      expect(dir.path).toContain(dir.name);
    }
  });

  test('path field in each entry is an absolute path', async ({ request }) => {
    const res = await request.get('/api/browse');
    const body = await res.json();
    for (const dir of body.dirs) {
      expect(path.isAbsolute(dir.path)).toBeTruthy();
    }
  });
});
