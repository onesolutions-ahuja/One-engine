# Publish to code (how it works)

Publishing a page writes its code files; an app with **Run app from published code** on
(App Manager) runs ONLY from those files - on the device and on the server.

## Files of a page layout (newest version runs; the last 10 are kept)
- `<page>.tsx` - the screen: one `<Smart id type name className …props />` per component, page order.
- `<page>.css` - positions (`left/top/width/height`) and look (`background`, `color`, `border`,
  `border-radius`, `font-size`, `font-weight`, `text-align`, `box-shadow`).
- `<page>.formulas.ts` - every display formula: `source` (the formula) and `run` (its code).
- `<page>.actions.ts` - every action: `flow` (as set in Page Builder) and `run` (its code). The
  device runs `run` at once; the server runs the SAME `run` in one transaction.
- `<page>.data.ts` - record sets the screen holds. `manifest.json` - page settings.
- Extra `*.ts` helper files may be added next to them and imported (`import {x} from './helpers'`).

In an action: the record API (`$.getRecord/$.create/$.update/…`: access checks, history and
live updates) or plain SQL in the same transaction: `await $.sql('… WHERE tenant_id = $1', [$.tenantId])`
(plain SQL does not check record access or announce live changes).

## The code folder on the server (OCI)
Set `UNE_PAGE_CODE_ROOT` to a folder on a disk kept across deploys (e.g. `/srv/une-code`):
- `<root>/<company>/<APP>/pages/<page>/<layout>/` - the code the app runs: edit here.
- `<root>/<company>/<APP>/versions/<page>/<layout>/vN/` - last 10 versions (copy one back to restore).
A saved edit is checked (builds for device and server, page compiles) and becomes the newest
version in ~1 s; the app runs it at once. If refused, `ERRORS.txt` in that folder says why and
the app keeps the last good code. Publishing from Page Builder writes new files over an edit.
The database keeps the same versions (also without the folder).

## Inside
Lossless: `readPageSource(generatePageSource(page))` gives the page back (test pageSourceRoundTrip).
App package (`md_app_packages`): every screen's files bundled by esbuild into one file the device
keeps; screens per layout chosen by the page routes' own rules; the device runs `Page()` and the
formulas/actions (`screenFromCode`). The server builds each screen's plan from the page read back
from the files and loads the screen's `.actions.ts`/`.data.ts` (`serverCodeFromFiles`).
API: `GET /api/metadata/pages/:page/code-versions[/:v/file?path=]`, `POST …/code-versions`
`{variant, baseVersion, files}`, `POST …/code-versions/:v/restore`, `POST /api/apps/:app/package/rebuild`.
