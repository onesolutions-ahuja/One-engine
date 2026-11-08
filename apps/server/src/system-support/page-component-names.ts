/** Shared, per-page component instance names; IDs remain immutable runtime keys. */
export type NamedComponent={id:string;type:string;properties:Record<string,unknown>};
// Simple newly authored names can include readable spaces and hyphens.
export const componentNamePattern=/^[A-Za-z][A-Za-z0-9_ -]{0,79}$/;
const validSavedName=(name:string)=>name.length<=110&&!/[\u0000-\u001f\u007f]/.test(name);
export const canonicalComponentName=(name:string)=>name.trim().toLocaleLowerCase('en');
export function componentNameStem(type:string):string{
 const api=type.startsWith('Custom:')?type.slice(7):type;
 const stem=api.replace(/[^A-Za-z0-9]/g,'').toLowerCase().replace(/^[0-9]+/,'');
 return (stem||'component').slice(0,64);
}
export function componentInstanceNames(components:readonly NamedComponent[]):Map<string,string>{
 const explicit=new Set<string>(),result=new Map<string,string>();
 for(const item of components){
  const raw=item.properties?.navigatorName;
  if(typeof raw!=='string'||!raw.trim())continue;
  const name=raw.trim(),key=canonicalComponentName(name);
  // Legacy duplicate aliases receive distinct virtual names until renamed.
  if(!validSavedName(name)||explicit.has(key))continue;
  explicit.add(key);result.set(item.id,name);
 }
 const used=new Set(explicit),lastByStem=new Map<string,number>();
 for(const item of components){
  const stem=componentNameStem(item.type),name=result.get(item.id);
  if(!name)continue;
  const match=new RegExp('^'+stem+'([0-9]+)$','i').exec(name);
  if(match)lastByStem.set(stem,Math.max(lastByStem.get(stem)??0,Number(match[1])));
 }
 for(const item of components){
  if(result.has(item.id))continue;
  const stem=componentNameStem(item.type);
  let n=(lastByStem.get(stem)??0)+1;
  while(used.has(canonicalComponentName(stem+n)))n++;
  lastByStem.set(stem,n);
  const name=stem+n;
  result.set(item.id,name);used.add(canonicalComponentName(name));
 }
 return result;
}
export function ensureComponentInstanceNames<T extends NamedComponent>(components:T[]):T[]{
 const names=componentInstanceNames(components);
 return components.map(item=>{
  const assigned=names.get(item.id)!;
  // Preserve the first valid user-defined name. Repair only unnamed, invalid,
  // or duplicate legacy aliases so the visible name and CSV identity cannot diverge.
  const saved=item.properties?.navigatorName;
  return typeof saved==='string'&&canonicalComponentName(saved)===canonicalComponentName(assigned)?item:
   {...item,properties:{...item.properties,navigatorName:assigned}};
 });
}
export function nextComponentInstanceName(components:readonly NamedComponent[],type:string,
 historicalMax=0):string{
 const stem=componentNameStem(type),names=componentInstanceNames(components);
 const regex=new RegExp('^'+stem+'([0-9]+)$','i');
 let last=historicalMax;
 for(const name of names.values()){
  const match=regex.exec(name);if(match)last=Math.max(last,Number(match[1]));
 }
 const taken=new Set([...names.values()].map(canonicalComponentName));
 let candidate=stem+(last+1);
 while(taken.has(canonicalComponentName(candidate)))candidate=stem+(++last+1);
 return candidate;
}
export function validateExplicitComponentNames(components:readonly NamedComponent[]):void{
 const seen=new Set<string>();
 for(const item of components){
  const raw=item.properties?.navigatorName;
  if(typeof raw!=='string'||!raw.trim())continue;
  const name=raw.trim(),key=canonicalComponentName(name);
  if(!validSavedName(name))throw Error('Invalid component name: '+name);
  if(seen.has(key))throw Error('Duplicate component name: '+name);
  seen.add(key);
 }
}
