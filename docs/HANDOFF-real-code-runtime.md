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

## Status 16 Nov 2026 (PRs #109-#118, all live)
- Tap shows 67-96 ms; saved 220-270 ms (86 SQL trips; CI probe `apps/server/scripts/record-trips-probe.mjs`, budget 60).
- Page open 1.2-1.7 s (repeat), ~2.7 s first open after a deploy. Landing bootstrap now requested with the session.
- Lists: `md_object_access_fast()` decides record access once per query (`system-support/record-access-fast.ts`);
  10k products 24 s -> 7-20 ms (CI probe `search-10k-probe.mjs`, budget 150 ms, equivalence checks).
- Every Object of every tenant has a typed native table (reads/filters). Writes still go to EAV + sync triggers.
- Page code converts EVERY action step on every page (checked by building all 151 pages):
  EMAIL/SMS/WHATSAPP (sent after commit), RECORDPAYMENT (same transaction), WAIT (schedules the rest as a
  scheduled action in the same transaction), LOCATION/CREATEPDF (server returns `needs`, browser answers, action re-runs),
  `@state/@filter/@navigate :=`. Popups (SCREEN) open from the prediction (Cash popup 89 ms).
- Only page issue: smart_till_customer_display column3Source `@Quantity` (owner fixes to `@CartLine.Quantity`).
- Old engine still answers (measured live with `window.__uneOldEngine`, see `oldEngineMeter.js`):
  1. sql-formula: SUMIFS/COUNTIFS over Objects not held as record sets (Invoice, Cart Held) on
     smart_till_dashboard / smart_till_reports -> add a page-code server call that runs the same generated
     display functions with the server `$` (one request for all), then delete /formulas/evaluate(-many).
  2. field-expression: `=$tenant.name`, time/NOW labels, `BLANKVALUE($state...)` labels (cash count), row formulas
     `@Invoice.Total` (tables/charts), filter value formulas `TODAY()`, `ADDDAYS(...)`, `BLANKVALUE("","*")`
     -> route these call sites (SmartRuntime scopedExpression paths, smart_table/smart_chart, record filter
     formulas) through page code functions.
  3. collection: static `COLLECTION("Name","a","b")` option lists (tabs/filters) -> page code function.
  Then delete FieldExpression interpreter use, /formulas/evaluate*, /action-formulas/execute-data,
  compiled-actions routes, formulaAction.ts.

## Remaining work, in order
1. Old engine removal (list above), small PRs, deploy each, re-run the meter on all app pages.
2. Storage: native tables authoritative, drop EAV (owner OK: data is dummy). Suggested: rewrite the ~19
   write statements to native tables; make `md_record_values` a read view over native tables for the ~29 readers
   and SQL functions (md_record_field, policies, uniqueness), then convert readers and drop the view.
   Native unique indexes for unique fields; FKs for lookup columns. Keep `md_records` (owner, sharing, deletion).
3. (Skipped by owner) standalone app entry without Setup shell.

## Merge rule
Merge only when BOTH CI jobs succeed (use a script that checks every conclusion; #117 was merged red and fixed by #118).

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
