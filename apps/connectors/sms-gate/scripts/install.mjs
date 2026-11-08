/** SMS Gate Connector: install-time, non-secret connector definition. Tenant secrets are never packaged. */
export default Object.freeze({
  "folder": "sms-gate",
  "appApi": "SmsGateConnector",
  "label": "SMS Gate Connector",
  "description": "SMS Gateway for Android cloud HTTP API",
  "credential": "SmsGate_API",
  "url": "https://api.sms-gate.app/3rdparty/v1/",
  "auth": "Basic",
  "header": "",
  "communicationChannel": "SMS",
  "defaultCommunicationFields": {"recipient":"phoneNumbers[0]","body":"textMessage.text","responseId":"id"},
  "fields": [],
  "operations": {
    "SendMessage": {
      "method": "POST",
      "path": "messages"
    },
    "ListDevices": {
      "method": "GET",
      "path": "devices"
    }
  },
  "docs": "https://docs.sms-gate.app/integration/api/",
  "notes": "Enter Basic credentials as username:password in Secret. JWT bearer mode can be chosen in Named Credentials once a JWT is issued."
});
