/**
 * Names in a page's code files. Pure (no Node, no DOM): the server and the device both use it.
 *
 *  - A component is written as a named tag from '@une/ui' (<Button>, <CardGrid>, …): the tag
 *    stands for its type ("Custom:smart_button" -> Button).
 *  - Its className is its name in Page Builder; formulas and actions are grouped under that
 *    name (f.payButton.label, a.payButton.click).
 *  - What the code does not need to show (the component's id, its label, its region) is kept
 *    in manifest.json under "names", so the files still give back the exact page.
 */
export type PageCodeNames={
 /** Tag -> component type, e.g. { "Button": "Custom:smart_button" }. */
 ui:Record<string,string>;
 /** Component name (its className) -> what the page keeps about it besides its props. */
 components:Record<string,{id:string;label?:string|null;region?:string;unnamed?:boolean}>;
};

const IDENTIFIER=/^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED=new Set(['break','case','catch','class','const','continue','debugger','default','delete','do','else',
 'enum','export','extends','false','finally','for','function','if','import','in','instanceof','new','null','return',
 'super','switch','this','throw','true','try','typeof','var','void','while','with','yield','let','static','implements',
 'interface','package','private','protected','public','await','async','of','undefined','NaN','Infinity','arguments','eval']);
/** A plain JavaScript name (not a reserved word). */
export const isIdentifier=(name:string):boolean=>IDENTIFIER.test(name)&&!RESERVED.has(name);
/** An object key / property access as a person writes it: `name` or `"odd-name"`. */
export const objectKey=(name:string):string=>isIdentifier(name)?name:JSON.stringify(name);
export const member=(root:string,...path:string[]):string=>
 root+path.map(part=>isIdentifier(part)?'.'+part:'['+JSON.stringify(part)+']').join('');

/** "Custom:smart_card_grid" -> "CardGrid" (the tag a page writes for that component type). */
export function uiTag(type:string):string{
 const base=String(type??'').replace(/^[^:]*:/,'').replace(/^smart_/,'');
 const tag=base.split(/[^A-Za-z0-9]+/).filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join('');
 return /^[A-Z]/.test(tag)?tag:'Ui'+tag;
}
/** The type a tag stands for when manifest.json does not say: CardGrid -> "Custom:smart_card_grid". */
export const defaultUiType=(tag:string):string=>
 'Custom:smart_'+tag.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase();
/** The label a component gets when it has its type's own name (the usual case). */
export const defaultLabel=(type:string):string=>String(type??'').replace(/^[^:]*:/,'');

export function readNames(manifestText:string|undefined):PageCodeNames|null{
 try{
  const names=JSON.parse(manifestText??'{}')?.names;
  if(!names||typeof names!=='object')return null;
  return {ui:names.ui&&typeof names.ui==='object'?names.ui:{},components:names.components&&typeof names.components==='object'?names.components:{}};
 }catch{return null;}
}

/** Formula / action entries as the runtime keys them ("<component id>:<property or event>").
 * Files keep them grouped by component name; files written before that are flat ("id:event"). */
export function flatEntries<T>(grouped:Record<string,unknown>|null|undefined,names:PageCodeNames|null):
 Array<{fileKey:string;runtimeKey:string;componentId:string;part:string;entry:T}>{
 const out:Array<{fileKey:string;runtimeKey:string;componentId:string;part:string;entry:T}>=[];
 for(const [group,value] of Object.entries(grouped??{})){
  if(!value||typeof value!=='object')continue;
  if(group.includes(':')){
   const at=group.indexOf(':');
   out.push({fileKey:group,runtimeKey:group,componentId:group.slice(0,at),part:group.slice(at+1),entry:value as T});
   continue;
  }
  const id=names?.components?.[group]?.id??group;
  for(const [part,entry] of Object.entries(value as Record<string,unknown>)){
   if(!entry||typeof entry!=='object')continue;
   const explicit=(entry as {key?:unknown}).key;
   out.push({fileKey:group+'.'+part,runtimeKey:typeof explicit==='string'?explicit:id+':'+part,componentId:id,part,entry:entry as T});
  }
 }
 return out;
}

/** The tags a page's files import from '@une/ui' (local name -> imported name). */
export function uiImports(code:string):Map<string,string>{
 const out=new Map<string,string>();
 for(const match of String(code??'').matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@une\/ui['"]/g))
  for(const part of match[1].split(',')){
   const [imported,local]=part.trim().split(/\s+as\s+/).map(text=>text.trim());
   if(imported&&isIdentifier(imported))out.set(local&&isIdentifier(local)?local:imported,imported);
  }
 return out;
}

/** A <Tag> element (new files) -> the attributes of the older <Smart> element, which the
 * page reader understands: id, type, label, region and name come back from the names. */
export function smartAttrs(tag:string,attrs:Record<string,unknown>,names:PageCodeNames|null):Record<string,unknown>{
 const key=typeof attrs.className==='string'?attrs.className:'';
 const kept=names?.components?.[key];
 const type=names?.ui?.[tag]??defaultUiType(tag);
 const out:Record<string,unknown>={...attrs,type};
 out.id=kept?.id??key;
 if(kept&&'label' in kept){if(kept.label!==null&&kept.label!==undefined)out.componentLabel=kept.label;}
 else out.componentLabel=defaultLabel(type);
 if(typeof kept?.region==='string')out.region=kept.region;
 if(out.name===undefined&&key&&!kept?.unnamed)out.name=key;
 // parent="Box": the container it sits in, by name.
 if(typeof out.parent==='string'){
  const parent=names?.components?.[out.parent]?.id;
  if(parent!==undefined){out.layoutParentId=parent;delete out.parent;}
 }
 return out;
}
