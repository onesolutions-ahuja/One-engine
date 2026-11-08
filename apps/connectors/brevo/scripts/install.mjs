/** Brevo Connector: install-time, non-secret connector definition. Tenant secrets are never packaged. */
export default Object.freeze({
  "folder": "brevo",
  "appApi": "BrevoConnector",
  "label": "Brevo Connector",
  "description": "Brevo transactional messaging API",
  "credential": "Brevo_API",
  "url": "https://api.brevo.com/v3/",
  "auth": "API Key",
  "header": "api-key",
  "fields": [],
  "operations": {
    "SendTransactionalEmail": {
      "method": "POST",
      "path": "smtp/email"
    },
    "GetAccount": {
      "method": "GET",
      "path": "account"
    }
  },
  "docs": "https://developers.brevo.com/docs/api-key-authentication",
  "notes": "Enter the Brevo API key in encrypted Secret; header name api-key is predefined, not a user variable."
});
