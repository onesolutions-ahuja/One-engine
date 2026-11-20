/** Field rules for input boxes linked to an Object field (Property "Field", e.g. Customer.Email).
 *  - Object Manager "Required" always applies; the box's own "Required" can only add to it.
 *  - Field access: no read → hidden; no create/edit → shown locked, never "type then fail".
 *  - Saving (an action that creates or updates a record) first checks every required box on
 *    that screen and stops with "Fill in: Email" instead of sending an incomplete record.
 * The server still enforces both rules; this is what makes them visible before saving. */
export type FieldAccess={label:string;required:boolean;read:boolean;create:boolean;edit:boolean};
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;

const cache=new Map<string,{at:number;value:Promise<Record<string,FieldAccess>>}>();
const TTL=5*60_000;

export function loadFieldAccess(request:Request,objectApi:string):Promise<Record<string,FieldAccess>>{
 if(!/^[A-Za-z][A-Za-z0-9_]{0,199}$/.test(objectApi))return Promise.resolve({});
 const hit=cache.get(objectApi);
 if(hit&&Date.now()-hit.at<TTL)return hit.value;
 const value=request<{fields?:Record<string,FieldAccess>}>('/metadata/field-access/'+encodeURIComponent(objectApi))
  .then(result=>result?.fields??{})
  .catch(error=>{cache.delete(objectApi);throw error;});
 cache.set(objectApi,{at:Date.now(),value});
 return value;
}
export function clearFieldAccessCache(){cache.clear();}

type RequiredBox={label:string;value:()=>unknown;visible:()=>boolean;flag:(missing:boolean)=>void};
const boxes=new Map<string,Map<string,RequiredBox>>();

export function registerRequiredBox(pageSessionKey:string,componentId:string,box:RequiredBox){
 let page=boxes.get(pageSessionKey);
 if(!page){page=new Map();boxes.set(pageSessionKey,page);}
 page.set(componentId,box);
 return ()=>{
  const current=boxes.get(pageSessionKey);
  if(current?.get(componentId)===box)current.delete(componentId);
  if(current&&!current.size)boxes.delete(pageSessionKey);
 };
}

const blank=(value:unknown)=>value===null||value===undefined||(typeof value==='string'&&!value.trim());

/** Labels of required boxes on this screen that are empty; each one is marked red. */
export function missingRequired(pageSessionKey:string):string[]{
 const missing:string[]=[];
 for(const box of boxes.get(pageSessionKey)?.values()??[]){
  if(!box.visible()){box.flag(false);continue;}
  const empty=blank(box.value());
  box.flag(empty);
  if(empty)missing.push(box.label);
 }
 return missing;
}

/** True when a page-code formula writes a record (the only time required boxes block). */
export const writesRecord=(formula:unknown)=>typeof formula==='string'
 &&/\b(CREATERECORD|UPDATERECORD|UPSERTRECORD|SAVERECORD)\s*\(/i.test(formula);
