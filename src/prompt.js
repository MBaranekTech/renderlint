'use strict';

function buildAgentPrompt(project, scan) {
  const lines = [
    'You are a coding agent improving a website. Fix the verified issues below without redesigning unrelated parts of the page.',
    '',
    `Project: ${project.name}`,
    `Target: ${scan.targetUrl}`,
    `Scan: ${scan.id}`,
    `Verified issues: ${scan.summary?.total || 0}`,
    '',
    'Rules:',
    '- Preserve intended desktop behavior while fixing smaller viewports.',
    '- Prefer root-cause fixes and existing design tokens over one-off overrides.',
    '- Do not hide content solely to make an audit pass.',
    '- Verify the affected viewport after each fix.',
  ];

  scan.issues.forEach((issue, index) => {
    lines.push(
      '',
      `## ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.title}`,
      `Category: ${issue.category}`,
      `Rule: ${issue.rule}`,
      `Viewport(s): ${issue.viewports.join(', ')}`,
      `Selector: ${issue.selector}`,
      `Evidence: ${issue.detail}`,
    );
  });

  lines.push('', 'After implementing the fixes, summarize each changed file and report anything that could not be verified.');
  return lines.join('\n');
}

function targetSlug(scan) {
  let label = 'website';
  try {
    label = new URL(scan.targetUrl).hostname || label;
  } catch {
    // Keep the generic label if stored scan data does not contain a valid URL.
  }
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'website';
}

function buildBriefFilename(scan) {
  return `renderlint-${targetSlug(scan)}-report.md`;
}

function buildJsonFilename(scan) {
  return `renderlint-${targetSlug(scan)}-report.json`;
}

module.exports = { buildAgentPrompt, buildBriefFilename, buildJsonFilename };
