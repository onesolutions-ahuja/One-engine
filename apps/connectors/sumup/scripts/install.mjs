/** SumUp Connector: install-time metadata only; never package API keys. */
export default Object.freeze({
  "folder": "sumup",
  "appApi": "SumUpConnector",
  "label": "SumUp Connector",
  "description": "SumUp Cloud API: take card payments on a SumUp Solo reader from the till",
  "providerType": "Card Terminal",
  "credential": "SumUp_API",
  "url": "https://api.sumup.com/",
  "auth": "Bearer",
  "header": "",
  "fields": [
    {"apiName":"public_testPath","label":"Connection test path (read-only)","required":true,"defaultValue":"v0.1/me"},
    {"apiName":"public_merchantCode","label":"Merchant code (from SumUp dashboard)","required":true,"defaultValue":""},
    {"apiName":"public_affiliateKey","label":"Affiliate key (SumUp developer portal)","required":true,"defaultValue":""},
    {"apiName":"public_appId","label":"Affiliate app ID","required":true,"defaultValue":""},
    {"apiName":"public_currency","label":"Payment currency ISO code","required":true,"defaultValue":"GBP"}
  ],
  "operations": {
    "PairReader":{"label":"Pair a Solo reader","method":"POST","path":"v0.1/merchants/{!public_merchantCode}/readers",
      "body":"{\"pairing_code\":\"{!PairingCode}\",\"name\":\"{!Name}\"}",
      "outputs":{"DeviceId":"id","Status":"status","Name":"name"}},
    "ListReaders":{"label":"List readers","method":"GET","path":"v0.1/merchants/{!public_merchantCode}/readers",
      "outputs":{"DeviceId":"items[0].id","Name":"items[0].name"}},
    "StartPayment":{"label":"Start card payment","method":"POST","path":"v0.1/merchants/{!public_merchantCode}/readers/{!DeviceId}/checkout",
      "body":"{\"total_amount\":{\"currency\":\"{!public_currency}\",\"minor_unit\":2,\"value\":\"{!AmountMinor}\"},\"description\":\"{!Reference}\",\"affiliate\":{\"app_id\":\"{!public_appId}\",\"key\":\"{!public_affiliateKey}\",\"foreign_transaction_id\":\"{!CalloutKey}\"}}",
      "outputs":{"PaymentId":"data.client_transaction_id"}},
    "CheckStatus":{"label":"Check payment status","method":"GET","path":"v2.1/merchants/{!public_merchantCode}/transactions?client_transaction_id={!PaymentId}",
      "outputs":{"Status":"status","TransactionCode":"transaction_code","Amount":"amount"}},
    "Cancel":{"label":"Cancel payment on reader","method":"POST","path":"v0.1/merchants/{!public_merchantCode}/readers/{!DeviceId}/terminate","body":"{}"}
  },
  "docs": "https://developer.sumup.com/terminal-payments/cloud-api",
  "notes": "Paste a SumUp API key in Secret. Set Merchant code, Affiliate key and App ID. Pair: on the Solo log out, open Connections → API to show a pairing code, then run PairReader (Setup → Named Devices → Pair). Test without hardware using Virtual Solo with a sandbox merchant. CheckStatus Status: PENDING, SUCCESSFUL, FAILED or CANCELLED."
});
