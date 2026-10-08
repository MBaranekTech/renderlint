# Contributing to RenderLint

Thanks for helping make website preflight checks more useful and trustworthy.

## Before opening a change

- Search existing issues and pull requests.
- For a large feature or behavior change, open an issue first so its scope can be agreed on.
- Keep checks deterministic. An issue should be backed by browser or DOM evidence.
- Do not add a hosted dependency or send scanned content to a third party without prior discussion.

## Local development

RenderLint requires Node.js 22.5 or newer.

```bash
npm ci
npx playwright install chromium
npm start
```

The dashboard is available at <http://127.0.0.1:8787>. Application data created this way is
stored in the ignored `data/` directory.

Docker is the easiest way to exercise the production-like setup:

```bash
docker compose up -d --build --wait
npm run test:smoke
docker compose down
```

## Tests

```bash
npm test
npm run test:browser
```

Add or update a test when changing scanner behavior, API responses, or the dashboard workflow.
Before submitting a pull request, run the relevant commands above and `docker compose config`.

## Pull requests

- Keep a pull request focused on one problem.
- Explain the user-visible behavior and how it was verified.
- Include screenshots for dashboard changes.
- Update README or SECURITY documentation when assumptions or limitations change.

By contributing, you agree that your contribution is licensed under the MIT License.
