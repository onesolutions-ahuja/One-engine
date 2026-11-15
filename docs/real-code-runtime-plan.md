# Real-code runtime: plan (agreed Nov 2026)

Goal: any app built in the Page Builder runs like the same app written by hand
(see `docs/examples/till-handwritten.tsx`). Page design stays metadata in SQL
(the master copy, editable in the builder, per-tenant); on save the server
generates real code for that page revision.

## Measured baseline (till page, 15 Nov 2026)
- Tap card → cart row 1.0 s, totals 3.0 s: action 0.42 s server (10 SQL steps),
  then CartLine reload, Product image query, totals SUMIFS via evaluate-many,
  a 1 s gap, totals again.
- Page open ≈ 20 s: 7 sequential steps (main.js → auth refresh → Setup shell chunks →
  runtime chunks → page → page script → component files → data); 9 × 345 KB Smart
  renderers (each a full runtime copy); landing-bootstrap (350 KB, heavy DB) delays the
  page's own record reads (server 0.2 s, waited 3.4 s); ~14 popup pages preloaded at 0.8 s.
- Record reads 50–370 ms DB for tiny tables: EAV storage (one row per field value).

## Phases
1. **Load (done in PR "quick wins")**: shared Smart runtime on by default; popup page
   preload waits 4 s. Next: published apps skip landing-bootstrap / Setup shell;
   page + page script in one response.
2. **Tap = one round trip**: show the change at once (prediction), the action response
   returns the rows of every data source the action wrote plus the page's aggregates
   (computed in the same transaction); the client applies them, no reloads, no
   evaluate-many, no timers. Target < 100 ms visible, < 400 ms confirmed.
3. **Generated code**: formulas compiled to plain JS (no AST interpreter at run time);
   each action compiled to one server function = one SQL transaction.
4. **Storage**: shared real table per app object (Product, Cart, CartLine, …) with
   tenant_id and real columns + indexes for standard fields, plus one JSONB column for
   tenant-added fields (expression/trigram indexes for searched ones). Migrate from
   `md_records`/`md_record_values` object by object behind the record service API.

## Status (15 Nov 2026, evening)
Done (PRs #102, #103, this PR):
- `apps/server/src/page-compiler/code/formulaDictionary.ts`: every formula defined once with the
  code it becomes. Adding a formula = one entry there (+ its plain function in `formulaLibrary.ts`).
- On save/publish each page revision is converted (`pageCode.ts`): display formulas -> plain
  functions; each action -> ONE async function that the browser runs first on held rows (instant
  tap) and the server runs on SQL in ONE transaction (all or nothing; the clicked row is re-read
  from SQL). The server returns the saved rows and fresh "record sets" (open cart + its lines).
- Totals over rows on screen (SUMIFS over the open cart) run in the browser: no evaluate-many.
- Popup pages load only when first opened; Smart library + index load with page open.
- Page file served by build id with immutable caching (repeat opens need no page-file request).

Not done yet:
- Old run-time formula engine (FieldExpression interpreter, evaluate-many, compiled-actions
  interpreter path) is still present for formulas/actions the converter does not cover yet
  (EMAIL/SMS/WHATSAPP/WAIT/LOCATION/RECORDPAYMENT/CREATEPDF steps, COLLECTION/TABLE criteria
  forms, Flow/Navigate bindings). Remove once every page converts (see `codeIssues` in each page file).
- Published apps still load the Setup shell and landing-bootstrap (358 KB).
- Storage: real per-object tables (tenant_id, typed columns, JSONB extras, pg_trgm) not started.
