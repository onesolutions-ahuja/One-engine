/** Uber Eats Connector: install-time, non-secret connector definition. Tenant secrets are never packaged. */
export default Object.freeze({
  "folder": "uber-eats",
  "appApi": "UberEatsConnector",
  "label": "Uber Eats Connector",
  "description": "Uber Eats merchant partner integration metadata",
  "credential": "UberEats_API",
  "url": "https://api.uber.com/",
  "auth": "Bearer",
  "header": "",
  "fields": [],
  "operations": {},
  "docs": "https://developer.uber.com/docs/eats/guides/authentication",
  "notes": "Provider approval and merchant OAuth authorisation are required for some operations. Store an issued access token in encrypted Secret; OAuth client secret and grant provisioning need authorised provider setup. No unverified endpoints are generated."
});
