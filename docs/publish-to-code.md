# Publish to code (how it works)

Publishing a page writes its code files; an app with **Run app from published code** on
(App Manager) runs ONLY from those files.

Per page layout (`page_code` versions, last 10 kept, newest runs):
- `<page>.tsx` - the screen: one `<Smart id type name className …props />` per component, page order.
- `<page>.css` - positions (`left/top/width/height`) and look (`background`, `color`, `border`,
  `border-radius`, `font-size`, `font-weight`, `text-align`, `box-shadow`).
- `<page>.formulas.ts` - every display formula: `source` (the formula) and `run` (its code).
- `<page>.actions.ts` - every action: `flow` (as set in Page Builder) and `run` (its code).
- `<page>.data.ts` - record sets the screen holds. `manifest.json` - page settings.

Lossless: `readPageSource(generatePageSource(page))` gives the page back (test: pageSourceRoundTrip).

App package (`md_app_packages`): every screen's files bundled by esbuild into one file the
device keeps; screens per layout chosen by the page routes' own rules. The device runs
`Page()` and the formulas/actions code (`screenFromCode`). The server never runs the files:
it reads them as data and builds the plan and its own copy of each action from each `flow`.

Developer edits: `GET /api/metadata/pages/:page/code-versions[/:v/file?path=]`,
`POST /api/metadata/pages/:page/code-versions` `{variant, baseVersion, files:{path:content}}`
(saved as the newest version, checked, app rebuilt), `POST …/code-versions/:v/restore`.
Publishing from Page Builder writes new files over an edit (restore it from the last 10).
`POST /api/apps/:app/package/rebuild` builds code for every screen of an app (no republish).

Limits: an edited `run` changes what the device does at once; the database work is always
the server's own copy built from `flow` (tenant code never runs on the shared server). CSS
other than the declarations above is reported and not used.
