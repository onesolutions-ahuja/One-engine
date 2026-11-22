# App build checklist (Android / Windows / any installed shell)

Every installed app that opens Une pages MUST do these at start-up, before the first page loads.

1. **Device key**: set `window.__uneDeviceKey` to the OS device id (16-128 chars, `A-Z a-z 0-9 _ -`).
   It keeps the device's Till (and kiosk, display) linked even when browser storage is cleared.
2. **Attached devices**: set `window.__uneAttachedDevices` to the IDs of devices the app sees attached:
   USB serial numbers, Bluetooth MAC addresses, serial ports (an array of strings, at most 20).
   - The till page sends them to `/api/till-device/current`.
   - A Named Device whose **Address** or **Device ID** matches, and whose **Attached to Till** is set,
     makes this device that Till with no "Which till is this?" question.
   - Several Tills matched, or the person may not set up Tills: the page still asks, with that Till first.
3. Test it on one Smart Till tenant:
   - Set a Cash Drawer Named Device's **Address** to the drawer's ID and **Attached to Till** to Till 1.
   - Sign in on the app as a manager: the till opens as Till 1 with no question.

Code: `apps/web/src/core/authentication/TillDevice/deviceTill.ts` (`tillDeviceKey`, `attachedDevices`),
`apps/server/src/system-support/till-assignment-service.ts` (`attachedTill`).
