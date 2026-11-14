import type { LightningPageMetadata } from '../../metadata/Definitions/metadata';

type FormFactor = 'Desktop' | 'Tablet' | 'Phone' | 'Custom' | string | undefined;

/**
 * Whether an App Page has a layout the current device can open.
 * Mirrors the server's resolveAppPage device rules conservatively: a Custom
 * layout opens on any device, Tablet and Custom fall back to Desktop. A page
 * with no device list is treated as available. Used to hide top-bar tabs that
 * would otherwise open "Page not found" (for example a Phone-only page on desktop).
 */
export function appPageOpensOn(page: Pick<LightningPageMetadata, 'devices'> | undefined, formFactor: FormFactor): boolean {
  const devices = Array.isArray(page?.devices) ? page!.devices as string[] : [];
  if (!devices.length || !formFactor) return true;
  const device = formFactor === 'Mobile' ? 'Phone' : formFactor;
  if (devices.includes(device) || devices.includes('Custom')) return true;
  if ((device === 'Tablet' || device === 'Custom') && devices.includes('Desktop')) return true;
  return false;
}
