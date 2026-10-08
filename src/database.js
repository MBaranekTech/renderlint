'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, 'renderlint.sqlite');
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
      target_url TEXT NOT NULL,
      summary_json TEXT,
      issues_json TEXT,
      evidence_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS scans_project_created
      ON scans(project_id, created_at DESC);
  `);

  database.prepare(`
    UPDATE scans SET status = 'failed', error = 'Scan interrupted by service restart', completed_at = ?
    WHERE status IN ('queued', 'running')
  `).run(new Date().toISOString());

  return database;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    targetUrl: row.target_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scanCount: Number(row.scan_count || 0),
    lastScanStatus: row.last_scan_status || null,
  };
}

function mapScan(row, includeReport = false) {
  if (!row) return null;
  const scan = {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    targetUrl: row.target_url,
    error: row.error || null,
    createdAt: row.created_at,
    completedAt: row.completed_at || null,
    summary: parseJson(row.summary_json, null),
  };
  if (includeReport) {
    scan.issues = parseJson(row.issues_json, []);
    scan.evidence = parseJson(row.evidence_json, []);
  }
  return scan;
}

module.exports = { createDatabase, mapProject, mapScan };
