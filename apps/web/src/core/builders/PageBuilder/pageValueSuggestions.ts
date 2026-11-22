import {COMPANY_FIELDS,USER_FIELDS} from '../../../../../server/src/expression-engine/PageReferences';

/** Formula-bar list after `@`, step by step like Excel:
 *   @            ThisPage, ThisTenant (on top), then Objects
 *   @ThisPage.   this page's components, grouped by type (your names)
 *   @ThisPage.Cart1.          that component's values (+ Selected)
 *   @ThisPage.Tabs1.Selected. Id, Name, Value, Text
 *   @ThisTenant.              User, Company
 * Pure function: the Page Builder passes what the page declares. */
export type PageValueSuggestion={
 reference:string;label:string;
 /** Heading the item is listed under (component type, "Page"...). */
 group?:string;
 /** Shown first and highlighted (ThisPage/ThisTenant, saved values). */
 highlight?:boolean;
 /** Ends with "." — picking it opens the next list. */
 drill?:boolean;
};
export type PageValueComponent={name:string;typeLabel:string;keys:readonly string[]};
export type PageValueChoice={source:'PageState'|'CollectionState';key:string;owner?:string};

const has=(text:string,query:string)=>!query||text.toLowerCase().includes(query.toLowerCase());
const SELECTED_FIELDS=['Id','Name','Value','Text'];

/** Roots offered when the user has typed `@` and no dot yet. */
export function pageValueRoots(query:string):PageValueSuggestion[]{
 return [
  {reference:'@ThisPage.',label:'Components and values on this page',highlight:true,drill:true},
  {reference:'@ThisTenant.',label:'Logged-in user and company',highlight:true,drill:true}
 ].filter(item=>has(item.reference.slice(1,-1),query));
}

/** Suggestions for a query that starts with ThisPage. / ThisTenant. (no @), else null. */
export function pageValueSuggestions(query:string,components:readonly PageValueComponent[],
 choices:readonly PageValueChoice[]):PageValueSuggestion[]|null{
 const match=/^(ThisPage|ThisTenant)\.(.*)$/i.exec(query);
 if(!match)return null;
 const parts=match[2].split('.');
 const last=parts.at(-1)??'';
 if(/^ThisTenant$/i.test(match[1])){
  if(parts.length===1)return [
   {reference:'@ThisTenant.User.',label:'The logged-in user',drill:true},
   {reference:'@ThisTenant.Company.',label:'Your company (Company Settings)',drill:true},
   // Custom permissions (TRUE/FALSE) from profiles / permission sets: type the name, e.g. Till.Refund.
   {reference:'@ThisTenant.Permission.',label:'A custom permission (TRUE/FALSE), e.g. Till.Refund'}
  ].filter(item=>has(item.reference.split('.')[1],last));
  if(parts.length===2&&/^User$/i.test(parts[0]))return [
   ...Object.keys(USER_FIELDS).map(field=>({reference:'@ThisTenant.User.'+field,label:'User '+field})),
   {reference:'@ThisTenant.User.CartId',label:'The user\'s active cart'},
   {reference:'@ThisTenant.User.',label:'Or type a custom User field, e.g. RefundLimit'}
  ].filter(item=>has(item.reference.split('.')[2],last));
  if(parts.length===2&&/^Company$/i.test(parts[0]))
   return COMPANY_FIELDS.map(field=>({reference:'@ThisTenant.Company.'+field,label:'Company '+field}))
    .filter(item=>has(item.reference.split('.')[2],last));
  return [];
 }
 const component=(name:string)=>components.find(item=>item.name.toLowerCase()===name.toLowerCase());
 if(parts.length===1){
  // Components grouped by type, A→Z inside each group; Session last.
  const list:PageValueSuggestion[]=[...components]
   .filter(item=>has(item.name,last))
   .sort((a,b)=>a.typeLabel.localeCompare(b.typeLabel)||a.name.localeCompare(b.name))
   .map(item=>({reference:'@ThisPage.'+item.name+'.',label:item.typeLabel,group:item.typeLabel,drill:true}));
  // Components the scope does not list (e.g. outside the canvas) but that own values.
  for(const choice of choices){
   const owner=choice.owner;
   if(!owner||component(owner)||list.some(item=>item.reference==='@ThisPage.'+owner+'.')||!has(owner,last))continue;
   list.push({reference:'@ThisPage.'+owner+'.',label:'Component',group:'Other components',drill:true});
  }
  if(has('Session',last))list.push({reference:'@ThisPage.Session.Id',label:'This page session ID',group:'Page'});
  if(has('Input',last))list.push({reference:'@ThisPage.Input.',label:'Values given to this page when it opened',group:'Page',drill:true});
  return list;
 }
 const owner=parts[0];
 if(parts.length===2){
  if(/^Session$/i.test(owner))return has('Id',last)?[{reference:'@ThisPage.Session.Id',label:'This page session ID'}]:[];
  if(/^Input$/i.test(owner))return (has('recordId',last)?[{reference:'@ThisPage.Input.recordId',label:'Record given to this page or popup'}]:[]);
  const found=component(owner);
  const name=found?.name??owner;
  const saved=choices.filter(choice=>choice.source==='PageState'&&choice.owner?.toLowerCase()===name.toLowerCase())
   .map(choice=>({reference:'@ThisPage.'+name+'.'+choice.key,label:'Saved value',highlight:true}));
  const live=(found?.keys??[]).filter(key=>!saved.some(item=>item.reference.endsWith('.'+key)))
   .map(key=>({reference:'@ThisPage.'+name+'.'+key,label:key==='value'?'Live value':key==='recordId'?'Bound record ID':'Property'}));
  const selection={reference:'@ThisPage.'+name+'.Selected.',label:'What the user picked',drill:true};
  return [...saved,selection,...live].filter(item=>has(item.reference.split('.')[2],last));
 }
 if(parts.length===3&&/^Selected$/i.test(parts[1])){
  const name=component(owner)?.name??owner;
  return SELECTED_FIELDS.map(field=>({reference:'@ThisPage.'+name+'.Selected.'+field,label:'Picked '+field}))
   .filter(item=>has(field(item.reference),last));
 }
 return [];
}
const field=(reference:string)=>reference.split('.').at(-1)??'';
