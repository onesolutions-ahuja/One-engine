import {COMPONENT_STATE_FIELDS,type ComponentStateField} from './FormulaComponentState.js';

/** The one reference style builders write (no `$`):
 *
 *   @Sales.Total / @Sales.Customer.Name     Object fields (unchanged)
 *   @ThisPage.Session.Id                     this page session
 *   @ThisPage.Input.RecordId                 a value handed to the page/popup when it opened
 *   @ThisPage.Cart1.recordId                 a component's live value or property
 *   @ThisPage.PayButton.CartTotal            a value saved by that component's action
 *   @ThisPage.Tabs1.Selected.Id              what the user picked in that component
 *   @ThisTenant.User.Name / .CartId          the logged-in user
 *   @ThisTenant.Company.Name / .Logo / .Id   the company (tenant)
 *
 * Every engine (browser, server, SQL, compiler) reads references through
 * parsePageReference, so the rules live in exactly one place. */
export const THIS_PAGE='ThisPage';
export const THIS_TENANT='ThisTenant';
/** No Object may use these API names. */
export const RESERVED_ROOT_NAMES=[THIS_PAGE,THIS_TENANT] as const;
/** No component on a page may use these names. */
export const RESERVED_COMPONENT_NAMES=['Session','Input','Selected',THIS_PAGE,THIS_TENANT] as const;

export const USER_FIELDS={
 Id:'id',Email:'email',Name:'name',Locale:'locale',TimeZone:'timeZone',CurrencyIsoCode:'currencyIsoCode'
} as const;
export type UserField=keyof typeof USER_FIELDS;
export const COMPANY_FIELDS=['Id','Name','Logo'] as const;
export type CompanyField=typeof COMPANY_FIELDS[number];
/** @ThisPage.Till.Id …: the Till this device is set up as (the server looks it up by device key). */
export const TILL_FIELDS=['Id','Name','Code','Location','LocationCode'] as const;
export type TillField=typeof TILL_FIELDS[number];
/** @ThisPage.Device.Key / Ip / Agent: this device, for audit. The server reads Ip and Agent itself. */
export const DEVICE_FIELDS=['Key','Ip','Agent'] as const;
export type DeviceField=typeof DEVICE_FIELDS[number];

export type PageReference=
 |{kind:'session'}
 |{kind:'input';key:string}
 |{kind:'component';name:string;key:string}
 |{kind:'selected';name:string;field:ComponentStateField}
 |{kind:'user';field:UserField}
 |{kind:'cart'}
 |{kind:'company';field:CompanyField}
 |{kind:'till';field:TillField}
 |{kind:'device';field:DeviceField};

const NAME=/^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const pick=<T extends string>(list:readonly T[],value:string):T|undefined=>list.find(item=>same(item,value));

export function isReservedRootName(name:unknown):boolean{
 return typeof name==='string'&&RESERVED_ROOT_NAMES.some(item=>same(item,name.trim()));
}
export function isReservedComponentName(name:unknown):boolean{
 return typeof name==='string'&&RESERVED_COMPONENT_NAMES.some(item=>same(item,name.trim().replace(/[ -]+/g,'_')));
}
/** True for any reference rooted at ThisPage / ThisTenant (with or without @). */
export function isPageReference(reference:string):boolean{
 return /^@?(?:ThisPage|ThisTenant)(?:\.|$)/i.test(reference);
}

/** Parse `ThisPage.…` / `ThisTenant.…` (a leading @ is optional). Returns null
 * for Object field references. Throws for a malformed ThisPage/ThisTenant one. */
export function parsePageReference(raw:string):PageReference|null{
 const reference=raw.startsWith('@')?raw.slice(1):raw;
 if(!isPageReference(reference))return null;
 const parts=reference.split('.');
 if(!parts.every(part=>NAME.test(part))||parts.some(part=>/^(?:__proto__|prototype|constructor)$/.test(part)))
  throw Error('Invalid reference: @'+reference);
 const [root,second,third,fourth]=parts;
 if(same(root,THIS_TENANT)){
  if(second&&same(second,'User')&&parts.length===3){
   if(same(third,'CartId'))return {kind:'cart'};
   const field=pick(Object.keys(USER_FIELDS) as UserField[],third);
   if(field)return {kind:'user',field};
  }
  if(second&&same(second,'Company')&&parts.length===3){
   const field=pick(COMPANY_FIELDS,third);
   if(field)return {kind:'company',field};
  }
  throw Error('Unknown tenant value @'+reference+' (use @ThisTenant.User.Name or @ThisTenant.Company.Name)');
 }
 if(parts.length<3)throw Error('Incomplete page value @'+reference+' (e.g. @ThisPage.MyBox1.value)');
 if(same(second,'Session')){
  if(parts.length===3&&same(third,'Id'))return {kind:'session'};
  throw Error('Unknown session value @'+reference+' (use @ThisPage.Session.Id)');
 }
 if(same(second,'Till')&&parts.length===3){
  const field=pick(TILL_FIELDS,third);
  if(field)return {kind:'till',field};
 }
 if(same(second,'Device')&&parts.length===3){
  const field=pick(DEVICE_FIELDS,third);
  if(field)return {kind:'device',field};
 }
 if(same(second,'Input')){
  if(parts.length===3)return {kind:'input',key:third};
  throw Error('Invalid page input @'+reference);
 }
 if(parts.length===4&&same(third,'Selected')){
  const field=pick(COMPONENT_STATE_FIELDS,fourth);
  if(field)return {kind:'selected',name:second,field};
  throw Error('Unknown selection value @'+reference+' (use Id, Name, Value or Text)');
 }
 // @ThisPage.CashBox.Value / .Text: what that component holds now (typed, picked or set
 // with `@ThisPage.CashBox.Value = …`), the same value as @ThisPage.CashBox.Selected.Value.
 if(parts.length===3&&(same(third,'Value')||same(third,'Text')))
  return {kind:'selected',name:second,field:same(third,'Value')?'Value':'Text'};
 if(parts.length===3)return {kind:'component',name:second,key:third};
 throw Error('Invalid page value @'+reference);
}

/** Page-code result key holding values given with `@ThisPage.Name.Value = …` ({Name: value}). */
export const COMPONENT_VALUES='componentValues';

/** Live values every component publishes in the browser. Any other key on a
 * component is a value its action saved (server-readable page state). */
export const COMPONENT_LIVE_KEYS=['value','recordId','text','textSource','imageSource','badgeText'] as const;
export function isBrowserOnlyReference(reference:PageReference|null):boolean{
 return reference?.kind==='component'&&(COMPONENT_LIVE_KEYS as readonly string[]).includes(reference.key);
}
/** Internal marker for FLOW(Name) after parsing; never typed by a builder. */
export const FLOW_MARKER='FLOW:';
export const isFlowMarker=(value:unknown):boolean=>typeof value==='string'&&value.startsWith(FLOW_MARKER);

/** References a compiled page file can read without a browser component:
 * the session, page inputs, saved values and the action's own event. */
export function isCompiledStateReference(ref:string):boolean{
 if(/^\$?event\.[A-Za-z][A-Za-z0-9_.]*$/.test(ref))return true;
 try{
  const page=parsePageReference(ref);
  return page?.kind==='session'||page?.kind==='input'||page?.kind==='component'&&!isBrowserOnlyReference(page);
 }catch{return false;}
}

/** Saved-value key named by a reference (component values double as saved values). */
export function savedValueKey(reference:PageReference|null):string|null{
 return reference?.kind==='input'||reference?.kind==='component'?reference.key:null;
}

/** Scan formula text (outside quotes) for @ThisPage/@ThisTenant references. */
export function pageReferencesIn(text:string):PageReference[]{
 const found:PageReference[]=[];
 for(const segment of codeSegments(text))
  for(const match of segment.matchAll(/@((?:ThisPage|ThisTenant)(?:\.[A-Za-z_][A-Za-z0-9_]*)+)/gi)){
   try{const item=parsePageReference(match[1]);if(item)found.push(item);}catch{/* reported by the formula bar */}
  }
 return found;
}
/** Keys a formula may read as saved page values. */
export function savedValueKeysIn(text:string):string[]{
 return [...new Set(pageReferencesIn(text).map(savedValueKey).filter((key):key is string=>Boolean(key)))];
}

/** Text with page/tenant values blanked out (Selected values kept), for the
 * runtime checks that ask "does this formula read a record field?". */
export function withoutPageValues(text:string):string{
 return typeof text==='string'&&/@This(?:Page|Tenant)/i.test(text)
  ?text.replace(/@(?:ThisPage|ThisTenant)((?:\.[A-Za-z_][A-Za-z0-9_]*)+)/gi,
   (match,path:string)=>/^\.[A-Za-z_][A-Za-z0-9_]*\.Selected\./i.test(path)?match:' ')
  :text;
}
/** True when the text reads a page or tenant value. */
export const hasPageValue=(text:unknown):boolean=>typeof text==='string'&&/@This(?:Page|Tenant)\./i.test(text);

/** Declarative action inputs (picked from a list, never typed) keep short
 * internal codes: $session, $state.key, $event.x, $record.F. A builder may
 * also write the formula spelling; this maps it to the internal code. */
export function declarativeSource<T>(source:T):T|string{
 if(typeof source!=='string'||!/^@This(?:Page|Tenant)\./i.test(source.trim()))return source;
 let page:PageReference|null=null;
 try{page=parsePageReference(source.trim());}catch{return source;}
 if(!page)return source;
 switch(page.kind){
  case 'session':return '$session';
  case 'cart':return '$session.cartId';
  case 'user':return '$session.user.'+USER_FIELDS[page.field];
  case 'company':return '$session.tenant.'+page.field.toLowerCase();
  case 'input':return '$state.'+page.key;
  case 'component':return isBrowserOnlyReference(page)?source:'$state.'+page.key;
  default:return source;
 }
}

/** Split text into code parts, dropping quoted strings ("..." / '...'). */
export function codeSegments(text:string):string[]{
 const out:string[]=[];
 let current='';
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(char==='"'||char==="'"){
   out.push(current);current='';
   for(i++;i<text.length;i++){
    if(text[i]==='\\'){i++;continue;}
    if(text[i]===char){if(text[i+1]===char){i++;continue;}break;}
   }
   continue;
  }
  current+=char;
 }
 out.push(current);
 return out;
}

/** Old `$…` / `@Name.state.X` / `@state.x` spellings, for a clear error message. */
// Case-sensitive on purpose: Flow Builder's own $Record / $User globals are a different language.
export const LEGACY_REFERENCE=/\$(?:state|session|component|tenant|flow)\b|@[A-Za-z][A-Za-z0-9_]*\.state\.[A-Za-z]|@(?:state|session)\.[A-Za-z]/;
export function legacyReferenceError(text:string):string|null{
 return codeSegments(text).some(segment=>LEGACY_REFERENCE.test(segment))
  ?'Old $ references are no longer used. Type @ and pick from ThisPage, ThisTenant or an Object.':null;
}

/** One-time rewrite of old formulas into the new style. `ownerOf(key)` names
 * the component whose action saves that key (undefined: a page input). Quoted
 * text is never touched. Idempotent: new-style text is returned unchanged. */
export function modernizeFormula(text:string,ownerOf:(key:string)=>string|undefined=()=>undefined):string{
 if(typeof text!=='string'||!/[$@]/.test(text))return text;
 const rewrite=(code:string)=>modernizeReferences(code,ownerOf);
 // Rebuild, keeping every quoted string exactly as written.
 let out='';
 let current='';
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(char==='"'||char==="'"){
   out+=rewrite(current);current='';
   let literal=char;
   for(i++;i<text.length;i++){
    literal+=text[i];
    if(text[i]==='\\'&&i+1<text.length){literal+=text[++i];continue;}
    if(text[i]===char){if(text[i+1]===char){literal+=text[++i];continue;}break;}
   }
   out+=literal;
   continue;
  }
  current+=char;
 }
 return out+rewrite(current);
}

/** The rewrite itself, applied to code text (quotes are NOT skipped here). */
export function modernizeReferences(code:string,ownerOf:(key:string)=>string|undefined=()=>undefined):string{
 const saved=(key:string)=>'@ThisPage.'+(ownerOf(key)??'Input')+'.'+key;
 const cap=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);
 // Old component names with spaces were encoded as __n_<hex>_<hex>…; decode to My_Box.
 const decode=(name:string)=>/^__n_[0-9a-f_]+$/.test(name)
  ?String.fromCodePoint(...name.slice(4).split('_').map(hex=>parseInt(hex,16))).trim().replace(/[ -]+/g,'_'):name;
 return code
  // TABLE(@Product, Name, Price) -> TABLE(@Product, @Product.Name, @Product.Price)
  .replace(/\bTABLE\s*\(\s*@([A-Za-z][A-Za-z0-9_]*)((?:\s*,\s*@?[A-Za-z][A-Za-z0-9_.]*)*)\s*\)/g,(match,object:string,columns:string)=>
   'TABLE(@'+object+columns.split(',').slice(1).map(column=>{
    const name=column.trim();
    if(/^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/.test(name))return ', @'+name;
    return ', '+(/^@?[A-Za-z][A-Za-z0-9_]*$/.test(name)&&name.replace(/^@/,'').toLowerCase()!==object.toLowerCase()
     ?'@'+object+'.'+name.replace(/^@/,''):name);
   }).join('')+')')
  .replace(/\$flow\.([A-Za-z][A-Za-z0-9_]*)/g,(_m,name)=>'FLOW('+name+')')
  .replace(/\$component\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g,(_m,name,key)=>'@ThisPage.'+decode(name)+'.'+key)
  .replace(/@([A-Za-z][A-Za-z0-9_]*)\.state\.(Id|Name|Value|Text|Field|Criteria)\b/gi,(_m,name,field)=>
   '@ThisPage.'+name+'.Selected.'+(pick(COMPONENT_STATE_FIELDS,field)??field))
  .replace(/[$@]state\.([A-Za-z][A-Za-z0-9_]*)/g,(_m,key)=>saved(key))
  // A value first filed under Input that a component turns out to save.
  .replace(/@ThisPage\.Input\.([A-Za-z][A-Za-z0-9_]*)\b/g,(match,key)=>ownerOf(key)?saved(key):match)
  .replace(/\$session\.cartId\b/g,'@ThisTenant.User.CartId')
  .replace(/\$session\.user\.([A-Za-z]+)\b/g,(_m,key)=>{
   const field=(Object.keys(USER_FIELDS) as UserField[]).find(item=>USER_FIELDS[item]===key);
   return '@ThisTenant.User.'+(field??cap(key));
  })
  .replace(/\$(?:session\.)?tenant\.([A-Za-z]+)\b/g,(_m,key)=>'@ThisTenant.Company.'+cap(key.toLowerCase()))
  .replace(/[$@]session(?:\.id)?(?![A-Za-z0-9_.])/g,'@ThisPage.Session.Id');
}

/** The parts of a parsed formula node an assignment check needs. */
type AssignmentNode={kind:string;operator?:string;left?:{kind:string;value?:unknown}};
/** `@ThisPage.CashBox.Value = …` (or `CashBox.Value = …`) as a step: the name of the
 * component given a new value, else null (an ordinary comparison). */
export function assignedComponent(node:AssignmentNode,aliases:ReadonlySet<string>=new Set()):string|null{
 if(node.kind!=='binary'||node.operator!=='='||node.left?.kind!=='reference'||typeof node.left.value!=='string')return null;
 const path=node.left.value.replace(/^@/,'');
 const bare=/^([A-Za-z][A-Za-z0-9_]{0,79})\.(value|text)$/i.exec(path);
 if(bare&&!aliases.has(bare[1])&&!/^(?:event|record|ThisPage|ThisTenant)$/i.test(bare[1]))return bare[1];
 const page=/^ThisPage\.([A-Za-z][A-Za-z0-9_]{0,79})\.(value|text)$/i.exec(path);
 if(page&&!/^(?:Session|Input|Till|Device|Selected)$/i.test(page[1]))return page[1];
 return null;
}
