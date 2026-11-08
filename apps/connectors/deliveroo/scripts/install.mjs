/** Deliveroo Connector: install-time, non-secret connector definition. Tenant secrets are never packaged. */
export default Object.freeze({
  "folder": "deliveroo",
  "appApi": "DeliverooConnector",
  "label": "Deliveroo Connector",
  "description": "Deliveroo developer partner integration metadata",
  "credential": "Deliveroo_API",
  "url": "https://api.developers.deliveroo.com/",
  "auth": "Bearer",
  "header": "",
  "fields": [],
  "operations": {},
  "docs": "https://api-docs.deliveroo.com/docs/authentication",
  "notes": "Uses OAuth machine-to-machine via provider-issued client ID/secret. Set provider-approved API host before live callouts; placeholder Base URL is editable. No unsupported OAuth grant is claimed."
});
