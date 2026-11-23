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
6. Ribbon → Others: a **Disabled** formula property on EVERY component (generic, like Visible), so no page-load action is needed.
   Parts inside a component (a selector's option, a list/table row button): a "Disabled when" formula per item, reading that item's record.
7. RBAC as system objects (option B, page 7): read + UPDATERECORD of a user's permission sets and custom permission grants,
   from any app's formulas; only users with system permission "Manage Users" may change other users; server enforces it.
8. Seed the till Custom Permissions + 3 permission sets (Till Cashier / Supervisor / Manager) and the User limit fields.
9. New Smart component smart_spacemap (page 10).
10. ~~Check page inventory CSV carries `pageLayer`~~ — DONE already (page-inventory-csv.ts has `pageLayer`, section Arrange).

## Page 4: Cash-up / end of day (draft)
### We have (`smart_till_cash_count`)
Open with float, cash in / out with reason (CASHMOVE), close: counted vs expected, difference saved, past closes list.
### Epos Now has, we don't
| # | Feature | What it does | Our way | Decision |
|---|---------|--------------|---------|----------|
| 1 | Float popup after sign-in | If no open session, ask float at once, Open till | Lock screen unlock action → SCREEN(cash count, float layer) | Yes |
| 2 | Checklist before close | Lists held/open sales (tables later) with View to finish them | COUNTIFS on Cart/held; list + View button | Skip |
| 3 | Count per payment type | Cash keypad → Next → Card (vs card machine Z) → Done | smart_numpad per tender, layer per step | Yes |
| 4 | Blind close | Hide "Should be" from staff | Custom permission Till.BlindClose | Yes (needs permission Till.BlindClose; rest of #10 later) |
| 5 | Note on close | Staff add a note, shows on report | Textbox → closing record Notes | Yes |
| 6 | Summary tabs | Sales, Refunds, Voids, Tax, Credit + Cash / Card / Subtotal / Float / Total | smart_tabs + SUMIFS labels | Dashboard (close screen keeps Cash/Card/Float/Total) |
| 7 | Print & close | "Are you sure you wish to close the till?" → prints Z report → back to lock screen | CONFIRMSCREEN → PRINT(Z template) → LOCKSCREEN | Skip |
| 8 | Open drawer + completed sales | Buttons on the close screen | Drawer action; SCREEN(sales) | Yes |
| 9 | Close can't be changed | Submitted close is final | Closing record read-only (validation rule) | Yes |
| 10 | Permissions | Close till, Adjust float, Admin access | Custom permissions Till.Close, Till.FloatAdjust | Later |
| 11 | X report | Print totals so far, till stays open | PRINT(X template) | Skip |
| 12 | Back office end of day report | Filters (date, till, staff) + breakdowns | Reports stage (last) | Later |

## Page 5: Ingredients — AGREED (22 Nov)
### What we already have (checked in repo, core-catalogue-objects)
- `ProductOptionGroup` / `ProductOption` / `CartLineOption`: customer CHOICES (size, add-ons, meal choice). Shared by till, kiosk, online, bookings.
- `ProductOption.OptionProduct` already links a choice to a real Product (e.g. "Extra cheese" → product Cheese), so a choice can use stock.
- `Product.AvailableOnPOS / OnKiosk / Online`: an ingredient is just a Product not sold on any channel.
- `StockAdjustment` (reason + qty) moves stock.
### Gap
Fixed make-up of a product (Latte = 200 ml milk + 18 g beans). Options are choices, not a fixed recipe, so keep them separate.
### Common name: `ProductBOM` (bill of materials, owner decided 22 Nov)
Same object, different label per app: till/kiosk "Ingredients", retail "Bundle items", service/repair "Parts", manufacturing "Components".
| Field | Type | Note |
|-------|------|------|
| Product | reference Product | the thing sold (Latte) |
| ComponentProduct | reference Product | the part used (Milk) |
| Quantity | number | amount used per 1 sold (200) |
| Unit | picklist | each, g, kg, ml, l (same list as Product.Unit) |
| Removable | boolean | customer may say "no onion" (skip deduction) |
| SortOrder, Active | | |
Plus on Product: `Unit` picklist (unit stock is counted in) and `ComponentCost` (roll-up: Σ qty × component cost → margin).
### How stock moves (no stock updated by hand)
- On sale complete: FOREACH sold line → FOREACH its components → CREATERECORD StockAdjustment (−qty × line qty, reason "Used in sale", invoice ref).
- Option with OptionProduct → same for that product (and its own components).
- Refund with "Return to stock" ticked → same, positive. Without tick → no stock back.
- Product with components: its own stock is not tracked (only the parts are).
- 512-token limit (FormulaTokenizer/Parser) counts the WRITTEN formula once, not each loop run; compiled page actions run as TS, so loops don't slow it. Only risk: a very long written action fails to save. DECIDED: keep 512. Build chat reports to owner only if an action hits the limit.
### Till UI
- Product edit popup → new tab "Ingredients": smart_table (part, qty, unit, remove ×) + "Add ingredient" (smart_lookup + numpad).
- Shows cost of ingredients and margin.

## Page 6: Receipt settings + receipt choice — AGREED, all 15 settings (22 Nov)
### Where: Company Settings → new "Receipts" section (no new object). Read with @ThisTenant.Company.<Field>.
| # | Setting | What it does |
|---|---------|--------------|
| 1 | Display name | Name on receipt (falls back to company name) |
| 2 | VAT number | Printed on receipt |
| 3 | Email, website | Printed on receipt (company profile already has them) |
| 4 | Logo | Company profile already has it |
| 5 | Receipt message | "Thank you for shopping with us" |
| 6 | Refund days | Refund layer warns/blocks after X days |
| 7 | Show VAT breakdown | VAT table on receipt |
| 8 | Ask receipt choice | Popup after pay: Paper / Email / Both / None |
| 9 | Auto-print | Print after every sale (else Print last receipt button) |
| 10 | Show receipt barcode | Barcode of receipt number, for scan-to-refund |
| 11 | QR link + caption | QR on receipt (review page, website, offer) |
| 12 | Show customer balance | Credit balance on receipt (credit management) |
| 13 | Group same items | 2 × Coke instead of two lines |
| 14 | Show item notes / options | Options printed under the item |
| 15 | Tip line | Printed tip line with suggested % (hospitality) |
### Receipt choice popup
Paper / Email / Both / No receipt. Email box pre-filled from customer; "Save email to customer" tick; Back / Done.
Email = CREATEPDF(receipt template) → EMAIL(connection, to, subject, body, pdf).
- Connection (owner, 22 Nov): the tenant's SMTP HTTP callout. Nothing hard-coded: Company Settings → Receipts gets
  "Receipt email connection" (pick from the tenant's connections, like the default payment provider).
- Email / Both buttons: enabled only when `CONNECTED(@ThisTenant.Company.ReceiptEmailConnection)` is TRUE, else greyed out.
  WhatsApp button the same with its own connection.
- Already possible: `@ThisPage.EmailButton.Disabled = NOT(CONNECTED(...))` in an action (page load). CONNECTED is allowed in Visible / Disabled / actions.

## Page 7: Staff roles and permissions — AGREED, option B (22 Nov)
### What already exists (repo: rbac-engine, md_* tables)
Profiles, roles, permission sets (+ groups), object CRUD rules, data scopes, system permission catalogue,
Custom Permissions (resource `CustomPermission:Name`), checked on the server in validation rules / flows as `$Permission.Name`.
### Mapping Epos Now → ours (no new objects)
- Epos "Staff role" = a **Permission Set** (e.g. Till Cashier, Till Supervisor, Till Manager), assigned to users.
- Each Epos tick = a **Custom Permission** in that set:
  Admin: Till_Admin, Till_Settings, Till_QuickAdd, Till_ManagerOverride, Till_PettyCash, Till_FloatAdjust, Till_NoSale, Till_Close, Till_BlindClose
  Stock: Stock_Send, Stock_Receive, Stock_Take, Stock_SeeExpected
  Sale: Till_Void, Till_Delete, Till_Clear, Till_Hold, Till_MiscProduct, Till_Tables, Till_RemoveFromTable, Till_NoServiceCharge
  Discount: Till_ItemDiscount, Till_BasketDiscount · Refund: Till_Refund · Customer: Customer_Select, Customer_List, Customer_CreditLimit
- Limits (decided): User fields RefundLimit, DiscountLimitAmount, DiscountLimitPercent, CustomerCreditMax.
### How it restricts (3 layers)
1. Screen: buttons hidden / disabled with `@ThisTenant.Permission.Till_Refund` (Visible / Disabled formula).
2. Server (real block): validation rule on the object, e.g. refund invoice: `NOT($Permission.Till_Refund)` → "You can't refund".
   Limit: refunds today + this one > `$User.RefundLimit` → error. Works even if someone bypasses the screen.
3. Object access: permission set object rules (e.g. cashier can't edit Product or Price).
- Manager override: no permission → ask a manager PIN (VERIFYPIN) of a user who has it.
### Managing roles from the till — DECIDED B
RBAC lives in setup tables, not records → UPDATERECORD can't change it today.
- A: till Staff page opens the existing Setup → Users / Permission Sets screens (no code).
- B: code: expose RBAC as system objects (User permission sets, custom permission grants) so any app's formulas can
  read and UPDATERECORD them; only users with system permission "Manage Users" may change others.

## Page 8: Customer credit / account — AGREED all 7 (22 Nov), generic for every app
### Already exists (repo)
- `Invoice` with `AmountPaid` and Status Issued / PartPaid / Paid (RECORDPAYMENT guard) → an unpaid invoice is money owed.
- `CashLedger` with `Customer`, TransactionType, Direction, Method, ReversalOf → every money in/out per customer.
- `Customer` object (shared by till, kiosk, quotations, appointments).
### Add (fields only, no new object)
| Where | Field | What |
|-------|-------|------|
| Customer | CreditLimit | Max they may owe (set by users with Customer_CreditLimit, max = $User.CustomerCreditMax) |
| Customer | AmountOwed | Roll-up: Σ (Invoice total − AmountPaid) where Status ≠ Paid |
| Customer | CreditBalance | Roll-up: Σ prepaid credit in − credit used (CashLedger, Method "Customer credit") |
| Customer | AvailableCredit | Formula: CreditLimit − AmountOwed + CreditBalance |
| Customer | AccountOnHold | Tick: stop new sales on account |
| CashLedger.Method picklist | "On account", "Customer credit" | new values |
| Invoice | DueDate | When on-account invoice must be paid (payment terms) |
### Flows
1. **Pay on account (pay later)**: payment button "On account" (shown only with a customer picked) → invoice stays Issued, nothing in the drawer.
   Server validation: AccountOnHold, or AmountOwed + this > CreditLimit → error, unless manager override ($Permission.Customer_CreditOverride).
2. **Pay off balance**: customer page → "Take payment" → amount → RECORDPAYMENT to oldest unpaid invoices first (cash/card as normal).
3. **Add credit (prepay / voucher)**: "Add credit" → amount + method → CashLedger IN, Method "Customer credit".
4. **Spend credit**: payment button "Use credit" (enabled when CreditBalance > 0) → CashLedger OUT "Customer credit".
5. **Refund to credit**: refund layer option "To customer credit" instead of cash/card.
6. **Statement**: print / email / WhatsApp a statement (Print Template: open invoices, payments, balance).
7. Receipt shows balance (receipt setting 12).
### Other apps
Quotations / service: invoice on account with due date. Bookings: deposits = add credit, then spend on the final bill.

### How Epos Now does it (Codex 97/44/157 + support pages; parts unverified, their Customer Credit article did not load)
- ONE number per customer: credit balance. Positive = in credit (prepaid), negative = owes.
- Staff set/edit the credit on the customer (Back Office Edit). Max credit limit is a role permission.
- Buy on credit: pay with the "Credit" payment type → balance goes down (can go negative = owes).
- Pay back: pick the customer on the till → "Add" → their balance shows as a line in the basket → Pay with cash/card.
  Partial pay: change that line's amount (unverified). Paid amount moves the balance up.
- Voucher: a customer record named with the voucher number, holding credit.
- Customer report filter: In credit / In debit / Both.
### Our version (DECIDED: same simple idea, plus correct invoices)
- One `Customer.Balance` roll-up from CashLedger (Method "Customer credit": IN adds, OUT takes away). Drop AmountOwed/CreditBalance split.
- Sale on account = OUT "Customer credit" (balance down) and the invoice is Paid by "Customer credit" → nothing left open, like Epos.
- Pay back (full or part, any amount) = cash/card IN to the drawer + IN "Customer credit" → balance up. Shown as a basket line "Account payment – {Customer}" editable amount.
- Limit: Balance after sale must stay ≥ −CreditLimit (server validation), else manager override.
- Statement = list of the customer's "Customer credit" ledger lines with running balance.
- DueDate on Invoice dropped for till (keep for quotation/service invoices on account later).

## Page 9: Gift cards — AGREED all 9 + GiftCard object (22 Nov), generic for every app
### How Epos Now does it (Codex 68 / 44 / 19)
- "Credit Notes" free app: sell a credit note for a value at the till, spend it later with the "Credit" payment type.
- Or a customer record named with the voucher number holding credit (workaround). VoucherCart add-on for online vouchers.
### Our version
- Gift card is not a customer, so: one generic object `GiftCard` (any app: till, kiosk, online, bookings):
  Code (unique, random, printed as barcode/QR), Balance (roll-up from CashLedger), InitialValue, ExpiryDate, Status (Active/Used/Expired/Cancelled), Customer (optional), Invoice (where sold).
- CashLedger: new reference `GiftCard` + Method "Gift card".
| # | Feature | How |
|---|---------|-----|
| 1 | Sell | Product "Gift card" (variable price, 0% VAT) → on sale: CREATERECORD GiftCard + ledger IN |
| 2 | Print / send | Print template with code + barcode; email / WhatsApp e-gift (CONNECTED check) |
| 3 | Spend | Pay → "Gift card" → scan/type code → uses up to the bill; shows "Left on card £x" |
| 4 | Part use | Balance stays on the card for next time |
| 5 | Check balance | Scan code → balance + expiry |
| 6 | Top up | Sell again onto the same code |
| 7 | Expiry | Company setting: months valid (blank = never); expired cards refused |
| 8 | Refund to gift card | Refund layer option (instead of cash/card) |
| 9 | No cash back | Server rule: gift card balance never paid out as cash |
- VAT (owner, 22 Nov): gift card sale has no VAT (product 0% / outside scope). When spent it is only a payment method, so the invoice items carry their normal VAT.

## Page 10: Hospitality — AGREED (23 Nov)
### Epos Now has (Codex 194, 29, 67, 39, 213, 75, 96, 114, 145, 37, 14, 203, 218, 111, 103, 52, 09, 110)
Tabs & Tables screen, seats/covers per table, move / merge / move part of a table, table status stages (name, alert time, colour),
table timer, courses + course firing, order printing by category to kitchen printers (copies per channel), resend order,
void ordered items (permission), KDS (paid: routing, timers, recall, move ticket), gratuity £/% + service charge % (auto at N covers),
tronc report, pre-auth card on tab, dining option Eat in / Take away / Delivery.
Online: NOT direct to Uber Eats / Deliveroo / Just Eat — via paid aggregators **Deliverect** or **Otter** (menu sync, orders in, auto-print),
plus FoodHub, Order & Pay (Otter, Mr Yum), OpenTable bookings, own web shop.
### Our plan
| # | Feature | Our way | Decision |
|---|---------|---------|----------|
| 1 | Order type on sale | Cart.OrderType picklist Eat in / Take away / Delivery / Collection (price from page 1) | |
| 2 | Tables | Generic object `ServicePoint` (Type: Table / Room / Chair / Bay; Name, Seats, Area, Status, PosX, PosY) — till label "Table"; bookings can reuse | |
| 3 | Tabs | Cart with a Name (no table) | |
| 4 | Open table + covers | Cart.ServicePoint + Covers | |
| 5 | Send to kitchen ("Order") | CartLine.Status Ordered + kitchen print | |
| 6 | Move / merge / move part | UPDATERECORD lines to another table's cart | |
| 7 | Split bill | By item, by seat, equal parts | |
| 8 | Bill print (pre-bill) | PRINT bill template before pay | |
| 9 | Table status + timer | Status picklist + alert minutes + colour; minutes since seated | |
| 10 | Courses + fire course | CartLine.Course; "Fire course 2" prints that course | |
| 11 | Kitchen printers by category | ProductCategory.OrderPrinter → Named Device; copies per order type | |
| 12 | Resend / void ordered | Resend button; void ordered needs Till_Void (page 7) | |
| 13 | Service charge | Company setting % + covers to start; Till_NoServiceCharge to remove | |
| 14 | Tips / gratuity | Pay screen tip £ / % → separate line (no VAT); tronc in reports | |
| 15 | KDS | Our own page on a tablet: order lines by status, timers, bump/recall (no new component) | |
| 16 | Pre-auth on tab | Card provider connector (later, per provider) | |
| 17 | Order & pay at table | Our kiosk app on phone via table QR (shares objects) — no Mr Yum needed | |
| 18 | Table bookings | Reuse appointments app with ServicePoint | |
| 19 | Floor plan view | New generic component `smart_spacemap` | Yes (approved 23 Nov) |
### Delivery apps (Uber Eats, Deliveroo, Just Eat)
- Owner (23 Nov): connect DIRECT to Uber Eats, Deliveroo, Just Eat. No Deliverect / Otter.
  Une applies once as a POS integration partner with each platform (Uber: written approval; Deliveroo: POS API + developer portal);
  each tenant saves its own Named Credential (keys / store id) — no OAuth screen. One connector app per platform (Uber Eats, Deliveroo, Just Eat).
  Note: if a platform only issues keys to the approved partner, the credential holds Une's partner keys + the tenant's store id.
- Out: HTTP callouts (Named Credential) — menu sync (products, categories, options, prices), item on/off (out of stock), order status (accepted / ready / rejected).
- In: aggregator webhook → `/api/inbound-webhooks/{id}` → IncomingWebhook record (exists) → record-triggered Flow creates the order:
  Invoice/Cart with Channel (Uber Eats / Deliveroo / Just Eat), OrderType Delivery, paid online, Status New → kitchen print.
- Till: "Online orders" panel: New → Accept (prep time) / Reject → Ready; each step CALLOUTs the status back.
- Later, if we become a direct partner: same pattern, one connector per platform.
- DECIDED (owner, 23 Nov): no JSONVALUE. Each connector app ships its own field map (formulas), set once per app.
  Platform part: generic **webhook mapping** on the inbound endpoint (setup, no formula):
  raw body always kept on IncomingWebhook (nothing lost); a saved map says which payload values go to which fields, and the
  item list becomes child records (IncomingWebhookLine: Name, Qty, Price, Options, Notes, ExternalId). Flow then reads normal records.
  Same map works for payments, WhatsApp, any provider. Code PR item.
- Platform gaps to agree: floor plan drag (#19) needs a component property for free x/y placement; KDS auto-refresh (live update).

### Delivery webhooks — DECIDED (owner, 23 Nov)
- Provider webhook → IncomingWebhook record (exists, raw message kept).
- Each small connector app (Uber Eats, Just Eat, Deliveroo, …) installs: its Named Credential + its own record-triggered Flow.
- Flow: if IncomingWebhook is from that provider → create the order + order lines in OUR objects, Source = Uber Eats / Just Eat …
- Pages show those order objects filtered / labelled by Source. New platform = new small connector app, nothing else changes.
- No code gap: Flow already has HTTP Callout, Parse JSON, Loop, Transform and Create Records nodes. Build chat only checks the Loop can walk the items list.
- Objects: existing **Order / OrderLine** (owner), Source = Uber Eats / Just Eat / Deliveroo / Till.

### Tables process (Epos Now flow, our components, macOS style) — draft
**Screen "Tables"** (dock icon). Top: area tabs (smart_tabs: Restaurant, Bar, Patio, Tabs) + "+ New tab" button.
Body: table cards (Name, seats, covers, £ total, minutes seated, status pill colour:
Free grey · Seated blue · Ordered orange · Bill purple · Needs cleaning green). Timer turns red after the status alert minutes.
Right panel (selected table): its items and buttons Open · Send · Bill · Pay · Move · Split.
1. Tap a free table → covers keypad (smart_numpad) → sale screen with a banner "Table 5 · 4 covers".
2. Add items → **Send**: lines become Ordered, go to kitchen printer / KDS, screen goes back to Tables.
3. Tap a busy table → its order opens (resume). New items show as "not sent" until Send.
4. **Move / merge**: pick target table (all items). **Move part**: tick items + qty, then target.
5. **Bill**: prints the pre-bill, status Bill.
6. **Split**: by item / by seat / equal N ways → each part paid on its own.
7. **Pay**: normal payment screen (+ tip, + service charge when covers ≥ setting). Table → Needs cleaning → Free.
8. **Courses**: each line has a course (1 Starter, 2 Main, 3 Dessert); **Fire course 2** sends only that course.
9. Void a sent item: needs Till_Void (or manager PIN), prints a void ticket to the kitchen.

### KDS process — draft
**Screen "Kitchen"** on a tablet (own page, login as kitchen user).
- Ticket cards in time order: table / tab / Uber Eats + order no., age timer (green → orange at X min → red at Y min),
  lines with options, notes and course. Colour strip by order type (eat in / take away / delivery).
- Tap a line = done (struck through). **Bump** = whole ticket ready → front sees "Ready" on the table / online order.
- Station filter (Kitchen / Bar, by category), Recall last bumped ticket, "All day" count (e.g. 6 × Burger).
- No gap: kitchen page = card grid on Order/OrderLine filtered Open; live changes from any device already update lists (pageLiveWiring).

### DECIDED A (owner, 23 Nov)
Kitchen and online orders need ONE source: tables use Cart today, delivery uses Order.
- **A (chosen)**: when a table presses Send, create Order + OrderLine (Source Till) — kitchen reads only Order/OrderLine.
- B: delivery orders become Carts — kitchen reads only CartLine.

### Hospitality list 1–18: all YES (owner, 23 Nov)
### Floor plan (#19) — proposal
- Epos Now: Back Office table plan editor (place tables by area, seats); till shows the plan, colour by status, tap to open.
- Ours: new generic Smart component **smart_spacemap** "Space Map" — APPROVED (owner, 23 Nov): records from any object with PosX, PosY, Width, Height,
  Shape (square / round / long), Rotation, Label, Colour formula, Badge formula (e.g. £ / minutes).
  Edit mode: drag / resize → UPDATERECORD positions. Use mode: tap → action formula. Area = filter.
  Reusable: salon chairs, hotel rooms, parking bays, event seat map.

#### smart_spacemap properties (ribbon, metadata-driven, same as other Smart components)
- Data: Object, Filter (e.g. Area), Sort. Field map: X, Y, Width, Height, Shape, Rotation, Label, Sub-label.
- Shape: Square, Rectangle, Round, Oval, Long bench, Icon (any icon from the icon library) — per record field or one fixed value.
- Look: Colour formula, Border formula, Badge formula (£ / minutes), Pulse when formula TRUE (e.g. late), font, radius, shadow (macOS theme).
- Background: plain / grid / image (room drawing), zoom to fit, snap to grid size.
- Mode: Edit (drag, resize, rotate → saves X/Y/W/H to the record; add / delete) or Use (tap → action formula; long-press → second action).
- Selected item publishes @ThisPage.<Name>.Selected.Id like other components. Live refresh as other lists.
- Uses: restaurant tables, salon chairs, hotel rooms, parking bays, warehouse bins, event seats, desk booking.