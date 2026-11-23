import {convertedFormula} from '../../../component-libraries/shared/formulaCodeLookup.js';
import {isSelectedSqlFormula} from '../../../component-libraries/shared/formulaKinds.js';
import {ID_CARD_ROW_PROPERTIES} from '../../../component-libraries/smart_id_card/idCardFields.mjs';

/** Configuration and data, not scalar display formulas. Keep the original bindings. */
const nonDisplayProperties=new Set([
 'xField','yField','widthField','heightField','rotationField','labelField','subLabelField','shapeField',
 'html','properties','record','records','items','pageState','sessionId','__formulaCode',
 'actionFlows','componentId','pageSessionKey','collectionFormula','selectorOptionsFormula','selectorPicklistField','filterFormula'
]);

/** These properties are consumed once PER authorised row by their component renderer.
 * Pre-evaluating one against records[0] turns every card, tab, cart line, table
 * cell or calendar event into the first row's value. Page-wide totals and
 * ordinary scalar properties remain evaluated once in this parent renderer.
 */
const rowDisplayProperties:Readonly<Record<string,ReadonlySet<string>>>={
 smart_spacemap:new Set(['colourFormula','borderFormula','badgeFormula','pulseWhen']),
 smart_card_grid:new Set(['itemDisabledWhen','textSource','imageSource','badgeText','cardDescription','cardValue',
  'cardButtonText','customButton1Label','customButton2Label']),
 smart_id_card:new Set(['textSource','imageSource','badgeText',...ID_CARD_ROW_PROPERTIES]),
 smart_cart:new Set(['textSource','imageSource','rowSupportingSource','column2Source',
  'column3Source','column4Source','column5Source','customButton1Label','customButton2Label']),
 smart_tabs:new Set(['itemDisabledWhen','textSource']),
 smart_selector:new Set(['itemDisabledWhen','textSource']),
 smart_navigation:new Set(['textSource']),
 smart_calendar:new Set(['calendarStartSource','calendarEndSource','calendarTitleSource','calendarStatusSource']),
 smart_table:new Set(['itemDisabledWhen','column2Source','column3Source','column4Source','column5Source']),
 smart_chart:new Set(['textSource','column2Source']),
 smart_line_items:new Set(['itemDisabledWhen','textSource','column2Source','column3Source','column4Source','column5Source']),
 // A standalone image can pick the first record whose own image source is nonblank.
 smart_image:new Set(['textSource','imageSource','badgeText'])
};

/** Reads only page or tenant values (@ThisPage, @ThisTenant): the same for every row. */
function readsNoRow(source:string):boolean{
 const refs=source.match(/@[A-Za-z][A-Za-z0-9_]*/g);
 return Boolean(refs?.length)&&refs!.every(ref=>/^@This(?:Page|Tenant)$/i.test(ref));
}

// Smart Table Columns: any column's Source and Color formula is read per row.
const tableRowProperty=(apiName:string,key:string)=>apiName==='smart_table'&&/^column(?:[1-9]|1[0-2])(?:Source|Color)$/.test(key);
export function isRowDisplayProperty(apiName:string,key:string,props:Readonly<Record<string,unknown>>):boolean {
 return Boolean((rowDisplayProperties[apiName]?.has(key)||tableRowProperty(apiName,key))
  &&(Array.isArray(props.records)||Array.isArray(props.items)||props.dataCollection));
}

export function resolveComponentFormulaProps(
 configuredProps:Record<string,unknown>,
 apiName:string,
 codeFunctions:Map<string,(row:Record<string,unknown>)=>unknown>|null,
 /** Page Builder design canvas: it never holds compiled page code (Preview does). */
 editorPreview=false
):Record<string,unknown>{
 const result:Record<string,unknown>={...configuredProps};
 const sqlRecord=configuredProps.record&&typeof configuredProps.record==='object'&&!Array.isArray(configuredProps.record)
  ?configuredProps.record as Record<string,unknown>
  :Array.isArray(configuredProps.records)&&configuredProps.records.length
   ?configuredProps.records[0] as Record<string,unknown>:undefined;
 for(const [key,source] of Object.entries(result)){
  if(typeof source!=='string'||nonDisplayProperties.has(key)
    ||isRowDisplayProperty(apiName,key,configuredProps)&&!readsNoRow(source))continue;
  const formulaLike=/^\s*=/.test(source)||/^\s*@[A-Za-z]/.test(source);
  const run=codeFunctions&&formulaLike
   ?codeFunctions.get(source.trim())??convertedFormula(codeFunctions,source)??undefined:undefined;
  if(!run&&!isSelectedSqlFormula(source))continue;
  if(run){
   try{result[key]=run(sqlRecord??{})??'';}
   catch(error){result[key]=(error as {notHeld?:boolean})?.notHeld?'':'FORMULAERROR';}
   continue;
  }
  if(typeof configuredProps.fieldAllowed==='function'&&
   !(configuredProps.fieldAllowed as (key:string,row:Record<string,unknown>)=>boolean)(key,sqlRecord??{}))
   continue;
  // A total over Objects with no page code was not converted: never another engine.
  // The design canvas has no page code at all, so a total there is a placeholder
  // (blank, shown as "—"), not an error; Preview and published pages stay strict.
  result[key]=editorPreview&&!codeFunctions?'':'FORMULAERROR';
 }
 return result;
}
