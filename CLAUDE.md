# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Meeting Minutes AI: upload audio -> FunASR transcription -> Bedrock Claude report generation -> SES email.
Port 3300 | Frontend: static HTML/CSS/JS in `public/` (Cloudscape design style)

## Commands

```bash
npm start                        # Start Express server (port 3300)
npm test                         # Jest unit tests (baseline: 539+ passed, coverage >= 87%)
npx jest tests/foo.test.js       # Run a single test file
npm run lint                     # ESLint
npm run worker:transcription     # Start transcription worker (separate terminal)
npm run worker:report            # Start report worker (separate terminal)
npm run worker:export            # Start export worker (separate terminal)
npx playwright test e2e/         # E2E tests (server must be running)
```

## Stack

- **Backend**: Node.js / Express (CommonJS), DynamoDB, S3, SQS
- **AI**: Bedrock Claude Sonnet 4.6 (us-west-2) for reports, Haiku for auto-naming
- **Transcription**: FunASR (172.31.27.101:9002, GPU EC2, on-demand) + Amazon Transcribe
- **Email**: SES (us-west-2)
- **Frontend**: Plain HTML/CSS/JS in `public/` (no framework, no build step)
- **Testing**: Jest (unit), Playwright (E2E), supertest (route tests)

## Architecture

```
server.js                        # Express entry: require + app.use, Helmet CSP, rate limiting
middleware/auth.js               # API key authentication
routes/
  meetings/                      # Split by concern:
    index.js                     #   Router aggregator
    core.js                      #   CRUD, upload, retry, auto-name
    report.js                    #   Report generation, PATCH, speaker-names, merge
    email.js                     #   Email sending
    helpers.js                   #   Shared route utilities
  glossary.js                    # Glossary CRUD
services/
  meeting-store.js               # DynamoDB meeting operations (the data access layer)
  glossary-store.js              # DynamoDB glossary operations
  bedrock.js                     # Bedrock Claude invocation + prompt templates
  report-builder.js              # Report construction logic
  report-speaker-normalizer.js   # Speaker name normalization in reports
  s3.js                          # S3 file ops (uploadFile/getFile add PREFIX internally)
  sqs.js                         # SQS send/receive/delete
  ses.js                         # SES email sending
  gpu-autoscale.js               # FunASR EC2 auto-hibernate
  ffmpeg.js                      # Audio format conversion
  logger.js                      # Centralized logger (use this, never console.log)
workers/
  transcription-worker.js        # SQS poll -> FunASR/Transcribe -> S3
  report-worker.js               # SQS poll -> Bedrock Claude -> S3 + DynamoDB
  export-worker.js               # SQS poll -> render HTML -> SES
public/
  index.html / meeting.html / glossary.html
  js/app.js                      # All frontend logic (vanilla JS)
  css/style.css                  # Cloudscape-style theme
tests/                           # Jest unit tests (tests/*.test.js)
e2e/                             # Playwright E2E tests
```

### Key Data Flow

1. Upload audio -> S3 + DynamoDB record + SQS transcription message
2. Transcription worker -> FunASR/Transcribe -> transcript JSON to S3 -> SQS report message
3. Report worker -> reads transcript + glossary -> Bedrock Claude -> report JSON to S3 + DynamoDB
4. User views/edits report in browser, can regenerate with updated speakerMap
5. Email export -> SQS export message -> worker renders HTML -> SES

### Status Flow

`pending -> processing -> transcribed -> reported -> done` (any step can -> `failed`)

## Critical Conventions

**S3 Keys**: Store bare keys in DynamoDB (no PREFIX). `s3.uploadFile()`/`getFile()` add PREFIX internally.
- `inbox/{meetingId}/{filename}` | `reports/{meetingId}/report.json` | `transcripts/{meetingId}/funasr.json`

**Field Names** (enforced, no aliases):
- `actions` (not actionItems), `decisions` (not keyDecisions), `highlights[].point` (not .text), `teamKPI.individuals` (not .indicators)

**DynamoDB**: Never use ScanCommand for list endpoints. Use parallel QueryCommand across known status values with GSI `status-createdAt-index`.

**Logging**: Always use `services/logger.js` with module field. Never `console.log`/`console.error`.

**Rate Limiting**: Already configured in `server.js` for upload/report/merge endpoints. Do not add additional rate-limit middleware in routes.

**Input Validation**: Use zod for all API input validation. No hand-written `if (!req.body.xxx)` checks.

## Report JSON Structure

All meeting types share: `summary`, `participants`, `highlights`, `lowlights`, `actions`, `decisions`.
Type-specific extensions: `weekly` adds `teamKPI`, `announcements`, `projectReviews`, `nextMeeting` | `tech`/`general` add `topics` | `customer` adds `customerInfo`, `customerNeeds`, `painPoints`, `solutionsDiscussed`, `commitments`, `nextSteps` | `merged` adds `keyTopics`, `risks`, `sourceMeetings`.

Full schema in `.claude/rules/data.md`.

## Don't

- New routes in server.js -> create in `routes/`
- DynamoDB store S3 keys with PREFIX -> store bare keys
- SES us-east-1 -> always us-west-2
- Inline script or onclick="" -> external JS + event delegation
- Direct DOM manipulation in business logic
- `{ "error": "string" }` -> use `{ "error": { "code": "...", "message": "..." } }`

## Refs

- `.claude/rules/coding.md` — Code style, error handling, naming
- `.claude/rules/testing.md` — Three-layer verification, E2E requirements
- `.claude/rules/api.md` — REST conventions, status codes, pagination
- `.claude/rules/data.md` — DynamoDB schema, report JSON structure, field naming rules
