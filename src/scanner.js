'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const axe = require('axe-core');

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
];

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function selectorFromTarget(target) {
  if (Array.isArray(target)) return target.join(' ');
  return String(target || 'document');
}

function normalizeAxeImpact(impact) {
  return { critical: 'critical', serious: 'high', moderate: 'medium', minor: 'low' }[impact] || 'medium';
}

function addIssue(collection, issue) {
  // Dimensions differ by viewport, but they still describe the same DOM finding.
  // Runtime messages retain their detail because multiple errors can target document.
  const detailKey = issue.category === 'runtime' ? issue.detail || '' : '';
  const key = `${issue.rule}|${issue.selector || ''}|${detailKey}`;
  const existing = collection.get(key);
  if (existing) {
    if (!existing.viewports.includes(issue.viewport)) existing.viewports.push(issue.viewport);
    if (issue.evidence && !existing.evidence.some((item) => item.viewport === issue.evidence.viewport)) {
      existing.evidence.push(issue.evidence);
    }
    return;
  }
  collection.set(key, {
    id: `issue-${collection.size + 1}`,
    category: issue.category,
    severity: issue.severity,
    rule: issue.rule,
    title: issue.title,
    detail: issue.detail,
    selector: issue.selector || 'document',
    viewports: [issue.viewport],
    evidence: issue.evidence ? [issue.evidence] : [],
    helpUrl: issue.helpUrl || null,
  });
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    function selector(element) {
      if (!element || element === document.documentElement) return 'html';
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        let part = current.tagName.toLowerCase();
        const usefulClasses = [...current.classList].filter((name) => !/[0-9]{4,}/.test(name)).slice(0, 2);
        if (usefulClasses.length) part += `.${usefulClasses.map((name) => CSS.escape(name)).join('.')}`;
        const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        parts.unshift(part);
        current = current.parentElement;
        if (parts.length === 4) break;
      }
      return parts.join(' > ');
    }

    function visible(element, style, rect) {
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    }

    const results = [];
    const viewportWidth = window.innerWidth;
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    if (documentWidth > viewportWidth + 2) {
      results.push({
        rule: 'page-horizontal-overflow',
        severity: 'high',
        title: 'Page overflows horizontally',
        detail: `Rendered page is ${documentWidth}px wide in a ${viewportWidth}px viewport.`,
        selector: 'html',
        rect: null,
      });
    }

    const elements = [...document.body.querySelectorAll('*')].slice(0, 4000);
    let overflowCount = 0;
    let clippedCount = 0;
    let touchCount = 0;

    for (const element of elements) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (!visible(element, style, rect)) continue;

      const isStructural = ['HTML', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META', 'BR'].includes(element.tagName);
      const outsideRight = rect.right > viewportWidth + 2;
      const outsideLeft = rect.left < -2;
      const parent = element.parentElement;
      const parentRect = parent?.getBoundingClientRect();
      const nestedInOverflow = parent
        && !['HTML', 'BODY'].includes(parent.tagName)
        && ((outsideRight && parentRect.right > viewportWidth + 2) || (outsideLeft && parentRect.left < -2));
      if (!isStructural && !nestedInOverflow && overflowCount < 10 && (outsideRight || outsideLeft)) {
        results.push({
          rule: 'element-outside-viewport',
          severity: 'high',
          title: 'Element extends outside the viewport',
          detail: `Element bounds are ${Math.round(rect.left)}px–${Math.round(rect.right)}px in a ${viewportWidth}px viewport.`,
          selector: selector(element),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
        overflowCount += 1;
      }

      const clipsX = ['hidden', 'clip'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 3;
      const clipsY = ['hidden', 'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 3;
      if (!isStructural && clippedCount < 8 && (clipsX || clipsY)) {
        results.push({
          rule: 'clipped-content',
          severity: 'medium',
          title: 'Content is clipped',
          detail: `Content size ${element.scrollWidth}×${element.scrollHeight}px exceeds its ${element.clientWidth}×${element.clientHeight}px box.`,
          selector: selector(element),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
        clippedCount += 1;
      }

      const interactive = element.matches('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]');
      if (window.innerWidth <= 430 && interactive && touchCount < 12 && (rect.width < 44 || rect.height < 44)) {
        results.push({
          rule: 'small-touch-target',
          severity: 'medium',
          title: 'Touch target is smaller than 44px',
          detail: `Interactive element measures ${Math.round(rect.width)}×${Math.round(rect.height)}px.`,
          selector: selector(element),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
        touchCount += 1;
      }
    }

    const h1Count = document.querySelectorAll('h1').length;
    if (h1Count === 0) {
      results.push({ rule: 'missing-h1', severity: 'medium', title: 'Page has no H1', detail: 'Add one descriptive top-level heading.', selector: 'body', rect: null });
    } else if (h1Count > 1) {
      results.push({ rule: 'multiple-h1', severity: 'low', title: 'Page has multiple H1 headings', detail: `Found ${h1Count} H1 elements.`, selector: 'h1', rect: null });
    }

    if (!document.querySelector('meta[name="description"]')) {
      results.push({ rule: 'missing-description', severity: 'low', title: 'Meta description is missing', detail: 'Add a concise description for search and link previews.', selector: 'head', rect: null });
    }

    return results;
  });
}

async function scanWebsite(targetUrl, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const issueMap = new Map();
  const evidence = [];
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const runtimeEvents = [];

      page.on('console', (message) => {
        if (message.type() === 'error') runtimeEvents.push({ rule: 'console-error', detail: message.text() });
      });
      page.on('pageerror', (error) => runtimeEvents.push({ rule: 'page-error', detail: error.message }));
      page.on('requestfailed', (request) => runtimeEvents.push({
        rule: 'failed-request',
        detail: `${request.method()} ${request.url()} — ${request.failure()?.errorText || 'request failed'}`,
      }));
      page.on('response', (response) => {
        if (response.status() >= 400) runtimeEvents.push({
          rule: 'http-error',
          detail: `${response.status()} ${response.request().method()} ${response.url()}`,
        });
      });

      let navigationError = null;
      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 25000 });
      } catch (error) {
        navigationError = error.message;
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 });
        } catch {
          // Evidence from partially loaded pages is still useful.
        }
      }
      await page.waitForTimeout(350);

      const screenshotName = `${viewport.name}.png`;
      const screenshotPath = path.join(outputDir, screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
      const evidenceItem = {
        viewport: viewport.name,
        width: viewport.width,
        height: viewport.height,
        screenshot: screenshotName,
        pageTitle: await page.title().catch(() => ''),
      };
      evidence.push(evidenceItem);

      if (navigationError) {
        addIssue(issueMap, {
          category: 'runtime', severity: 'critical', rule: 'navigation-failed', title: 'Page did not finish loading',
          detail: navigationError.split('\n')[0], selector: 'document', viewport: viewport.name, evidence: evidenceItem,
        });
      }

      const layoutIssues = await inspectLayout(page).catch(() => []);
      for (const issue of layoutIssues) {
        addIssue(issueMap, {
          ...issue,
          category: ['missing-h1', 'multiple-h1', 'missing-description'].includes(issue.rule) ? 'structure' : 'responsive',
          viewport: viewport.name,
          evidence: { ...evidenceItem, rect: issue.rect },
        });
      }

      await page.addScriptTag({ content: axe.source });
      const axeResult = await page.evaluate(async () => window.axe.run(document, {
        resultTypes: ['violations'],
        rules: { 'color-contrast': { enabled: true } },
      })).catch(() => ({ violations: [] }));

      for (const violation of axeResult.violations.slice(0, 20)) {
        for (const node of violation.nodes.slice(0, 4)) {
          addIssue(issueMap, {
            category: 'accessibility',
            severity: normalizeAxeImpact(violation.impact),
            rule: `axe-${violation.id}`,
            title: violation.help,
            detail: node.failureSummary || violation.description,
            selector: selectorFromTarget(node.target),
            viewport: viewport.name,
            evidence: evidenceItem,
            helpUrl: violation.helpUrl,
          });
        }
      }

      for (const event of runtimeEvents.slice(0, 20)) {
        addIssue(issueMap, {
          category: 'runtime',
          severity: event.rule === 'console-error' ? 'high' : 'medium',
          rule: event.rule,
          title: {
            'console-error': 'Console error detected', 'page-error': 'Unhandled page error',
            'failed-request': 'Network request failed', 'http-error': 'Resource returned an HTTP error',
          }[event.rule],
          detail: event.detail,
          selector: 'document',
          viewport: viewport.name,
          evidence: evidenceItem,
        });
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  const issues = [...issueMap.values()].sort((a, b) => {
    const severityDifference = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return severityDifference || a.category.localeCompare(b.category) || a.title.localeCompare(b.title);
  });
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCategory = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
  }

  return {
    summary: { total: issues.length, bySeverity, byCategory, viewports: VIEWPORTS },
    issues,
    evidence,
  };
}

module.exports = { VIEWPORTS, scanWebsite };
