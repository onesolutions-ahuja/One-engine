/** Builder-only targets. The persisted component stays the single source of truth. */
export type CanvasBindingTarget={
 componentId:string;propertyKey:string;itemIndex?:number;itemId?:string;displayLabel?:string;requestId:number;
};
type Props=Record<string,unknown>;
type Tab={id:string;label:string;[key:string]:unknown};
const asTab=(entry:unknown,index:number):Tab=>{
 if(entry&&typeof entry==='object'&&!Array.isArray(entry)){
  const row=entry as Record<string,unknown>;
  return {...row,id:typeof row.id==='string'&&row.id?row.id:'static-tab-'+index,
   label:String(row.label??'Tab '+(index+1))};
 }
 return {id:'static-tab-'+index,label:typeof entry==='string'?entry:'Tab '+(index+1)};
};
export function tabCaptionIndex(properties:Props,target:Pick<CanvasBindingTarget,'itemId'|'itemIndex'>):number{
 const rows=Array.isArray(properties.tabs)?properties.tabs:[];
 if(target.itemId&&rows.length){
  // A deleted or reordered target must never update another tab by position.
  return rows.findIndex((row,i)=>asTab(row,i).id===target.itemId);
 }
 return Number.isInteger(target.itemIndex)&&Number(target.itemIndex)>=0
  ?Number(target.itemIndex):0;
}
export function readCanvasBinding(properties:Props,target:Pick<CanvasBindingTarget,'propertyKey'|'itemId'|'itemIndex'>,valueKey?:string):string{
 if(target.propertyKey!=='tabCaptionFormula')return String(properties[valueKey??target.propertyKey]??'');
 const index=tabCaptionIndex(properties,target);
 if(index<0)return '';
 const raw=Array.isArray(properties.tabs)?properties.tabs[index]:undefined;
 if(raw===undefined&&index===0&&typeof properties.label==='string'&&
  properties.label&&!properties.label.startsWith('@'))return properties.label;
 return asTab(raw,index).label;
}
export function writeCanvasBinding(properties:Props,target:Pick<CanvasBindingTarget,'propertyKey'|'itemId'|'itemIndex'>,value:string,valueKey?:string):Props{
 if(target.propertyKey!=='tabCaptionFormula')
  return {...properties,[valueKey??target.propertyKey]:value,
   ...(target.propertyKey==='imageSource'?{imageSourceMode:'field'}:{})};
 const count=Math.max(1,Math.min(20,Number(properties.tabCount)||3));
 const original=Array.isArray(properties.tabs)&&properties.tabs.length
  ?properties.tabs:Array.from({length:count},(_,i)=>i===0&&typeof properties.label==='string'&&
     properties.label&&!properties.label.startsWith('@')?properties.label:'Tab '+(i+1));
 const tabs=original.map(asTab);
 const index=tabCaptionIndex(properties,target);
 if(index<0||index>=tabs.length)return properties;
 tabs[index]={...tabs[index],label:value};
 return {...properties,tabs};
}

/** A single user-facing name for each metadata binding, shared by the selected
 * field icon and the existing Data ribbon. Property IDs remain unchanged. */
const bindingLabels:Record<string,Record<string,string>>={
 smart_numpad:{textSource:'Initial input value',customButton1Label:'Custom Button 1 label',
  customButton2Label:'Custom Button 2 label',customButton3Label:'Custom Button 3 label'},
 smart_tabs:{tabCaptionFormula:'Tab caption',textSource:'Tab caption',collectionFormula:'Tabs data source'},
 smart_selector:{selectorOptionsFormula:'Dropdown options',textSource:'Option caption'},
 smart_lookup:{label:'Search placeholder',lookupValueFormula:'Search value',textSource:'Result text',
  collectionFormula:'Lookup results source'},
 smart_cart:{label:'Cart title',collectionFormula:'Cart items source',textSource:'Product name',
  imageSource:'Product image',cartSupportingSource:'Item count / supporting text',
  subtotalValue:'Subtotal amount',totalValue:'Total amount',taxValue:'Tax amount',
  discountValue:'Discount amount',column2Source:'Unit price value',
  column3Source:'Quantity value',column4Source:'Row total value',
  column5Source:'Discount value'},
 smart_calendar:{selectedDate:'Selected date',calendarStartSource:'Appointment start',
  calendarEndSource:'Appointment end',calendarTitleSource:'Appointment caption',
  calendarStatusSource:'Appointment status'},
 smart_card_grid:{collectionFormula:'Product items source',textSource:'Product title'},
 smart_table:{textSource:'Table data source'},
 smart_navigation:{collectionFormula:'Navigation items source',textSource:'Item caption'}
};
export const bindingDisplayLabel=(api:string,propertyKey:string,fallback:string)=>
 bindingLabels[api]?.[propertyKey]??fallback;
