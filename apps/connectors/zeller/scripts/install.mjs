/** Zeller Connector: install-time metadata only; never package API keys. */
export default Object.freeze({
  "folder": "zeller",
  "appApi": "ZellerConnector",
  "label": "Zeller Connector",
  "description": "Zeller Terminal (UK and Australia): card payments from the till. Operations are added once the Zeller Developer Suite API is confirmed",
  "providerType": "Card Terminal",
  "credential": "Zeller_API",
  "url": "https://api.myzeller.com/",
  "auth": "Bearer",
  "header": "",
  "fields": [
    {"apiName":"public_currency","label":"Payment currency ISO code","required":true,"defaultValue":"GBP"}
  ],
  "operations": {},
  "docs": "https://www.myzeller.com/gb/partnerships",
  "notes": "Zeller's Terminal API reference is only available after creating a free Zeller Developer account. The connector reserves the Named Credential and device setup now; StartPayment, CheckStatus and Cancel operations are added after the API is verified in the Zeller sandbox. No unverified endpoints are generated."
});
