import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {PAGE_LAYOUT_VARIANTS,type PageLayoutVariant} from '../system-files/page-layout-version-runtime.js';

/** One device layout of a page as the Page Builder lists it. */
export type PageLayoutSummaryItem={
 variant:PageLayoutVariant;
 /** Components shown when this layout opens (an inheriting layout shows Desktop's). */
 components:number;
 /** True when the layout has its own saved design rather than following Desktop. */
 authored:boolean;
 published:boolean;
 updatedAt:string|null;
};
export type PageLayoutSummary={apiName:string;primary:PageLayoutVariant;layouts:PageLayoutSummaryItem[]};

export type PageLayoutSummaryRow={
 api_name:string;variant:string;creation_layout_variant?:string|null;draft_version:number|null;published_version:number|null;
 inherits_desktop:boolean|null;draft_created_at:Date|string|null;nodes:number|string|null;
};
const ORDER:readonly PageLayoutVariant[]=['Desktop','Custom','Tablet','Mobile'];
const time=(value:Date|string|null)=>value===null?null:new Date(value).toISOString();

/**
 * The layout a page "is designed for": the most recently saved layout that has
 * its own components. Desktop wins ties and is the fallback, so pages that only
 * ever had a Desktop design keep opening exactly as before.
 */
export function summarisePageLayouts(apiName:string,rows:readonly PageLayoutSummaryRow[]):PageLayoutSummary{
 const byVariant=new Map(rows.filter(row=>PAGE_LAYOUT_VARIANTS.includes(row.variant as PageLayoutVariant))
  .map(row=>[row.variant as PageLayoutVariant,row]));
 const desktop=byVariant.get('Desktop');
 const desktopCount=Number(desktop?.nodes??0)||0;
 const layouts=PAGE_LAYOUT_VARIANTS.map(variant=>{
  const row=byVariant.get(variant);
  const own=Number(row?.nodes??0)||0;
  // Version 1 of a non-Desktop layout is the bootstrap copy of Desktop; it is
  // authored only once a user has saved it (or it never inherited at all).
  const authored=Boolean(row?.draft_version)&&(variant==='Desktop'||
   (row?.inherits_desktop===false&&Number(row?.draft_version)>1));
  return {variant,components:authored?own:desktopCount,authored,
   published:Boolean(row?.published_version),updatedAt:time(row?.draft_created_at??null)};
 });
 const candidates=layouts.filter(item=>item.authored&&item.components>0)
  .sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??'')||ORDER.indexOf(a.variant)-ORDER.indexOf(b.variant));
 const savedOriginal=rows.find(row=>PAGE_LAYOUT_VARIANTS.includes(row.creation_layout_variant as PageLayoutVariant))?.creation_layout_variant as PageLayoutVariant|undefined;
 return {apiName,primary:savedOriginal??candidates[0]?.variant??'Desktop',
  layouts:[...layouts].sort((a,b)=>ORDER.indexOf(a.variant)-ORDER.indexOf(b.variant))};
}

/** Tenant-scoped summaries for up to 500 enabled pages in one query. */
export async function loadPageLayoutSummaries(db:SqlPersistence,tenant:string,
 apiNames:readonly string[]):Promise<PageLayoutSummary[]>{
 const names=[...new Set(apiNames)].slice(0,500);
 if(!names.length)return [];
 const {rows}=await db.query<PageLayoutSummaryRow>(`
  SELECT p.api_name,h.variant,h.draft_version,h.published_version,d.creation_layout_variant,
   v.inherits_desktop,v.created_at AS draft_created_at,
   (SELECT COUNT(*) FROM md_page_layout_version_nodes n
     WHERE n.tenant_id=h.tenant_id AND n.page_id=h.page_id AND n.variant=h.variant
       AND n.version=h.draft_version)::integer AS nodes
  FROM md_page_definitions p
  JOIN md_page_layout_heads h ON h.tenant_id=p.tenant_id AND h.page_id=p.id
  JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
  LEFT JOIN md_page_layout_versions v ON v.tenant_id=h.tenant_id AND v.page_id=h.page_id
   AND v.variant=h.variant AND v.version=h.draft_version
  WHERE p.tenant_id=$1 AND p.enabled=true AND p.api_name=ANY($2::text[])`,[tenant,names]);
 const grouped=new Map<string,PageLayoutSummaryRow[]>();
 for(const row of rows){
  if(!grouped.has(row.api_name))grouped.set(row.api_name,[]);
  grouped.get(row.api_name)!.push(row);
 }
 return names.filter(name=>grouped.has(name)).map(name=>summarisePageLayouts(name,grouped.get(name)!));
}
