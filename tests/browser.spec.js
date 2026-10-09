const { test, expect } = require('@playwright/test');

const baseUrl = process.env.RENDERLINT_URL || 'http://127.0.0.1:8791';
test.setTimeout(90_000);

test('creates a project, scans the broken demo, and renders an actionable report', async ({ page, request }) => {
  const errors = [];
  let projectId = '';
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  try {
    await page.goto(baseUrl);
    await page.locator('#use-demo').click();
    await page.locator('#project-form button[type="submit"]').click();
    await expect(page.locator('#project-name')).toHaveText('Broken demo');
    await expect(page.locator('#open-target')).toHaveAttribute('href', `${baseUrl}/demo.html`);
    await expect(page.locator('#open-target')).toHaveAttribute('target', '_blank');

    projectId = await page.evaluate(async () => {
      const payload = await fetch('/api/projects').then((response) => response.json());
      return payload.projects.find((project) => project.name === 'Broken demo').id;
    });

    await page.locator('#run-scan').click();
    await expect(page.locator('#scan-state')).toBeVisible();
    await expect(page.locator('#report')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('#evidence-grid .evidence-card')).toHaveCount(3);
    await expect(page.locator('#issue-list')).toContainText('Buttons must have discernible text');
    await expect(page.locator('#issue-list')).toContainText('Page overflows horizontally');
    await expect(page.locator('#copy-prompt')).toBeEnabled();
    await expect(page.locator('#download-brief')).toBeEnabled();
    await expect(page.locator('#download-json')).toBeEnabled();
    await expect(page.locator('.copy-finding').first()).toBeVisible();

    const criticalTotal = Number(await page.locator('#summary-critical').textContent());
    await page.locator('#severity-filter [data-severity="critical"]').click();
    await expect(page.locator('#issue-list .issue')).toHaveCount(criticalTotal);
    await expect(page.locator('#issue-list .severity')).toHaveText(Array(criticalTotal).fill('critical'));
    await page.locator('#severity-filter [data-severity="all"]').click();
    await expect(page.locator('#issue-list .issue')).toHaveCount(Number(await page.locator('#summary-total').textContent()));

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download-brief').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('renderlint-127-0-0-1-report.md');
    expect(await download.createReadStream().then(async (stream) => {
      let content = '';
      for await (const chunk of stream) content += chunk.toString();
      return content;
    })).toContain('Project: Broken demo');

    const jsonDownloadPromise = page.waitForEvent('download');
    await page.locator('#download-json').click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toBe('renderlint-127-0-0-1-report.json');
    const jsonPath = await jsonDownload.path();
    const report = JSON.parse(require('node:fs').readFileSync(jsonPath, 'utf8'));
    expect(report.schemaVersion).toBe(1);
    expect(report.project.name).toBe('Broken demo');
    expect(report.scan.issues.length).toBeGreaterThan(0);

    await page.locator('.copy-finding').first().click();
    await expect(page.locator('#toast')).toContainText('Finding copied.');

    const scanCount = await page.locator('#scan-list .scan-chip').count();
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#scan-list .scan-chip')).toHaveCount(scanCount + 1);
    await expect(page.locator('#scan-state')).toBeVisible();
    await expect(page.locator('#report')).toBeVisible({ timeout: 45_000 });

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.scan-history-item').first().hover();
    await page.locator('.scan-history-item').first().locator('.delete-scan').click();
    await expect(page.locator('#scan-list .scan-chip')).toHaveCount(scanCount);
    await expect(page.locator('#toast')).toContainText('Scan deleted.');

    const total = Number(await page.locator('#summary-total').textContent());
    expect(total).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    if (projectId) await request.delete(`${baseUrl}/api/projects/${projectId}`);
  }
});
