/** Just Eat Connector: install-time, non-secret connector definition. Tenant secrets are never packaged. */
export default Object.freeze({
  "folder": "just-eat",
  "appApi": "JustEatConnector",
  "label": "Just Eat Connector",
  "description": "Just Eat Takeaway.com partner API integration metadata",
  "credential": "JustEat_API",
  "url": "https://uk-partnerapi.just-eat.io/",
  "auth": "Authorization Scheme",
  "header": "JE-API-KEY",
  "fields": [],
  "operations": {},
  "docs": "https://uk.api.just-eat.io/docs",
  "notes": "For partner API calls Secret is an issued API key. OneEngine applies the fixed Authorization: JE-API-KEY scheme; other Just Eat products use different authentication."
});
