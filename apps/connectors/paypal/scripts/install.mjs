/** PayPal Connector: install-time metadata only; never package API keys. */
export default Object.freeze({
  "folder": "paypal",
  "appApi": "PayPalConnector",
  "label": "PayPal Connector",
  "description": "PayPal Orders API: in-store QR payments and online checkout (Sandbox by default)",
  "providerType": "QR Payment",
  "credential": "PayPal_API",
  "url": "https://api-m.sandbox.paypal.com/",
  "allowedUrls": ["https://api-m.paypal.com/"],
  "auth": "OAuth Client Credentials",
  "header": "",
  "fields": [
    {"apiName":"public_testPath","label":"Connection test path (read-only)","required":true,"defaultValue":"v1/identity/oauth2/userinfo?schema=paypalv1.1"},
    {"apiName":"public_currency","label":"Payment currency ISO code","required":true,"defaultValue":"GBP"},
    {"apiName":"public_brandName","label":"Shop name shown in PayPal","required":false,"defaultValue":""}
  ],
  "operations": {
    "CreateOrder":{"label":"Create order (QR link)","method":"POST","path":"v2/checkout/orders",
      "headers":"PayPal-Request-Id: {!CalloutKey}",
      "body":"{\"intent\":\"CAPTURE\",\"purchase_units\":[{\"reference_id\":\"{!Reference}\",\"amount\":{\"currency_code\":\"{!public_currency}\",\"value\":\"{!AmountDecimal}\"}}],\"payment_source\":{\"paypal\":{\"experience_context\":{\"brand_name\":\"{!public_brandName}\",\"user_action\":\"PAY_NOW\",\"shipping_preference\":\"NO_SHIPPING\"}}}}",
      "outputs":{"Id":"id","Status":"status","QrLink":"links[1].href"}},
    "GetOrder":{"label":"Check order status","method":"GET","path":"v2/checkout/orders/{!OrderId}",
      "outputs":{"Id":"id","Status":"status"}},
    "CaptureOrder":{"label":"Capture approved order","method":"POST","path":"v2/checkout/orders/{!OrderId}/capture",
      "headers":"PayPal-Request-Id: {!CalloutKey}","body":"{}",
      "outputs":{"Id":"id","Status":"status","CaptureId":"purchase_units[0].payments.captures[0].id"}},
    "Refund":{"label":"Refund a capture","method":"POST","path":"v2/payments/captures/{!CaptureId}/refund",
      "headers":"PayPal-Request-Id: {!CalloutKey}",
      "body":"{\"amount\":{\"currency_code\":\"{!public_currency}\",\"value\":\"{!AmountDecimal}\"}}",
      "outputs":{"Id":"id","Status":"status"}}
  },
  "docs": "https://developer.paypal.com/docs/api/orders/v2/",
  "notes": "Use the shop's own PayPal Business account. developer.paypal.com → Apps & Credentials → create an app; paste its Client ID in the OAuth Client ID setting and its Secret in Secret, Token path v1/oauth2/token. Sandbox by default; for live change Base URL to https://api-m.paypal.com/. Till flow: CreateOrder gives QrLink (show it in a Smart QR), GetOrder until Status is APPROVED, then CaptureOrder (Status COMPLETED)."
});
