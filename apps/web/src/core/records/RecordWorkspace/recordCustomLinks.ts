/** Safe declarative record links. Never merge fields the actor cannot read. */
export function resolveRecordCustomLink(
  template:string,record:Record<string,unknown>,readableFields:ReadonlySet<string>,
  visibleWhen?:{field?:string;value?:string}
):string|null{
  if(typeof template!=='string'||template.length>2048||/[\u0000-\u001f\u007f\\]/.test(template))return null;
  if(visibleWhen?.field&&(!readableFields.has(visibleWhen.field)
    ||String(record[visibleWhen.field]??'')!==String(visibleWhen.value??'')))return null;
  let denied=false;
  const url=template.replace(/\{!Record\.([A-Za-z][A-Za-z0-9_]*)\}/g,(_match:string,name:string)=>{
    if(name!=='Id'&&!readableFields.has(name)){denied=true;return '';}
    if(record[name]===null||record[name]===undefined){denied=true;return '';}
    return encodeURIComponent(String(record[name]));
  });
  if(denied||/\{![^}]*\}/.test(url))return null;
  if(url.startsWith('/')&&!url.startsWith('//'))return url;
  try{
    const parsed=new URL(url);
    return parsed.protocol==='https:'&&parsed.hostname?parsed.href:null;
  }catch{return null;}
}
