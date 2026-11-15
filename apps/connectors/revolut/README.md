# Revolut Merchant Connector

UNE Engine's Revolut Connector is installed from **Setup → AppExchange**. It
supports **on-screen embedded checkout with Revolut**, reliable signed webhook
payment status, and (separately) the generic HTTPS HTTP Callout operations.
**No application Flow definition is created or required for checkout.**

## 1. Configure credentials

1. Install/activate **Revolut Connector** in AppExchange.
2. In Settings, edit the provisioned HTTPS Named Credential.
3. Paste the matching environment's **Secret Merchant API key** in the encrypted
   Secret field (never add it to a Page, a public variable or Git).
4. Set the required public Configuration variables:

| Field | Purpose | Example |
| --- | --- | --- |
| Merchant public key | Revolut Web SDK public key | `pk_...` |
| Payment source Object API name | Tenant Object containing amount | `Invoice` |
| Amount field API name in major units | Must be an accessible numeric/currency field | `Total` |
| Currency ISO code | Currency for server-created orders | `GBP` |

These variables are stored as `public_checkoutPublishable`,
`public_checkoutRecordObject`, `public_checkoutAmountField`,
`public_checkoutCurrency` in the existing Named Credential configuration.
**The browser does not choose a price or a currency.** Instead, the server reads
the field of the authenticated user's authorised Record and converts it to the
provider's minor units. GBP 5.00 becomes 500 pence.

5. **Test Connection** performs a read-only Merchant GET; it never creates payment.
6. Choose **Register / reconnect webhook** under Signed Payment Webhook. The
   connector registers a public HTTPS callback with Revolut (reusing an existing
   registration for the same URL), securely saves Revolut's returned signing
   secret, and activates the verified callback.
7. For Production, update both Base URL to
   `https://merchant.revolut.com/` and both keys to their matching Production
   values. Never mix Sandbox keys with Production endpoints.

## 2. On-screen checkout, no Flow

In Page Builder add the standard **Revolut Checkout** component to a Page that
has a current record ID (`recordId` Page state). Publish the Page. A signed-in,
authorised tenant user will see Revolut's embedded checkout card/wallet widget
for the configured source Record. The server creates a Merchant order only
when the widget requests one, using an idempotent, unique attempt ID.

The widget does not declare success when the browser fires `onSuccess`.
It waits until its tenant-scoped receipt has status `completed`, which is set
by a verified `ORDER_COMPLETED` webhook. A browser closure does not erase the
backend receipt. The request and HTTP response never expose the encrypted
Secret Merchant key or webhook signing secret.

The component is currently for **authenticated UNE Engine Pages** with a
current Record. It is not a public guest storefront checkout or an automatic
Invoice/Cash Ledger posting integration. That needs separate, explicit
authorization and accounting requirements.

## 3. Webhook security and troubleshooting

The inbound webhook route reuses UNE Engine's central tenant-bound webhook event
archive, raw-body capture, one-time deduplication and Communication audit record.
For Revolut, it verifies HMAC-SHA256 over `v1.{timestamp}.{rawBody}` against
`Revolut-Signature`, and rejects stale timestamps more than five minutes away.
Only the installed, enabled credential and its approved callback can change
saved Revolut payment receipts. Other providers' webhook handling is unchanged.

Use a public HTTPS domain, an enabled connector and a Merchant key with
Orders and Webhooks API permissions. If connection testing succeeds but checkout
fails, verify the public key matches the same environment and the configured
Object/amount field is readable for the signed-in user.

## 4. Optional generic HTTP Callout operations

The connector still exposes ListOrders, CreateOrder, GetOrder, CaptureOrder and
CancelOrder through existing Named Credentials and Integration Connections. These
do **not** create any Flow definitions and are independent of the embedded
checkout widget.

Official:
- [Merchant Web SDK embeddedCheckout](https://developer.revolut.com/docs/sdks/merchant-web-sdk/payment-methods/embedded-checkout)
- [Merchant API](https://developer.revolut.com/docs/api/merchant)
- [Verify the payload signature](https://developer.revolut.com/docs/guides/merchant/monitor-and-observe/webhooks/verify-the-payload-signature)
