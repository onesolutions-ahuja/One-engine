# CLAUDE.md: how to work in this repo

Read first: `DEVELOPER_POLICY.md` (platform rules), `docs/HANDOFF-real-code-runtime.md` (page-code runtime,
deploy and measuring), `docs/real-code-runtime-plan.md`.

## The owner's rules (follow every time)
- Short answers. No long summaries or "stories". Plain words: the owner is not a coder.
- Put all related work in one PR. Do not open many small PRs, one per fix. Do not add to a PR after saying it is ready.
- If something is truly unclear, ask one short question; otherwise decide and say what you decided.

## Map
Server `apps/server/src`, web `apps/web/src`. Express + Postgres (SQL is the source of truth).
- Records: `system-files/record-engine.ts` (create/update/remove; every write touches `md_records`),
  RBAC `system-files/rbac-engine.ts` (`allowed(tenant,user,resource,action)`, Object read = resource `<Object>`),
  schema `system-files/schema.sql`, upgrade-safe DDL in `system-support/system-migrations.ts`.
- Formulas: `expression-engine/` (parser, `ActionFormulas.ts` = ACTIONS/SCREEN plans, `screenTarget.ts`).
  Allowed shared formula modules for Smart bundles are listed in `scripts/component-catalog.mjs`.
- Page compile: `page-compiler/compilePage.ts` (data sources, scopes none/key/auto/mirror),
  page code `page-compiler/code/` (`formulaDictionary.ts` arity+help, `generateCode.ts`, `pageCode.ts`);
  server runner `system-support/page-code-runtime.ts`; routes `api/PageScriptController.ts`, `system-support/server.ts`.
- Browser runtime: `core/pages/PageCompiler/` (`CompiledPageRuntime.tsx` wiring, `compiledPageStore.ts` data layer
  `saved()`/`live()`, `compiledSourceLoader.ts`, `pageCodeRuntime.ts` instant taps + totals/sets,
  `mirrorLiveRefresh.ts` displays, `liveChanges.ts` live stream); views `core/pages/PageRuntime/pageRuntimeViews.tsx`.
- Page layers are gone: a page's screens are the tabs of a Smart MultiPage (tab bar on or off). Each tab has a fixed id
  (property `pageIndex`, like an Excel sheet id; kept on rename/move, never reused). `SCREEN(page, [mode], [record], [MultiPage, tabId], [seconds])`
  any order after the page: `screenTarget.ts`, web `screenFormula.ts` + `multiPageScreens.ts`. `SCREEN(page, Pages, n)` only switches
  page where it shows (never leaves this screen); `SCREEN(page, current, Pages, n)` may open it here.
- Page Builder: `core/builders/PageBuilder/editor/` (`usePageEditorState.tsx`, `usePageComponentActions.tsx`,
  canvas `canvas/PageCanvasStage.tsx`, bottom bars `canvas/MultiPageBar.tsx` (tabs of the selected MultiPage + layout tabs) and `canvas/AppPageBar.tsx`). Page CSV: `system-support/page-inventory-csv.ts`.
- Screens (customer displays, any app): `system-support/screen-pairing-service.ts` (pair by 4-digit code, current sale,
  MultiPage tabs), web `core/authentication/PairedScreen/`, `core/authentication/TillDevice/deviceTill.ts` (device/mirror keys).
- Live changes: `system-support/live-changes.ts` (trigger on `md_records` NOTIFYs at commit; `GET /api/live-changes` SSE,
  RBAC-filtered per user). pg types are hand-declared in `system-support/pg-driver.d.ts`.
- Components: `apps/web/src/component-libraries/<name>/` (SmartComponent.jsx, component.json).
- Publish to code: `docs/publish-to-code.md` (`page-compiler/source/`: generate/read page code files, app package; web `core/pages/AppPackage/`).

## Checks
- No npm install here. For bundle tests link esbuild once: `ln -s /opt/npm-tools/node_modules/esbuild node_modules/esbuild`
  and `@esbuild` the same way.
- Unit: `node --import tsx --test apps/web/test/<file>.test.ts`. Components: `npm run -s test:components`
  (has known old failures: compare the failing list with `origin/main`, never just the count). `npm run -s check`.
- Server system tests and builds need packages that are missing here: CI is the gate (both jobs must pass;
  a PR's component check compares against main). Postgres 16 is installed for SQL checks (start with pg_ctl, socket /tmp).
- PRs via REST (`gh api repos/onesolutions-ahuja/One-engine/pulls ...`); GraphQL is blocked.

## Live testing

## Installed apps (Android / Windows)
- Building or changing an installed app: follow `docs/APP-BUILD-CHECKLIST.md`. The app must set `window.__uneDeviceKey` and `window.__uneAttachedDevices` at start-up, or tills keep asking "Which till is this?".
