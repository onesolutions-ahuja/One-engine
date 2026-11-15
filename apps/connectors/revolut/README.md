# Revolut Connector

Revolut **Merchant API** payments through UNE Engine's existing AppExchange, tenant-scoped
Named Credentials, Integration Connections and HTTP Callout Flow nodes. This package
contains no API keys and is Sandbox-first.

## Install and configure

1. Open **Setup → AppExchange → Revolut Connector** and install/activate it.
2. In **Settings**, edit the provisioned Revolut credential. The default Base URL is
   `https://sandbox-merchant.revolut.com/`; Authentication is **Bearer**.
3. Paste the **Secret Merchant API key** from Revolut's API Console into **Secret**
   (never the SDK/Public key) and save. It remains encrypted by Named Credentials.
4. Choose **Test Connection**. This is a read-only `GET api/orders`, with the
   `Revolut-Api-Version: 2026-08-17` header supplied from the public connector
   configuration. It does not create or charge an order.
5. If the test returns 401/403, check the key's environment and Merchant Orders
   permissions in the Revolut API Console before changing the connector.

## Flow Builder

Add **HTTP Callout**, choose the installed **Provider / Integration Connection**,
then one of the following operations. The editor and server supply the required
version header; no Flow stores the API key.

| Operation | Method | Relative path | Body |
| --- | --- | --- | --- |
| ListOrders | GET | `api/orders` | none |
| CreateOrder | POST | `api/orders` | JSON, e.g. `{"amount":500,"currency":"GBP"}` |
| GetOrder | GET | `api/orders/{!OrderId}` | none |
| CaptureOrder | POST | `api/orders/{!OrderId}/capture` | JSON, e.g. `{"amount":500}` |
| CancelOrder | POST | `api/orders/{!OrderId}/cancel` | none |

Amounts are in the currency's *minor units* (GBP 500 = £5). For operations using
`{!OrderId}`, create/populate an `OrderId` Flow variable or use an existing Flow
resource reference for the order ID. For capture, the order must have been
created with `capture_mode:"manual"` and be authorised.

Use synchronous HTTP Callouts and **Outputs for next steps** to pick `id`,
`state`, `checkout_url` and other fields from a sample order response.
Return the `checkout_url` to your application's checkout view; verify the
order on the server with GetOrder before fulfilling anything. Use a stable,
unique **Idempotency Key** for a payment attempt, especially if retrying.
Never interpret the checkout redirect alone as proof of payment.

## Go live

After the Revolut Merchant account is approved, replace the credential's **Base URL**
with `https://merchant.revolut.com/` and replace the Sandbox key with the
corresponding **Production Merchant Secret API key**. Both origins are explicitly
approved by the connector. Verify production access with a read-only test before
enabling live payment Flows.

Webhooks and provider-specific signature verification are **not** provisioned by
this package. It does not automatically register subscriptions or change order
records when webhooks arrive; use GetOrder server-side for state confirmation.
Live payments require appropriate permissions, fraud handling and operational controls.

Official API: https://developer.revolut.com/docs/api/merchant
Sandbox testing: https://developer.revolut.com/docs/guides/merchant/test-and-go-live/testing/sandbox-test-scenarios
