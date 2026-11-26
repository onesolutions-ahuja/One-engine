# Publish to code (agreed 26 Nov 2026)

Page Builder metadata is for designing only. **Publish turns each page into normal
hand-written-style code, and the app runs only on that code** (like an app a developer wrote).

## Rules
- Generated per page: `<page>.tsx` (UI with literal props), `<page>.css` (all colours, sizes,
  layout), `<page>.actions.ts` (each action: device steps + one server function),
  `<page>.data.ts` (one query per screen for exactly what it shows).
- The app is one package per published version, kept on the device (immutable cache).
  Opening a screen needs no page or component download.
- Screen steps (SCREEN, CLOSESCREEN, page values, look properties) run on the device at once;
  database steps go to the server as **one request, one transaction**.
- Same formula always gives the same code: one generator rule per formula, tested per formula.
- Loops become set-based SQL (`INSERT … SELECT`, `UPDATE … WHERE`); several COUNTIFS/SUMIFS
  of one action are one query. Only steps calling outside services (card reader, PayPal,
  printer) stay per item.
- A developer may edit the generated code; publishing from Page Builder regenerates it.
  The last 10 published versions of each page are kept (`<app>/versions/<page>/vN`);
  the 11th removes the oldest.

## Order (each step a PR, tested on the live Smart Till)
1. Generator: metadata -> page code files (TSX, CSS, actions, data) + 10-version store and download.
2. App package: build at publish, serve immutable, runtime renders the generated code (no page metadata at run time).
3. Device-first actions: screen/state steps instant, one server request per action.
4. SQL: set-based loops, combined aggregates, one round trip per action.
5. Convert all Smart Till pages; remove the metadata runtime path for published apps.

## Done when
On the live Smart Till: every screen opens without a server call, every button is one
server request, and nothing shows a loading message while using the app.
