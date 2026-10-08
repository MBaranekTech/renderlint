'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createDatabase, mapProject, mapScan } = require('./database');
const { scanWebsite } = require('./scanner');
const { buildAgentPrompt, buildBriefFilename } = require('./prompt');

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const dataDir = path.resolve(process.env.RENDERLINT_DATA_DIR || path.join(__dirname, '..', 'data'));
const evidenceDir = path.join(dataDir, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const database = createDatabase(dataDir);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

function now() {
  return new Date().toISOString();
}

function validateUrl(input) {
  let url;
  try {
    url = new URL(String(input || ''));
  } catch {
    throw Object.assign(new Error('Enter a valid website URL.'), { status: 422 });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Only HTTP and HTTPS websites can be scanned.'), { status: 422 });
  }
  url.hash = '';
  return url.href;
}

function getProject(id) {
  return database.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM scans s WHERE s.project_id = p.id) AS scan_count,
      (SELECT status FROM scans s WHERE s.project_id = p.id ORDER BY s.created_at DESC LIMIT 1) AS last_scan_status
    FROM projects p WHERE p.id = ?
  `).get(id);
}

function getScan(id, includeReport = false) {
  return mapScan(database.prepare('SELECT * FROM scans WHERE id = ?').get(id), includeReport);
}

function evidenceUrl(scanId, filename) {
  return `/evidence/${encodeURIComponent(scanId)}/${encodeURIComponent(filename)}`;
}

async function executeScan(scanId) {
  const scan = getScan(scanId);
  if (!scan) return;
  database.prepare("UPDATE scans SET status = 'running' WHERE id = ?").run(scanId);

  try {
    const result = await scanWebsite(scan.targetUrl, path.join(evidenceDir, scanId));
    const evidence = result.evidence.map((item) => ({
      ...item,
      screenshot: evidenceUrl(scanId, item.screenshot),
    }));
    const issues = result.issues.map((issue) => ({
      ...issue,
      evidence: issue.evidence.map((item) => ({
        ...item,
        screenshot: evidenceUrl(scanId, item.screenshot),
      })),
    }));
    database.prepare(`
      UPDATE scans SET status = 'completed', summary_json = ?, issues_json = ?, evidence_json = ?, completed_at = ?
      WHERE id = ?
    `).run(JSON.stringify(result.summary), JSON.stringify(issues), JSON.stringify(evidence), now(), scanId);
  } catch (error) {
    database.prepare(`
      UPDATE scans SET status = 'failed', error = ?, completed_at = ? WHERE id = ?
    `).run(error instanceof Error ? error.message : 'Unknown scan error', now(), scanId);
  }
}

app.get('/api/health', (request, response) => {
  response.json({ status: 'ok', service: 'RenderLint' });
});

app.get('/api/projects', (request, response) => {
  const rows = database.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM scans s WHERE s.project_id = p.id) AS scan_count,
      (SELECT status FROM scans s WHERE s.project_id = p.id ORDER BY s.created_at DESC LIMIT 1) AS last_scan_status
    FROM projects p ORDER BY p.updated_at DESC
  `).all();
  response.json({ projects: rows.map(mapProject) });
});

app.post('/api/projects', (request, response, next) => {
  try {
    const name = String(request.body?.name || '').trim();
    if (!name || name.length > 100) {
      throw Object.assign(new Error('Project name must be between 1 and 100 characters.'), { status: 422 });
    }
    const targetUrl = validateUrl(request.body?.targetUrl);
    const id = crypto.randomUUID();
    const timestamp = now();
    database.prepare(`
      INSERT INTO projects(id, name, target_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    `).run(id, name, targetUrl, timestamp, timestamp);
    response.status(201).json({ project: mapProject(getProject(id)) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:id', (request, response) => {
  const project = getProject(request.params.id);
  if (!project) return response.status(404).json({ error: 'Project not found.' });

  const scanIds = database.prepare('SELECT id FROM scans WHERE project_id = ?').all(project.id).map((row) => row.id);
  database.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  for (const scanId of scanIds) {
    fs.rmSync(path.join(evidenceDir, scanId), { recursive: true, force: true });
  }
  return response.json({ deleted: true });
});

app.get('/api/projects/:id/scans', (request, response) => {
  if (!getProject(request.params.id)) return response.status(404).json({ error: 'Project not found.' });
  const rows = database.prepare('SELECT * FROM scans WHERE project_id = ? ORDER BY created_at DESC').all(request.params.id);
  return response.json({ scans: rows.map((row) => mapScan(row)) });
});

app.post('/api/scans', (request, response, next) => {
  try {
    const project = getProject(String(request.body?.projectId || ''));
    if (!project) return response.status(404).json({ error: 'Project not found.' });
    const running = database.prepare("SELECT id FROM scans WHERE project_id = ? AND status IN ('queued', 'running')").get(project.id);
    if (running) return response.status(409).json({ error: 'A scan is already running for this project.', scanId: running.id });

    const id = crypto.randomUUID();
    const targetUrl = request.body?.targetUrl ? validateUrl(request.body.targetUrl) : project.target_url;
    database.prepare(`
      INSERT INTO scans(id, project_id, status, target_url, created_at) VALUES (?, ?, 'queued', ?, ?)
    `).run(id, project.id, targetUrl, now());
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), project.id);
    setImmediate(() => executeScan(id));
    return response.status(202).json({ scan: getScan(id) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/scans/:id', (request, response) => {
  const scan = getScan(request.params.id, true);
  if (!scan) return response.status(404).json({ error: 'Scan not found.' });
  return response.json({ scan });
});

app.get('/api/scans/:id/prompt', (request, response) => {
  const scan = getScan(request.params.id, true);
  if (!scan) return response.status(404).json({ error: 'Scan not found.' });
  if (scan.status !== 'completed') return response.status(409).json({ error: 'The scan is not complete.' });
  const project = mapProject(getProject(scan.projectId));
  response.type('text/plain').send(buildAgentPrompt(project, scan));
});

app.get('/api/scans/:id/brief', (request, response) => {
  const scan = getScan(request.params.id, true);
  if (!scan) return response.status(404).json({ error: 'Scan not found.' });
  if (scan.status !== 'completed') return response.status(409).json({ error: 'The scan is not complete.' });
  const project = mapProject(getProject(scan.projectId));
  response.attachment(buildBriefFilename(scan));
  response.type('text/markdown').send(buildAgentPrompt(project, scan));
});

app.use('/evidence', express.static(evidenceDir, { dotfiles: 'deny', fallthrough: false, immutable: false }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  const status = Number(error.status) || 500;
  const message = status >= 500 ? 'The server could not complete this request.' : error.message;
  if (status >= 500) console.error(error);
  return response.status(status).json({ error: message });
});

app.listen(port, host, () => {
  console.log(`RenderLint listening on http://${host}:${port}`);
});
