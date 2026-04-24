# Full Review Report (2026-04-24)

## Scope
- Code quality baseline (`eslint`)
- Unit/integration test baseline (`jest --runInBand`)
- High-level architecture and risk scan across routes/services/workers

## Quick Result
- ✅ Tests are healthy: 48/49 suites passed, 626/628 tests passed (2 skipped).
- ⚠️ Lint had actionable issues before fixes:
  - `services/bedrock.js`: `no-useless-assignment`
  - `scripts/backfill-glossary-category.js`: script logging conflicted with `no-console`
  - `tests/meetings-core-routes.test.js`: one `no-unused-vars` warning
- ✅ These issues were fixed in this review branch.

## Architecture Observations
- Clear layered design: `routes/` -> `services/` -> storage/cloud SDK.
- Worker split is appropriate (`transcription`, `report`, `export`), reducing coupling.
- Test coverage breadth is strong, especially around report generation, glossary, retry, and routes.

## Risks & Suggestions
1. **Prompt complexity risk (maintainability)**
   - `services/bedrock.js` contains very long inline prompt templates for multiple meeting types.
   - Suggest extracting prompt templates into dedicated files or builders per meeting type.

2. **Operational scripts lint boundary**
   - One-off scripts naturally use console output; enforcing app-wide no-console can create friction.
   - Suggest adding an ESLint override for `scripts/**` instead of per-file disable if scripts grow.

3. **Long-term reliability checks**
   - Consider adding a lightweight CI matrix:
     - `npm run lint`
     - `npm test -- --runInBand`
   - This helps block regressions on static rules and core logic.

## What Was Fixed in This Review
- Refactored `speakerNote` creation in `services/bedrock.js` to avoid useless assignment and improve readability.
- Allowed script-side logging explicitly in `scripts/backfill-glossary-category.js` via ESLint directive.
- Renamed unused Express error middleware arg to `_next` in test file to satisfy lint convention.

## Follow-up (Optional)
- Split Bedrock prompts into `prompts/*.md|js` and add snapshot-style prompt regression tests.
- Add ESLint override for scripts in `eslint.config.js`.
