# Handoff: real-code runtime (read this first)

Owner: not a coder; wants short plain reports, PRs merged by you when checks pass,
deploys and live tests done by you, one report at the end. Repo: onesolutions-ahuja/One-engine.
Read also: `docs/real-code-runtime-plan.md`, `docs/examples/till-handwritten.tsx`, `DEVELOPER_POLICY.md`.

## Goal (owner's targets, live till page `/une/apps/SMARTTILL/pages/smart_till_billing`)
- Tap shows < 100 ms (DONE: 40-80 ms)
- Tap saved < 400 ms (NOW ~500 ms round trip, server ~320 ms)
- Page opens < 1.5 s (NOW ~3.5 s)
- Search fast with 10k products (NOT DONE)
Then check kiosk (`smartkiosk`) and ServiceFlow pages.

## What exists now (merged + live, PRs #102-#105)
- `apps/server/src/page-compiler/code/formulaDictionary.ts` - every formula once + the code it becomes.
- `.../code/formulaLibrary.ts` - plain functions (F.*) and operators (O.*), browser + server.
- `.../code/generateCode.ts` - display formula -> `(row, $) => value`; action formula -> `async ($) => {...}`;
  collects "record sets" (rows a page holds: e.g. open Cart + its CartLines).
- `.../code/pageCode.ts` - per page build: module text appended to the page script + server copy (`new Function`).
  Each page file lists `codeIssues` = formulas not converted.
- `apps/server/src/system-support/page-code-runtime.ts` - server `$`: runs action in ONE `db.transaction`
  (all or nothing), re-reads clicked row from SQL, read cache, returns `{changes, state, effects, sets}`.
- Routes (`api/PageScriptController.ts`): `POST /api/apps/:appId/page-code/execute`, `.../page-code/sets`,
  same under `/api/pages/:apiName/` for Builder Preview; `GET /api/page-builds/:appId/:buildId.js` (immutable cache).
- Browser: `apps/web/src/core/pages/PageCompiler/pageCodeRuntime.ts` (held sets, instant tap, undo on failure),
  wired in `CompiledPageRuntime.tsx` (onAction uses page code first), `RegisteredComponent.tsx` and
  `component-libraries/smart/shared/SmartRuntime.jsx` (use `__formulaCode` functions first).
- Popups load only on first open; Smart library + index load with page open.
- Tests: `apps/web/test/pageCode.test.ts` (run: `cd apps/web && tsx --test test/pageCode.test.ts`).
- Debug in browser console: `window.__unePageCode` (`.misses` = taps that could not be predicted).

## Remaining work, in order
1. **Storage (biggest for save < 400 ms + search):** replace EAV `md_records`/`md_record_values` with one real
   table per object shared by tenants (`tenant_id`), typed columns + indexes for standard/app fields, one JSONB
   column for tenant-added fields (auto expression indexes for filtered ones), `pg_trgm` index on Name/Barcode.
   Start: Product, MenuCategory, Cart, CartLine, Customer. Object/Field builder must keep working (adding a field
   updates table/JSONB). Migrate safely: copy, verify counts, switch, keep old tables. Keep RBAC (`md_record_access`),
   field security, sharing. ~40 server files query EAV directly (grep `md_record_values`); `record-engine.ts` is the
   hot path. Note: DEVELOPER_POLICY #8 forbids JSON columns - the owner explicitly asked for the JSONB column; update the policy text in the same PR.
2. **Page open < 1.5 s:** published apps still load Setup shell + `/metadata/landing-bootstrap` (358 KB) -
   make an app-scoped bootstrap; return first data + record sets in the page response (one request).
3. **Search/category:** filter in memory when all rows are held; else server search with trigram index.
4. **Remove old engine:** convert remaining action steps (EMAIL, SMS, WHATSAPP, WAIT, LOCATION, RECORDPAYMENT,
   CREATEPDF), COLLECTION/TABLE criteria forms, Flow/Navigate bindings; then delete FieldExpression interpreter use,
   `/formulas/evaluate-many`, `compiled-actions` interpreter path. No fallback engine.
5. Cash/Card popups open ~2 s after tap (SCREEN runs after save) - consider opening from prediction safely.

## Known facts
- Kiosk menu design is in the Custom layout only (Desktop empty); its formulas use bare `@Name` (owner fixes by hand).
- ServiceFlow pages return 404 under all apps for this login (not assigned to an app).
- Narrow window asks for a Mobile layout that doesn't exist -> ~18 s blank before Desktop fallback (pre-existing).

## How to work here
- No npm install in the sandbox; local checks: global `tsc`/`tsx`; Postgres 16 is installed (start it for SQL tests).
- CI (`.github/workflows/verify-oci-build.yml`) runs tests + builds on each PR - that's the gate.
- PRs via REST: `gh api repos/onesolutions-ahuja/One-engine/pulls -f base=main -f head=BRANCH -f title=... -F body=@file`;
  merge: `gh api -X PUT repos/onesolutions-ahuja/One-engine/pulls/N/merge -f merge_method=merge`.
- Deploy from the owner's browser session (built-in browser, signed in on unesolutions.co.uk):
  `POST /api/platform/production-deployment {expectedCommit: <main sha>}` with a bearer from
  `POST /api/auth/refresh` (credentials include); poll `GET /api/platform/production-deployment/live`.
- Measure: tap test = click `article.smart-card`, watch the `[class*=smart-cart]` text change (MutationObserver);
  save time = resource timing of `/page-code/execute` (Server-Timing `action`).
- Smart Till tenant data is dummy: test sales are fine.
