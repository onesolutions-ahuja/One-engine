// Pure page-choice rules for Smart MultiPage (shared by the component and its tests).
/** "Cash,PayPal", "Cash;PayPal", an array or blank. Blank = every page. */
export function pageKeyList(value){
 const raw=Array.isArray(value)?value:String(value??"").split(/[,;\n]/);
 const seen=new Set(),keys=[];
 for(const item of raw){
  const key=String(item??"").trim();
  if(key&&!seen.has(key.toLowerCase())){seen.add(key.toLowerCase());keys.push(key);}
 }
 return keys;
}
const same=(a,b)=>String(a??"").trim().toLowerCase()===String(b??"").trim().toLowerCase();
/** Pages to show, in Visible tabs order (Mode 1 first). The builder always shows all,
 * so every page can still be designed. */
export function shownPages(pages,visible,builder=false){
 const keys=pageKeyList(visible);
 if(builder||!keys.length)return pages;
 return keys.map(key=>pages.find(page=>same(page.key,key))).filter(Boolean);
}
/** Open page: the page selected in the builder, then a tapped tab, then Active tab, then the first. */
export function activePage(shown,{picked,active,selected}={}){
 const find=key=>key==null||key===""?undefined:shown.find(page=>same(page.key,key));
 return find(selected)??find(picked)??find(active)??shown[0]??null;
}
/** Tab bar look from its properties. Blank = macOS segmented defaults: centred, medium, rounded. */
export function tabBarLook(p={}){
 const pick=(value,choices,fallback)=>{
  const hit=choices.find(choice=>same(choice,value));
  return (hit??fallback).toLowerCase();
 };
 return {align:pick(p.multiPageTabAlign,["Center","Left","Right","Stretch"],"Center"),
  size:pick(p.multiPageTabSize,["Small","Medium","Large"],"Medium"),
  shape:pick(p.multiPageTabShape,["Rounded","Pill","Square"],"Rounded")};
}
