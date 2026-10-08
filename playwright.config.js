'use strict';

const { defineConfig } = require('@playwright/test');
const externalUrl = process.env.RENDERLINT_URL;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: externalUrl || 'http://127.0.0.1:8791',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: externalUrl ? undefined : {
    command: 'npm start',
    url: 'http://127.0.0.1:8791/api/health',
    env: { PORT: '8791', RENDERLINT_DATA_DIR: './test-results/data' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
