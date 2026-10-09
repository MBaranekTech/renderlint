# Changelog

All notable changes to RenderLint will be documented in this file. The project follows Semantic
Versioning once a stable public API is established.

## [Unreleased]

### Added

- Download completed repair briefs as hostname-based Markdown files.
- Export complete scan results as structured JSON reports.
- Copy individual findings and rerun scans with `Ctrl/Command+Enter`.
- Open target websites directly and delete individual scans with their stored evidence.
- Filter actionable findings by severity and category at the same time.
- GitHub Actions checks for unit, browser, Docker, and smoke tests.
- Playwright browser-test configuration.
- Project license and community health documentation.
- Docker health check and safer loopback binding for direct Node.js usage.
- Real dashboard and report screenshots in the README.
- New RenderLint viewport-check logo and visual identity.

### Fixed

- Equivalent DOM findings are merged across viewports instead of being duplicated by dimensions.
- Updated Playwright, Express, axe-core, and vulnerable transitive dependencies.

### Changed

- Standardized project naming and runtime identifiers as RenderLint.

## [0.1.0] - 2026-10-08

### Added

- Local project and scan history backed by SQLite.
- Chromium checks at mobile, tablet, and desktop viewport sizes.
- Responsive layout, accessibility, runtime, network, and basic structure findings.
- Screenshot evidence and coding-agent repair brief export.
- Docker Compose setup and deliberately broken test page.
