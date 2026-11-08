import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';

type PreviewDevice = 'Desktop' | 'Tablet' | 'Phone';

/** A layout variant is a user choice, not a canvas-width breakpoint.
 * Custom uses its explicit supported devices, defaulting to Desktop when
 * the page is not restricted to a single smaller form factor. */
export function pageBuilderPreviewDevice(
  page:Pick<LightningPageMetadata,'layoutVariant'|'devices'|'canvasWidth'>
):PreviewDevice {
  switch(page.layoutVariant){
    case 'Mobile': return 'Phone';
    case 'Tablet': return 'Tablet';
    case 'Desktop': return 'Desktop';
    case 'Custom':
      if(page.devices.includes('Desktop'))return 'Desktop';
      if(page.devices.includes('Tablet'))return 'Tablet';
      if(page.devices.includes('Phone'))return 'Phone';
      return 'Desktop';
    default:
      // Preserve the original fallback for legacy pages without a variant.
      return page.devices.length===1&&page.devices[0]==='Phone'||page.canvasWidth<=600
        ? 'Phone' : page.canvasWidth<1400 ? 'Tablet' : 'Desktop';
  }
}
