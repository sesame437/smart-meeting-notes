# Repository Guidelines

## Project Structure & Module Organization
`server.js` is the Express entrypoint. API handlers live in `routes/`, shared AWS and business logic in `services/`, request middleware in `middleware/`, and async queue consumers in `workers/`. The browser UI is static and lives in `public/` (`index.html`, `meeting.html`, `glossary.html`, plus `public/js/` and `public/css/`). Tests are primarily in `tests/`; Playwright end-to-end coverage lives in `e2e/`. Operational helpers are in `scripts/`, sample media/docs in `assets/`, and generated output such as `coverage/` and `test-results/` should not be edited manually.

## Build, Test, and Development Commands
Run `npm install` once to install dependencies. Use `npm start` to launch the API server on `PORT` (default `3300`). `npm run dev` starts the Vite dev server, and `npm run build` / `npm run preview` build and preview frontend assets. Workers run separately: `npm run worker:transcription`, `npm run worker:report`, and `npm run worker:export`. Quality checks: `npm test` for Jest, `npm run test:e2e` for Playwright, `npm run test:integration` for opt-in integration tests, and `npm run lint` for ESLint.

## Coding Style & Naming Conventions
This repo uses CommonJS JavaScript. Follow Prettier settings from `.prettierrc`: single quotes, no semicolons, trailing commas where valid, and `printWidth` 100. Use 2-space indentation in JS, HTML, and CSS. Prefer descriptive camelCase for variables/functions, PascalCase only for constructor-style objects, and kebab-case for test filenames such as `speaker-map-route.test.js`. Keep route files focused on HTTP concerns and move reusable logic into `services/`.

## Testing Guidelines
Jest is the default test framework (`tests/*.test.js`), with `node` as the test environment. Add unit or route-level tests alongside the existing naming pattern `feature-name.test.js`. Reserve `e2e/` for browser workflows that require a running server. Cover both success and failure paths for AWS-backed flows, especially queue retries, validation, and report regeneration.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit prefixes such as `feat:` and `fix:`; keep using that format with a short imperative summary. Keep commits scoped to one behavior change where possible. Pull requests should include a concise description, impacted routes/workers/UI screens, environment changes, and test evidence (`npm test`, `npm run lint`, Playwright output if relevant). Include screenshots or short recordings for visible UI changes.

## Security & Configuration Tips
Copy `.env.example` to `.env` and never commit real credentials. AWS region, S3, DynamoDB, SQS, and SES settings are required for full workflows. Treat `coverage/`, uploaded artifacts, and generated reports as disposable output, not source files.
