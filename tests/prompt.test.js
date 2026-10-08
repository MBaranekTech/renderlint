'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAgentPrompt, buildBriefFilename } = require('../src/prompt');

test('agent prompt contains verified evidence and implementation constraints', () => {
  const prompt = buildAgentPrompt(
    { name: 'Site' },
    {
      id: 'scan-1',
      targetUrl: 'https://example.com/',
      summary: { total: 1 },
      issues: [{
        severity: 'high', category: 'responsive', rule: 'element-outside-viewport',
        title: 'Element extends outside the viewport', viewports: ['mobile'],
        selector: '.pricing-grid', detail: 'Element is 900px wide.',
      }],
    },
  );

  assert.match(prompt, /Project: Site/);
  assert.match(prompt, /Selector: \.pricing-grid/);
  assert.match(prompt, /Prefer root-cause fixes/);
  assert.match(prompt, /Viewport\(s\): mobile/);
});

test('repair brief filename uses a safe target hostname slug', () => {
  assert.equal(
    buildBriefFilename({ targetUrl: 'https://Docs.Example.com:8443/path?q=1' }),
    'renderlint-docs-example-com-report.md',
  );
  assert.equal(buildBriefFilename({ targetUrl: 'not a URL' }), 'renderlint-website-report.md');
});
