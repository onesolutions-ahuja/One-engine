# CLAUDE.md: how to work in this repo

Read first: `DEVELOPER_POLICY.md` (platform rules), `docs/HANDOFF-real-code-runtime.md` (page-code runtime,
deploy and measuring), `docs/real-code-runtime-plan.md`.

## The owner's rules (follow every time)
- Short answers. No long summaries or "stories". Plain words: the owner is not a coder.
- Do the work yourself (you have a signed-in built-in browser on unesolutions.co.uk). Do not hand tasks back.
- Build the best way, not a quick patch. If a better approach exists, say so up front and build that.
- One PR per piece of work. Do not add to a PR after saying it is ready.
- Never say "ready" before testing on the live site. Say exactly what was tested and what could not be.
- If something is truly unclear, ask one short question; otherwise decide and say what you decided.
- Before changing live business formulas (payments etc.), back up the pages and say what changes.
- Everything is generic for every app built in Page Builder (till, kiosk, displays...), never hardcoded to one app.

## Map
Server `apps/server/src`, web `apps/web/src`. Express + Postgres (SQL is the source of truth).
- Records: `system-files/record-engine.ts` (create/update/remove; every write touches `md_records`),
  RBAC `system-files/rbac-engine.ts` (`allowed(tenant,user,resource,action)`, Object read = resource `<Object>`),
  schema `system-files/schema.sql`, upgrade-safe DDL in `system-support/system-migrations.ts`.
- Formulas: `expression-engine/` (parser, `ActionFormulas.ts` = ACTIONS/SCREEN plans, `screenLayer.ts`).
  Allowed shared formula modules for Smart bundles are listed in `scripts/component-catalog.mjs`.
- Page compile: `page-compiler/compilePage.ts` (data sources, scopes none/key/auto/mirror),
  page code `page-compiler/code/` (`formulaDictionary.ts` arity+help, `generateCode.ts`, `pageCode.ts`);
  server runner `system-support/page-code-runtime.ts`; routes `api/PageScriptController.ts`, `system-support/server.ts`.
- Browser runtime: `core/pages/PageCompiler/` (`CompiledPageRuntime.tsx` wiring, `compiledPageStore.ts` data layer
  `saved()`/`live()`, `compiledSourceLoader.ts`, `pageCodeRuntime.ts` instant taps + totals/sets,
  `mirrorLiveRefresh.ts` displays, `liveChanges.ts` live stream); views `core/pages/PageRuntime/pageRuntimeViews.tsx`.
- Page layers: `core/pages/PageRuntime/pageLayers.ts` (component property `pageLayer`; each layer is its own screen, only one shows; 0 = default);
  `SCREEN(page, [mode], [record], [layer 0-9])` any order after the page: `screenFormula.ts`.
- Page Builder: `core/builders/PageBuilder/editor/` (`usePageEditorState.tsx`, `usePageComponentActions.tsx`,
  canvas `canvas/PageCanvasStage.tsx`, Layers bar `canvas/PageLayerBar.tsx`). Page CSV: `system-support/page-inventory-csv.ts`.
- Screens (customer displays, any app): `system-support/screen-pairing-service.ts` (pair by 4-digit code, current sale,
  layers), web `core/authentication/PairedScreen/`, `core/authentication/TillDevice/deviceTill.ts` (device/mirror keys).
- Live changes: `system-support/live-changes.ts` (trigger on `md_records` NOTIFYs at commit; `GET /api/live-changes` SSE,
  RBAC-filtered per user). pg types are hand-declared in `system-support/pg-driver.d.ts`.
- Components: `apps/web/src/component-libraries/<name>/` (SmartComponent.jsx, component.json).

## Checks
- No npm install here. For bundle tests link esbuild once: `ln -s /opt/npm-tools/node_modules/esbuild node_modules/esbuild`
  and `@esbuild` the same way.
- Unit: `node --import tsx --test apps/web/test/<file>.test.ts`. Components: `npm run -s test:components`
  (has known old failures: compare the failing list with `origin/main`, never just the count). `npm run -s check`.
- Server system tests and builds need packages that are missing here: CI is the gate (both jobs must pass;
  a PR's component check compares against main). Postgres 16 is installed for SQL checks (start with pg_ctl, socket /tmp).
- PRs via REST (`gh api repos/onesolutions-ahuja/One-engine/pulls ...`); GraphQL is blocked.

## Live testing
- Site: https://unesolutions.co.uk. Till: `/une/apps/SMARTTILL/pages/smart_till_billing`;
  display: `/une/apps/SMARTTILL/pages/smart_till_customer_display?mirror=<till device key>`; pairing: `/display`.
- Measure with `Date.now()` in two tabs of the same browser (MutationObserver on the changed text). Background tabs
  are throttled: front the tab being measured. Smart Till data is dummy: test sales are fine.
- Never type passwords; if signed out, ask the owner to sign in.
