# Smart Till QA — handoff (18 Nov 2026, updated 19 Nov)

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

## DONE 19 Nov (the old NOT DONE list), all live unless marked
1. **Cash count** (`smart_till_cash_count`, rebuilt). Open with a float, then Cash in and Cash out with a reason
   (`CASHMOVE`), then Close. Close compares Counted with Expected and saves a Closing count with
   expected and difference. Below that is a list of past closes.
   - Expected = float + cash sales since opening + cash in − cash out.
   - Cash sales = today's `CashLedger` Cash receipts + today's cash SRN refunds. The ledger is used so a split sale
     counts only its cash part.
   - The Opening record's `expected_amount__c` holds the cash already taken earlier that day when the till opened.
     Expected subtracts it, so a second session in the same day doesn't count earlier sales.
   - The open session is the Opening record with `Name="Open"` for `@ThisPage.Till.Name`. It still works after
     #184 (the Till became a POS Terminal Named Device).
2. **Split payment** (payment popup). Type an amount, then tap **Cash part** or **Card part** (card asks
   "Did the card machine take £x?"). It shows Paid and Left to pay. **Complete split sale** posts one
   `RECORDPAYMENT` per tender and puts "Split: cash £a, card £b" in Notes. The invoice method is the
   larger tender. Card parts are for a separate card machine only, not the integrated reader.
3. **Stock adjustments**. New object `StockAdjustment` (Product, Quantity ±, Reason, Notes, AdjustmentDate) and a
   roll-up `Product.AdjustedQty`.
   - Changing the `StockLevel` formula is refused ("needs a metadata migration"), so each adjustment
     also moves `Product.OpeningStock` by the same quantity. `StockLevel` is then correct at once.
   - Inventory cards have −1 / +1 (reason "Stock count") and **Adjust**, which opens the new
     `smart_till_stock_adjust` popup (keypad, reason, notes, history).
4. **Option picker** (`smart_till_options`). This data has `ProductOptionGroup`/`ProductOption`/`CartLineOption`;
   there is no MealChoiceOption.
   - Tapping a product with active groups opens the picker: groups on the left, options on the right.
     In a required group (MinimumChoices ≥ 1) you pick one; optional groups allow several; tap again to remove.
   - The line is created at open with `Status="Building"`. **Add to sale** checks the required groups, prices it
     at base + extras, names it "Product · option · option" and sets it to Open. **Cancel** deletes it.
5. **Category order**: needs code. **PR #188** adds `sortField`/`sortDirection` on page data sources and
   "Sort records by" in the Filter Records dialog. **After it is deployed:** set CategoryTabs → sort by
   `SortOrder`, then save and publish the till page so it recompiles.
6. **Refunds** (sale detail popup).
   - Tap a line to select one unit, or **Select all**. The selection is stored as InvoiceLines with
     `ReturnNumber="SELECTED"` and `LineType="Training"`, so stock doesn't move and no number is used.
   - Manager is chosen from a list (User). **Refund selected** checks the PIN, then creates the SRN (Status Refunded),
     moves the selected lines onto it (LineType Return), and marks the original Refunded or Part Refunded.
     Amounts are scaled by the sale's basket discount.
   - "PIN not accepted" appears only after an attempt. **Not tested with a real PIN** (I don't enter PINs):
     please do one real partial refund.
7. **Sales**: new `Invoice.StaffName` text field, set from `@ThisPage.User.Name` on every sale and refund (blank for old sales).
   - The Staff column shows it. The first column reads "INV-6 · Card" (with ↩ for refunds), and cancelled
     invoices are hidden.
   - Cash/Card totals now read `CashLedger` receipts + SRN refunds, so split sales count correctly.
   - Products search as you type already worked (from 3 letters, after 250 ms).
8. **Visual pass and real taps** in the browser pane: held-sales **Resume works by real tap**.
   - PayPal button contrast fixed (#0070BA, white text).
   - Lists no longer use cart column 3 (it is the quantity column and misplaces text).
   - Option and stock-history lists use `smart_table`, because the cart drew rows behind the grid at popup size.

**PR #188 (waiting to merge and deploy)**: `CASHMOVE`/`RECORDPAYMENT` now report their CashLedger row in the action's
`changes`. Until it is deployed, the cash-count list and totals update only after a reload (the posting itself
works). It also adds the sort for item 5.

### More gotchas (19 Nov)
- A hidden page value called `till` clashes with `@ThisPage.Till`: name it `tillName`.
- `TRIM` is not supported in action formulas. `GETRECORD` with no match leaves `x.Id` blank (test `ISBLANK(x.Id)`).
- Each action formula has a **512-token limit at run time**: compute a value once, then read it back from the saved record.
- Aggregates inside an action are **re-read after each write**: make a formula give the same answer before and after its own writes.
- New popup pages: `POST /api/metadata/pages` with `layoutVariant:"Desktop"` creates both variants. The popup is
  served from **Desktop**, so edit both Desktop and Custom.
- Invoices can't be deleted (set Status Cancelled). CashLedger rows are immutable.
- smart_label inlines a date-time value into its formula text (`FORMULAERROR: Unsupported character ":"`). Set the text
  from a start action instead. A value that starts with digits and "/" (e.g. "18/11/2026") is also taken for a
  formula, so prefix it with a word.
- `@User.*` fields can't be used in page filters (no User metadata), and `User` lookups in `CREATERECORD` from page
  code fail ("Invalid relationship: User"). Use `OwnerId` or a text field.
- On a page that has only just loaded, typing straight away in a search can be overwritten by the initial load
  finishing late. This is a minor runtime race.

### Still open
- Manager PIN on the refund popup is a plain text field (visible while typing). Use a masked keypad like `smart_till_manager_pin`.
- Production test data left from QA: sale INV-6 (£1.98 split), plus a few cash-in/out ledger rows in a closed session.
  The two test closes were moved to till "Till 1 (QA test)".
