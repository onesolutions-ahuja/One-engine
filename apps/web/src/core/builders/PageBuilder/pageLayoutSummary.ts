/** Device-layout summary served by GET /api/metadata/page-layout-summaries. */
export type PageLayoutVariantName='Desktop'|'Tablet'|'Mobile'|'Custom';
export type PageLayoutSummaryItem={
  variant:PageLayoutVariantName;components:number;authored:boolean;
  published:boolean;updatedAt:string|null;
};
export type PageLayoutSummary={apiName:string;primary:PageLayoutVariantName;layouts:PageLayoutSummaryItem[]};

export const PAGE_LAYOUT_ORDER:readonly PageLayoutVariantName[]=['Desktop','Custom','Tablet','Mobile'];

/** "Custom (26)", "Desktop (empty)", "Tablet (follows Desktop)". */
export function pageLayoutOptionLabel(variant:PageLayoutVariantName,summary?:PageLayoutSummary|null):string{
  const item=summary?.layouts.find(layout=>layout.variant===variant);
  if(!item)return variant;
  if(variant!=='Desktop'&&!item.authored)return variant+' (follows Desktop)';
  return variant+(item.components>0?' ('+item.components+')':' (empty)');
}

/** Layouts that have their own design with components, for page-list badges. */
export const designedPageLayouts=(summary?:PageLayoutSummary|null)=>
  (summary?.layouts??[]).filter(item=>item.authored&&item.components>0);

/** The layout a page opens in: its own design, else Desktop. */
export const primaryPageLayout=(summary?:PageLayoutSummary|null):PageLayoutVariantName=>
  summary?.primary??'Desktop';

/** Layouts for the top-bar tabs: the ones with a design first (the page's main one leading),
 * then the empty ones in the usual order. */
export function orderedPageLayouts(summary?:PageLayoutSummary|null):PageLayoutVariantName[]{
  const designed=new Set(designedPageLayouts(summary).map(item=>item.variant));
  const first=designed.has(summary?.primary as PageLayoutVariantName)?[summary!.primary]:[];
  const rest=PAGE_LAYOUT_ORDER.filter(variant=>designed.has(variant)&&!first.includes(variant));
  const empty=PAGE_LAYOUT_ORDER.filter(variant=>!designed.has(variant));
  return [...first,...rest,...empty];
}

/** The layout to open a page in: the one that has a design, else null (keep the usual default). */
export const designedPrimaryLayout=(summary?:PageLayoutSummary|null):PageLayoutVariantName|null=>
  orderedPageLayouts(summary).find(variant=>designedPageLayouts(summary).some(item=>item.variant===variant))??null;
