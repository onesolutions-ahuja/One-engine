// Pure Smart Dock item rules, shared by the runtime, Builder preview and tests.

export const DOCK_MAX_ITEMS=6;
const sample=[
 {icon:"house",label:"Home"},{icon:"search",label:"Search"},
 {icon:"receipt",label:"Orders"},{icon:"settings",label:"Settings"},
 {icon:"bell",label:"Alerts"},{icon:"user-round",label:"Profile"}
];

const text=value=>value===null||value===undefined?"":String(value).trim();
const flag=value=>value!==false&&value!=="false";

export function dockSettings(p={}){
 const count=Math.trunc(Number(p.dockItemCount));
 const activeRaw=Math.trunc(Number(p.__dockActiveItem??p.dockActiveItem));
 return {
  count:Number.isFinite(count)&&count>=1?Math.min(DOCK_MAX_ITEMS,count):4,
  showLabels:flag(p.dockShowLabels),
  showIndicator:p.dockShowIndicator===true,
  magnify:flag(p.dockMagnify),
  direction:p.navigationDirection==="vertical"?"vertical":"horizontal",
  activeItem:Number.isFinite(activeRaw)&&activeRaw>=1&&activeRaw<=DOCK_MAX_ITEMS?activeRaw:null,
  label:text(p.label)
 };
}

/** Visible items. `resolve(key,fallback)` evaluates a label/badge/visible formula. */
export function dockItems(p={},resolve=(key,fallback)=>p[key]??fallback){
 const {count}=dockSettings(p);
 const items=[];
 for(let index=1;index<=count;index++){
  const prefix="dockItem"+index;
  const visibleSource=p[prefix+"Visible"];
  if(visibleSource!==undefined&&visibleSource!==""&&visibleSource!==null){
   const shown=text(resolve(prefix+"Visible",visibleSource)).toLowerCase();
   if(shown==="false"||shown==="0"||shown==="no")continue;
  }
  const fallback=p.builderPreview?sample[index-1]:{icon:"",label:""};
  const label=text(resolve(prefix+"Label",p[prefix+"Label"]??fallback.label));
  const badge=text(resolve(prefix+"Badge",p[prefix+"Badge"]??""));
  items.push({index,icon:text(p[prefix+"Icon"]||fallback.icon),label,
   badge:badge==="0"?"":badge.length>3?"99+":badge});
 }
 return items;
}
