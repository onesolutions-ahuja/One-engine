/** Revolut Merchant Connector: install-time metadata only; never package API keys. */
export default Object.freeze({
  "folder": "revolut",
  "appApi": "RevolutConnector",
  "label": "Revolut Connector",
  "description": "Revolut Merchant API payments, orders and checkout (Sandbox by default)",
  "providerType": "Card Terminal",
  "credential": "Revolut_API",
  "url": "https://sandbox-merchant.revolut.com/",
  "allowedUrls": ["https://merchant.revolut.com/"],
  "auth": "Bearer",
  "header": "",
  "fields": [
    {"apiName":"public_testPath","label":"Connection test path (read-only)","required":true,"defaultValue":"api/orders"},
    {"apiName":"public_testHeaders","label":"Connection test headers","required":true,"defaultValue":"Revolut-Api-Version: 2026-08-17"},
    {"apiName":"public_checkoutPublishable","label":"Merchant public key (pk_...) for embedded checkout","required":true,"defaultValue":""},
    {"apiName":"public_checkoutRecordObject","label":"Payment source Object API name (for example Invoice)","required":true,"defaultValue":""},
    {"apiName":"public_checkoutAmountField","label":"Amount field API name in major units (for example Total)","required":true,"defaultValue":""},
    {"apiName":"public_checkoutCurrency","label":"Payment currency ISO code","required":true,"defaultValue":"GBP"}
  ],
  "operations": {
    "ListOrders":{"method":"GET","path":"api/orders","headers":"Revolut-Api-Version: 2026-08-17"},
    "CreateOrder":{"method":"POST","path":"api/orders","headers":"Revolut-Api-Version: 2026-08-17"},
    "GetOrder":{"method":"GET","path":"api/orders/{!OrderId}","headers":"Revolut-Api-Version: 2026-08-17"},
    "CaptureOrder":{"method":"POST","path":"api/orders/{!OrderId}/capture","headers":"Revolut-Api-Version: 2026-08-17"},
    "CancelOrder":{"method":"POST","path":"api/orders/{!OrderId}/cancel","headers":"Revolut-Api-Version: 2026-08-17"},
    "ListTerminals":{"label":"List POS terminals","method":"GET","path":"api/terminals?operation_mode=pos","headers":"Revolut-Api-Version: 2026-08-17",
      "outputs":{"DeviceId":"[0].id","Name":"[0].name"}},
    "CreateTerminalOrder":{"label":"Create in-person order","method":"POST","path":"api/orders","headers":"Revolut-Api-Version: 2026-08-17",
      "body":"{\"amount\":\"{!AmountMinor}\",\"currency\":\"{!public_checkoutCurrency}\",\"merchant_order_data\":{\"reference\":\"{!Reference}\"}}",
      "outputs":{"OrderId":"id","Status":"state"}},
    "StartPayment":{"label":"Send payment to terminal","method":"POST","path":"api/orders/{!OrderId}/payment-intents","headers":"Revolut-Api-Version: 2026-08-17",
      "body":"{\"amount\":\"{!AmountMinor}\",\"terminal_id\":\"{!DeviceId}\"}",
      "outputs":{"PaymentId":"id","Status":"state","OrderId":"order_id"}},
    "CheckStatus":{"label":"Check terminal payment","method":"GET","path":"api/orders/{!OrderId}/payment-intents/{!PaymentId}","headers":"Revolut-Api-Version: 2026-08-17",
      "outputs":{"Status":"state","RevolutPaymentId":"payment_id"}}
  },
  "docs": "https://developer.revolut.com/docs/api/merchant",
  "notes": "Use a Revolut Merchant Secret API key, never the public SDK key. Sandbox is selected by default; for an approved live Merchant account change the credential Base URL to https://merchant.revolut.com/ and use a separate live secret. For CreateOrder supply JSON amount in minor currency units (500 means GBP 5.00) and currency. Store the order id and checkout_url from the response; confirm payment using GetOrder before fulfillment. GetOrder, CaptureOrder and CancelOrder require an OrderId Flow resource. CaptureOrder requires a previously authorised manual-capture order and a JSON body with amount. Do not use real cards in Sandbox. The connector does not register or verify webhooks automatically. Terminal (Pay at Counter): set the terminal location and turn on Pay at Counter, pick it in Setup → Named Devices, then CreateTerminalOrder, StartPayment and CheckStatus until Status is completed, cancelled or failed."
});
