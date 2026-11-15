/** Revolut Merchant Connector: install-time metadata only; never package API keys. */
export default Object.freeze({
  "folder": "revolut",
  "appApi": "RevolutConnector",
  "label": "Revolut Connector",
  "description": "Revolut Merchant API payments, orders and checkout (Sandbox by default)",
  "credential": "Revolut_API",
  "url": "https://sandbox-merchant.revolut.com/",
  "allowedUrls": ["https://merchant.revolut.com/"],
  "auth": "Bearer",
  "header": "",
  "fields": [
    {"apiName":"public_testPath","label":"Connection test path (read-only)","required":true,"defaultValue":"api/orders"},
    {"apiName":"public_testHeaders","label":"Connection test headers","required":true,"defaultValue":"Revolut-Api-Version: 2026-08-17"}
  ],
  "operations": {
    "ListOrders":{"method":"GET","path":"api/orders","headers":"Revolut-Api-Version: 2026-08-17"},
    "CreateOrder":{"method":"POST","path":"api/orders","headers":"Revolut-Api-Version: 2026-08-17"},
    "GetOrder":{"method":"GET","path":"api/orders/{!OrderId}","headers":"Revolut-Api-Version: 2026-08-17"},
    "CaptureOrder":{"method":"POST","path":"api/orders/{!OrderId}/capture","headers":"Revolut-Api-Version: 2026-08-17"},
    "CancelOrder":{"method":"POST","path":"api/orders/{!OrderId}/cancel","headers":"Revolut-Api-Version: 2026-08-17"}
  },
  "docs": "https://developer.revolut.com/docs/api/merchant",
  "notes": "Use a Revolut Merchant Secret API key, never the public SDK key. Sandbox is selected by default; for an approved live Merchant account change the credential Base URL to https://merchant.revolut.com/ and use a separate live secret. For CreateOrder supply JSON amount in minor currency units (500 means GBP 5.00) and currency. Store the order id and checkout_url from the response; confirm payment using GetOrder before fulfillment. GetOrder, CaptureOrder and CancelOrder require an OrderId Flow resource. CaptureOrder requires a previously authorised manual-capture order and a JSON body with amount. Do not use real cards in Sandbox. The connector does not register or verify webhooks automatically."
});
