/** Square Connector: install-time metadata only; never package API keys. */
export default Object.freeze({
  "folder": "square",
  "appApi": "SquareConnector",
  "label": "Square Connector",
  "description": "Square Terminal API: send card payments to a Square Terminal from the till (Sandbox by default)",
  "providerType": "Card Terminal",
  "credential": "Square_API",
  "url": "https://connect.squareupsandbox.com/",
  "allowedUrls": ["https://connect.squareup.com/"],
  "auth": "Bearer",
  "header": "",
  "fields": [
    {"apiName":"public_testPath","label":"Connection test path (read-only)","required":true,"defaultValue":"v2/locations"},
    {"apiName":"public_locationId","label":"Square location ID","required":true,"defaultValue":""},
    {"apiName":"public_currency","label":"Payment currency ISO code","required":true,"defaultValue":"GBP"}
  ],
  "operations": {
    "PairReader":{"label":"Create device pairing code","method":"POST","path":"v2/devices/codes",
      "headers":"Square-Version: 2025-01-23",
      "body":"{\"idempotency_key\":\"{!CalloutKey}\",\"device_code\":{\"name\":\"{!Name}\",\"product_type\":\"TERMINAL_API\",\"location_id\":\"{!public_locationId}\"}}",
      "outputs":{"PairingId":"device_code.id","PairingCode":"device_code.code","Status":"device_code.status"}},
    "GetPairing":{"label":"Check pairing (gives device ID)","method":"GET","path":"v2/devices/codes/{!PairingId}",
      "headers":"Square-Version: 2025-01-23",
      "outputs":{"DeviceId":"device_code.device_id","Status":"device_code.status"}},
    "StartPayment":{"label":"Send checkout to terminal","method":"POST","path":"v2/terminals/checkouts",
      "headers":"Square-Version: 2025-01-23",
      "body":"{\"idempotency_key\":\"{!CalloutKey}\",\"checkout\":{\"amount_money\":{\"amount\":\"{!AmountMinor}\",\"currency\":\"{!public_currency}\"},\"reference_id\":\"{!Reference}\",\"device_options\":{\"device_id\":\"{!DeviceId}\"}}}",
      "outputs":{"PaymentId":"checkout.id","Status":"checkout.status"}},
    "CheckStatus":{"label":"Check checkout status","method":"GET","path":"v2/terminals/checkouts/{!PaymentId}",
      "headers":"Square-Version: 2025-01-23",
      "outputs":{"Status":"checkout.status","SquarePaymentId":"checkout.payment_ids[0]"}},
    "Cancel":{"label":"Cancel checkout","method":"POST","path":"v2/terminals/checkouts/{!PaymentId}/cancel",
      "headers":"Square-Version: 2025-01-23","body":"{}","outputs":{"Status":"checkout.status"}}
  },
  "docs": "https://developer.squareup.com/docs/terminal-api/overview",
  "notes": "Paste a Square access token in Secret and set Location ID. Pair: run PairReader, type the shown code on the Square Terminal, then GetPairing gives DeviceId (Setup → Named Devices → Pair). CheckStatus Status: PENDING, IN_PROGRESS, COMPLETED, CANCELED. For live change Base URL to https://connect.squareup.com/."
});
