'use strict';

const { chromium } = require('playwright');

const baseUrl = process.env.RENDERLINT_URL || 'http://127.0.0.1:8787';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  let projectId = '';

  try {
    await page.goto(baseUrl);
    await page.locator('#use-demo').click();
    await page.locator('#project-form button[type="submit"]').click();
    await page.locator('#run-scan').click();
    await page.locator('#report').waitFor({ state: 'visible', timeout: 45_000 });
    await page.waitForTimeout(3_500);

    projectId = await page.evaluate(async () => {
      const { projects } = await fetch('/api/projects').then((response) => response.json());
      return projects.find((project) => project.name === 'Broken demo')?.id || '';
    });

    await page.screenshot({ path: 'docs/screenshots/dashboard.png', fullPage: true });
    await page.locator('#project-view').screenshot({ path: 'docs/screenshots/report.png' });
  } finally {
    if (projectId) await page.request.delete(`${baseUrl}/api/projects/${projectId}`);
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
