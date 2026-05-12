const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3001',
  },
  webServer: {
    command: 'DATA_DIR=/tmp/mmc-test PORT=3001 node server/index.js',
    port: 3001,
    reuseExistingServer: false,
    timeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
