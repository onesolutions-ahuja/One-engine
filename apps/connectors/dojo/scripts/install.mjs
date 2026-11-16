/** Dojo Connector: install-time metadata only; never package API keys. */
export default Object.freeze({
  "folder": "dojo",
  "appApi": "DojoConnector",
  "label": "Dojo Connector",
  "description": "Dojo Pay at Counter: send card payments to a Dojo terminal from the till",
  "providerType": "Card Terminal",
  "credential": "Dojo_API",
  "url": "https://api.dojo.tech/",
  "auth": "Authorization Scheme",
  "header": "Basic",
  "fields": [
    {"apiName":"public_testPath","label":"Connection test path (read-only)","required":true,"defaultValue":"terminals"},
    {"apiName":"public_testHeaders","label":"Connection test headers","required":true,"defaultValue":"X-Api-Version: 2024-02-05"},
    {"apiName":"public_softwareHouseId","label":"Software house ID (from Dojo)","required":true,"defaultValue":""},
    {"apiName":"public_resellerId","label":"Reseller ID (from Dojo)","required":true,"defaultValue":""},
    {"apiName":"public_currency","label":"Payment currency ISO code","required":true,"defaultValue":"GBP"}
  ],
  "operations": {
    "ListTerminals":{"label":"List terminals","method":"GET","path":"terminals?status=Available",
      "headers":"version: 2024-02-05\nsoftware-house-id: {!public_softwareHouseId}\nreseller-id: {!public_resellerId}",
      "outputs":{"DeviceId":"[0].terminalId","Name":"[0].tid","Status":"[0].status"}},
    "CreateIntent":{"label":"Create payment intent","method":"POST","path":"payment-intents",
      "headers":"version: 2024-02-05",
      "body":"{\"amount\":{\"value\":\"{!AmountMinor}\",\"currencyCode\":\"{!public_currency}\"},\"reference\":\"{!Reference}\"}",
      "outputs":{"IntentId":"id","Status":"status"}},
    "StartPayment":{"label":"Send payment to terminal","method":"POST","path":"terminal-sessions",
      "headers":"version: 2024-02-05\nsoftware-house-id: {!public_softwareHouseId}\nreseller-id: {!public_resellerId}",
      "body":"{\"terminalId\":\"{!DeviceId}\",\"details\":{\"sale\":{\"paymentIntentId\":\"{!IntentId}\"},\"sessionType\":\"Sale\"}}",
      "outputs":{"PaymentId":"id","Status":"status"}},
    "CheckStatus":{"label":"Check payment status","method":"GET","path":"terminal-sessions/{!PaymentId}",
      "headers":"version: 2024-02-05\nsoftware-house-id: {!public_softwareHouseId}\nreseller-id: {!public_resellerId}",
      "outputs":{"Status":"status"}},
    "Cancel":{"label":"Cancel terminal session","method":"PUT","path":"terminal-sessions/{!PaymentId}/cancel",
      "headers":"version: 2024-02-05\nsoftware-house-id: {!public_softwareHouseId}\nreseller-id: {!public_resellerId}","body":"{}"}
  },
  "docs": "https://docs.dojo.tech/payments/in-person-payments/pay-at-counter",
  "notes": "Paste the Dojo secret key (sk_sandbox_... or sk_prod_...) in Secret; it is sent as 'Basic <key>'. Software house and reseller IDs are issued by Dojo for Pay at Counter. Flow: CreateIntent, then StartPayment with IntentId, then CheckStatus until Status is Captured (or Declined / Canceled). Endpoint names follow Dojo's public docs; confirm in the Dojo sandbox before live use."
});
