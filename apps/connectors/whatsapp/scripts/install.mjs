/** WhatsApp Connector: install-time, non-secret connector definition. Tenant secrets are never packaged. */
export default Object.freeze({
  "folder": "whatsapp",
  "appApi": "WhatsAppConnector",
  "label": "WhatsApp Connector",
  "description": "Meta WhatsApp Cloud API credential and callout definitions",
  "credential": "WhatsApp_Cloud_API",
  "url": "https://graph.facebook.com/",
  "auth": "Bearer",
  "communicationChannel": "WhatsApp",
  "defaultCommunicationFields": {"recipient":"to","body":"text.body","responseId":"messages[0].id"},
  "header": "",
  "fields": [
    {
      "apiName": "public_phoneNumberId",
      "label": "Sender Phone Number ID",
      "required": true,
      "defaultValue": ""
    }
  ],
  "operations": {
    "SendMessage": {
      "method": "POST",
      "path": "v26.0/{!public_phoneNumberId}/messages",
      "communicationFields": {"recipient":"to","body":"text.body","responseId":"messages[0].id"}
    }
  },
  "docs": "https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api",
  "notes": "Secret: Meta system-user access token. Register WhatsApp webhooks separately with a verified Meta App Secret; not enabled without signing key."
});
