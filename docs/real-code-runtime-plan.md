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
