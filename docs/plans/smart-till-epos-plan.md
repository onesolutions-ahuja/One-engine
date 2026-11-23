# Smart Till vs Epos Now: plan and status

One file for the whole plan. Updated page by page. Source research: Codex notes in
`C:\Users\cc\Documents\Codex\2026-11-22\a-x20\outputs\epos-full\` (Epos Now support guides and videos).

## Rules (agreed 22 Nov 2026)
- We copy **features**, not Epos Now's look. Our look: macOS style with a dock bar.
- Use existing Smart components and formulas. A new component or formula only if it is a must, and we agree it first.
- No till-only objects. Anything new is generic so other apps (kiosk, service...) can use it.
  - Example: ingredients are `ProductBOM`; the till only labels them "Ingredients".
- No duplicate data. Currency, company name, VAT etc. are read from Company Settings (`@ThisTenant.Company.*`).
- The till only reads and updates Object Manager and tenant data through formulas: actions, SCREEN, PRINT, CALLOUT, EMAIL, WHATSAPP...
- Order of work: plan each page here, agree it, then make the CSV, then test.
- Claude: planning and code (opens the PR, stops there). Owner: merge, CI, deploy.

## Till from attached devices (22 Nov)
- Browser: the till asks "Which till is this?" after login (kept for now, BYOD).
- Installed apps (Android/Windows) must report attached devices: see `docs/APP-BUILD-CHECKLIST.md`. A Named Device with **Attached to Till** then picks the Till automatically.
- Chrome: could list a USB/serial device after a one-time Allow (later).

## Priorities
| # | Feature | Priority | Status |
|---|---------|----------|--------|
| 7 | Cash-up / end of day | P0 | Exists (`smart_till_cash_count`), improve |
| 8 | Cash in / out, petty cash | P0 | Exists, improve |
| 9 | Refund an old sale | P0 | Exists (sale detail popup), improve |
| 10 | Receipt choice and receipt settings | P0 | New |
| 14 | Ingredients (`ProductBOM`) | P0 | New |
| 11 | Voids and refunds list | P1 | New |
| 12 | Staff roles and permissions | P1 | New |
| 6 | Reports like X/Z | P2 | Extend |
| 13 | Gift cards | P2 | New |
| 1-5 | Hospitality (tables, order type, modifiers, kitchen print, tips) | Last | Modifiers already exist |
| 15 | Customer feedback | Dropped | |

## Open decisions
- Code gap: formulas read only `@ThisTenant.Company.Id/Name/Logo`. Need all Company fields + currency, and a
  Receipts section in Company Settings. One PR.
- Reasons: DECIDED picklist field on each object (owner, 22 Nov): InvoiceLine.RefundReason, InvoiceLine/CartLine.DiscountReason, CashLedger.Reason (petty cash, no sale, float). Return to stock = checkbox on the return line, ticked on the refund layer (picklist values cannot carry it).
- Cash-up count: DECIDED from Codex fix-report — like Epos Now, one counted total per payment type (Cash, then Card, NEXT, DONE, Close till confirm). No notes/coins screen.

## Page 1: Till sale screen
### Epos Now has, we have
Categories, product grid, search, scan, cart, line and basket discount, option picker (multiple choice products),
customer select, hold / resume, split payment, cash / card / PayPal, clear sale, lock, customer display, cash drawer.

### Epos Now has, we don't (owner to decide)
| Feature | What it does | Our way (existing parts) | Decision |
|---------|--------------|--------------------------|----------|
| Misc product | Sell an item not in the list: type name + price | Numpad popup → CREATERECORD CartLine | Yes |
| Quick add product | Create a product from the till | Product edit popup we already have, opened from till | Yes |
| Line note | Free note on a line ("no ice") | Textbox popup → UPDATERECORD CartLine.Note | Skip |
| Popup note | Product shows a prompt when added ("Offer warranty?") | Product field `PopupNote` → INFOSCREEN on add | Yes |
| Discount reasons | Pick a reason (with default %) when discounting | Reason list (see open decisions) | Yes |
| No Sale | Open drawer with no sale, with reason | Drawer action + log record | Yes |
| Age check | Product with age limit asks "Customer over 18?" | Product field `AgeRestriction` → CONFIRMSCREEN | Have (cart check) |
| Eat in / take away price | Different price and VAT for take away | Product fields `EatOutPrice` + order type on cart | Yes |
| Variable price | Price typed at the till | Product field `VariablePrice` → numpad on add | Yes |
| Weighed items | Sell by weight (scale) | Product type Weighed + qty decimal; scale device later | Yes |
| Variable barcodes | Price or weight inside the barcode | Barcode parse formula | Skip |
| Container fee (DRS) | Adds deposit to bottles | Product field `ContainerFee` → extra line | Skip |
| Promotions | Buy 3 for £12 | Skipped earlier | Skip (earlier decision) |
| Price schedule | Happy hour prices by day/time | Price band object + IF(time) | Skip |
| Tip / gratuity | Add tip £ or % at pay | Hospitality (last) | |
| Card surcharge | Extra % for card | Company setting + formula | Yes: Company setting on/off + % |
| Pay by link | Send pay link by email/SMS | CALLOUT to payment connector + EMAIL/SMS | Have (QR on screen, email, WhatsApp) |
| Clock in / out | Staff clock in at till | We use login trace (decided) | Have (login trace) |
| Print last receipt | Button reprints the latest sale (even with auto-print off) | PRINT(template, last invoice) | Add (Codex fix) |
| Auto-print on/off | Till setting: print receipt after every sale | Company/till setting read in pay action | Add (Codex fix) |
| Customer credit / account | Pay later, balance on account | Customer balance field | Yes: generic credit management (limit, balance) for any app; plan as own page |

## Page 2: Payment screen (draft)
### We have
Cash with +£10/£20/£50, change preview, card (manual / reader), split payment, PayPal QR, pay by link.
### Epos Now has, we don't
| Feature | What it does | Our way | Decision |
|---------|--------------|---------|----------|
| Custom payment types | Voucher, cheque, "Other", grouped in reports | Picklist values on Invoice/CashLedger Method; buttons from list | Skip |
| Cash rounding | Round cash total to 5p/10p | Company setting + ROUND formula | Yes |
| Pay with customer credit | Use account balance as a payment | Credit management (generic) | Yes |
| Receipt choice after pay | Paper / email / both / none | P0 item 10 | P0 |
| Tip at pay | £ or % tip | Hospitality (last) | Last |
| Pre-auth on tab | Hold card on open tab | Hospitality (last) | Last |

## Page 3: Sales list (draft)
### We have
List + detail, Today / Yesterday / All, staff column, cash/card totals, refund from detail (lines or all, manager PIN).
### Epos Now has, we don't
| Feature | What it does | Our way | Decision |
|---------|--------------|---------|----------|
| Reprint receipt | Print an old receipt again | PRINT(template, invoice) button on detail | |
| Email / WhatsApp receipt again | Send an old receipt | CREATEPDF + EMAIL / WHATSAPP | |
| Find by receipt number / scan | Scan barcode on receipt to open the sale | smart_search on number; barcode on receipt template | |
| More filters | Date range, staff, payment type, device/till | smart_search + filter properties | |
| Refund reason per line | Reason + "return to stock" | Reasons list (open decision) | |
| Refund without receipt | Refund a product with no sale found | Refund mode on till cart (SRN with no original) | |
| Exchange | Refund + new item in one basket, pay/refund difference | Cart lines with negative qty → one SRN + one INV | |
| Void / delete log | Who removed lines or whole sales | P1 item 11 | P1 |

### Codex fix-report notes for page 3 (22 Nov)
- Refund = sale lines in the cart with quantity −1, a reason on every returned line, then Refund → pick the original payment type.
- With receipt: scan or type the receipt code; lines kept by the customer are deleted from the cart first. Without receipt: tap/scan product, set −1.
- Lost receipt: "Print historic" by date.
- Permission: role setting "Allow refunds" + "Refund limit" (amount). No manager PIN on every refund in Epos Now (ours keeps manager PIN).
- Reasons: ONE Reasons page with tabs Discount, Refund, No Sale, Stock Movement, Petty Cash; Name, Description, Return to stock; archive. → supports option A (one generic `Reason` object with a Type).
- Voids: "Delete current transaction? This action cannot be undone" (Cancel / Delete). Void/delete lines show on end of day and in an audit list.

## Page 3 DECIDED (22 Nov)
- Sales list = a report. Reprint, resend, filters, void log move to the Reports stage (last).
- Refund = a new **Refund layer** on the till page (pageLayer). Scan or type the receipt code, or scan items with no receipt.
  Lines show as −1 with a reason (picklist) and a Return to stock tick. Refund button: creates the SRN, posts the money back
  (cash moves the drawer via the ledger), prints the refund receipt. Exchange: add the new item on the same layer; Pay or Refund the difference.
- Permissions (generic, all apps): use existing **Custom Permissions** (profile / permission set). Examples: Till.Refund, Till.CashOut,
  Till.NoSale, Till.Discount, Till.Void. Who may change them for others = existing profile/setup rights.
  - Code gap: page formulas can't read them yet (only record validation `$Permission.X`). Add `@ThisTenant.Permission.Name` (TRUE/FALSE).
  - `@ThisTenant.Permission.Name` must work in EVERY app's page formulas (generic), not only the till.
  - Limits (owner, 22 Nov): number fields on **User** (e.g. RefundLimit, DiscountLimit, CashOutLimit), set from the till's
    Settings → Users page. Formulas compare the user's total today (SUMIFS) with the limit.
  - Code gap: `@ThisTenant.User.<any User field>` (today only fixed fields like Name, Manager). Server checks the limit too.

## Code PR (one PR, Claude opens, owner merges)
1. Company Settings: Receipts section (display name, VAT no., receipt message, refund days, show VAT breakdown,
   ask receipt choice, show barcode, QR link + caption, tip line, auto-print, card surcharge on/% , cash rounding on/step).
2. `@ThisTenant.Company.<any company field>` incl. currency.
3. `@ThisTenant.Permission.<CustomPermission>` TRUE/FALSE in all page formulas.
4. `@ThisTenant.User.<any User field>` (limits).
5. Check page inventory CSV (download/upload) carries `pageLayer`; add if missing.

## Page 4: Cash-up / end of day (draft)
### We have (`smart_till_cash_count`)
Open with float, cash in / out with reason (CASHMOVE), close: counted vs expected, difference saved, past closes list.
### Epos Now has, we don't
| # | Feature | What it does | Our way | Decision |
|---|---------|--------------|---------|----------|
| 1 | Float popup after sign-in | If no open session, ask float at once, Open till | Lock screen unlock action → SCREEN(cash count, float layer) | |
| 2 | Checklist before close | Lists held/open sales (tables later) with View to finish them | COUNTIFS on Cart/held; list + View button | |
| 3 | Count per payment type | Cash keypad → Next → Card (vs card machine Z) → Done | smart_numpad per tender, layer per step | |
| 4 | Blind close | Hide "Should be" from staff | Custom permission Till.BlindClose | |
| 5 | Note on close | Staff add a note, shows on report | Textbox → closing record Notes | |
| 6 | Summary tabs | Sales, Refunds, Voids, Tax, Credit + Cash / Card / Subtotal / Float / Total | smart_tabs + SUMIFS labels | |
| 7 | Print & close | "Are you sure you wish to close the till?" → prints Z report → back to lock screen | CONFIRMSCREEN → PRINT(Z template) → LOCKSCREEN | |
| 8 | Open drawer + completed sales | Buttons on the close screen | Drawer action; SCREEN(sales) | |
| 9 | Close can't be changed | Submitted close is final | Closing record read-only (validation rule) | |
| 10 | Permissions | Close till, Adjust float, Admin access | Custom permissions Till.Close, Till.FloatAdjust | |
| 11 | X report | Print totals so far, till stays open | PRINT(X template) | |
| 12 | Back office end of day report | Filters (date, till, staff) + breakdowns | Reports stage (last) | Later |