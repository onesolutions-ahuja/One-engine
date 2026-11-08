import type { LightningPageMetadata, PageComponentMetadata } from '../../metadata/Definitions/metadata';

/** Presentation derives from saved page metadata, never a component or app name. */
export function isStandalonePagePresentation(page: Pick<LightningPageMetadata,'layoutMode'|'components'> | null | undefined): boolean {
  if (!page) return false;
  return page.components.some((component: PageComponentMetadata) =>
    component.properties?.standalonePresentation === true);
}

/** Layout sizing is a page concern; components remain interchangeable. */
export function pageCanvasPresentationStyle(page: Pick<LightningPageMetadata,'canvasWidth'|'canvasHeight'|'canvasFillColor'|'layoutMode'|'components'>) {
  return isStandalonePagePresentation(page)
    ? {width:'100%',height:'100dvh',maxWidth:'none',backgroundColor:page.canvasFillColor??'#ffffff'}
    : {width:page.canvasWidth,height:page.canvasHeight,backgroundColor:page.canvasFillColor??'#ffffff'};
}
