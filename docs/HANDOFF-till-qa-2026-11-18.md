# Smart Till QA — handoff (18 Nov 2026)

Owner's remarks: QA list of 18 Nov (product edit, totals, FORMULAERROR, cash count, etc.).
Everything below marked DONE is merged, deployed and was tested on the live till.

## How till pages are edited (no UI clicking needed)
Till pages live in the DB (Page Builder), Custom layout. Supported bulk path:
1. `GET /api/metadata/pages/:page/inventory?variant=Custom` → CSV (`pageapi,component_type,component_name,propertyid,value,layout`).
2. `POST /api/metadata/pages/inventory/batch/validate` `{csv,variant:'Custom'}` → `draftRevisions`.
3. `POST /api/metadata/pages/inventory/batch/apply` `{csv,variant,expectedDraftRevisions}` (writes drafts).
4. `POST /api/metadata/pages/:page/layouts/Custom/publish` `{}`.
Bearer token: `POST /api/auth/refresh` (cookie) → `access_token`.
Adding components: `GET …/layouts/Custom/editor` → edit `page.components` → `PUT …/layouts/Custom/draft` → publish.
Deploy: `POST /api/platform/production-deployment {expectedCommit}` after merge (latestCommit must equal it).

Gotchas found:
- Steps after `CONFIRMSCREEN(...)` cannot use variables from before it: `GETRECORD` again inside the Yes actions.
- A filter like `@Obj.Field = TRUE` alone is read as a *list binding* by `usePageCollectionFormula` (every string
  property is scanned). Use `AND(a, b)` with two conditions. Single-arg `AND(x)` returned no rows.
- `SUMIFS/COUNTIFS` criteria are equality only (plus wildcards and whole-day dates); no `">="`.
- In one label, `FORMAT(@Invoice.CreatedAt, "DD/MM/YYYY HH:mm")` showed FORMULAERROR while
  `FORMAT(x,"DD/MM/YYYY") & " " & FORMAT(x,"HH") & ":" & FORMAT(x,"mm")` works. Not yet root-caused.
- Text inputs have no formula default: fill them in the popup's start action (`@ThisPage.X.Value = rec.Field`).

## DONE (live, tested)
- Code: #183 `FORMAT()`; hidden Smart components no longer swallow taps; Lock explains PIN sign-in.
  #185 popups always close (background tabs), email values are literal. #186 `CASHMOVE()` server action.
- Product edit: prefilled fields, real category names (filter `AND(Active, IsVisiblePOS)`), save works,
  negative price blocked, new products Active, booleans saved as booleans.
- Till: 15 category tabs (`tabCount` 20 + filter), subtotal before discounts, "1 item", all money `FORMAT(…,"£0.00")`.
- Payment: +£10/£20/£50 add; change preview; Card opens without a reader; "Exact / Card paid" → confirm →
  `PaymentStatus=Approved, PaymentReference="Card machine (manual)"`.
- Sales: list/detail times from `CreatedAt`; totals and count follow Today/Yesterday/All; no FORMULAERROR.
- Customers: totals computed in labels (`InvoiceType` is INV/SRN, not "Sale"); prefilled edit; phone/email checks;
  picker searches from 3 characters.
- Customer display: "Use as display" hidden once paired; bigger text; Discount header only when a discount exists.
- Dashboard: Gross/Average today correct.

## NOT DONE (next, in this order)
1. **Cash count page** (`smart_till_cash_count`): replace the cart/denomination flow with
   Open (float into `cash_count__c` Opening, `Name="Open"`), Cash in/out (`CASHMOVE("IN"|"OUT", amt, reason, sessionId)`),
   Close (Expected = float + `SUMIFS(Invoice, Total, Payment_Method__c,"Cash", InvoiceDate, day)` [INV+SRN] +
   `SUMIFS(CashLedger, Amount, TillSession, id, Direction,"IN")` − OUT; create Closing count with expected/difference;
   set Opening `Name="Closed"`). Needs 2 buttons + reason input added via editor JSON. Check PR #184 (Till → Named Device) first.
2. **Split payment**: one `Payment`/`RECORDPAYMENT` per tender; payment screen shows remaining.
3. **Stock adjustments**: new object (Product, Quantity ±, Reason, User, Date) feeding `StockLevel`; +/− on Inventory cards.
4. **Build Your Own options**: picker popup from `MealChoiceOption` (ChoiceGroup) when a product has choice groups.
5. **Category order**: record API + `smart_tabs` have no sort; add a sort property (metadata + ribbon + runtime).
6. **Refunds**: partial (pick lines/qty); manager as a pick list; show "PIN not accepted" only after an attempt.
7. Sales staff column (Invoice owner); Products search live (same `smart_search` as till; Products filter is `OR(Name*, Barcode*)`).
8. Visual audit (colours/layout) needs the browser pane visible; verify held-sales Resume by a real tap.
