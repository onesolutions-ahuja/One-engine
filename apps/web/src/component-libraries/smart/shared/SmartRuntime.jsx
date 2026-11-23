import {convertedFormula,formulaConverter} from "../../shared/formulaCodeLookup.js";
import {buildCollectionSource} from "../../shared/collectionSource.js";
import {withRowTotals} from "../../shared/rowTotals.js";
import SmartCart from "../../smart_cart/SmartCart.jsx";
import SmartNumpad from "../../smart_numpad/SmartNumpad.jsx";
import SmartScheduleCalendar from "../../smart_calendar/SmartScheduleCalendar.jsx";
import SmartKeyboard from "../../smart_keyboard/SmartKeyboard.jsx";
import SmartDock from "../../smart_dock/SmartDock.jsx";
import SmartSearch from "../../smart_search/SmartSearch.jsx";
import icons from "../../smart_icon/iconCatalog.json";
import {smartShapeAppearance} from "./SmartShapeAppearance.js";
import {smartCustomButtonAppearance} from "./SmartCustomButtonAppearance.js";
import {smartPartOffsetStyle,smartPartOrderStyle} from "./SmartPartPlacement.js";
import {isSelectedSqlFormula} from "../../shared/formulaKinds.js";
import {useTenantImageSource} from "../../shared/TenantImage.jsx";
import SmartIdCardFields from "../../smart_id_card/SmartIdCardFields.jsx";
import {getTenantBrand,subscribeTenantBrand} from "../../shared/TenantBrand.js";
import {openKeypad,closeKeypad} from "./smartKeypadPopover.js";
// Smart ID Card is a Card Grid whose cards carry up to ten metadata fields: it reuses
// the same grid, records, selection, image, title, badge and events (no second engine).
const isGridKind=kind=>kind==="smart_card_grid"||kind==="smart_id_card";
const number=(v,f,min=0,max=2000)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):f;
const text=(v)=>v===null||v===undefined?"":String(v);
const formulaSourceFields=objects=>Array.isArray(objects)?Object.fromEntries(objects
 .filter(object=>object&&typeof object.apiName==="string"&&Array.isArray(object.fields))
 .map(object=>[object.apiName,object.fields.map(field=>field.apiName).filter(name=>typeof name==="string")])):undefined;
const expressionResult=(v,record,pageState,objectApiName,collectionSources,namedCollections,collectionRows,sessionId,readComponent,objects,codeLookup,designCanvas=false)=>{
 if(typeof v!=="string")return {value:text(v)};
 // Keep literal text and asset URLs unchanged; only formulas can fail.
 if(/^(?:https:\/\/|asset:|data:image\/)/i.test(v.trim()))return {value:v};
 // An email address ("qa@example.com") is a value; an @Object.Field reference starts with @.
 if(/^\s*[^\s@=(),"&]+@[^\s@]+\.[^\s@]+\s*$/.test(v))return {value:v};
 // A plain date or date-time ("2026-11-16") is a value, not a subtraction.
 if(/^\s*\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\s*$/.test(v))return {value:v};
 if(!/^\s*=/.test(v)&&!/@[A-Za-z]/.test(v)&&!/^\s*"/.test(v)&&
   !/^\s*-?(?:\d+(?:\.\d*)?|\.\d+)\s*[+\-*/&]/.test(v))return {value:v};
 // Static/SSR renders cannot execute effect-backed SQL requests. Preserve
 // permission-scoped collection evaluation until a browser SQL result exists.
 // SUM over the list's own loaded rows (a cart summary): each row runs the converted code.
 if(collectionRows!==undefined&&codeLookup&&codeLookup.rowTotals){
  const totals=codeLookup.rowTotals(v,collectionRows,record);
  if(totals)return totals;
 }
 // Page code: the page file's function, or the same converter run by the host for a
 // formula given at run time. There is no other formula engine.
 if(codeLookup){
  const codeResult=codeLookup(v,record);
  if(codeResult)return codeResult;
 }
 // The Page Builder design canvas holds no page totals (Preview does): a total
 // there is a blank placeholder, never an error and never another engine.
 if(designCanvas&&isSelectedSqlFormula(v))return {value:''};
 return {value:'',error:'This formula is not converted: save the page again'};
};
/** A fixed value inside a COLLECTION where no page code is present (a standalone preview). */
const collectionLiteral=node=>node&&node.kind==="literal"?node.value??"":"";
const expression=(...args)=>{
 const result=expressionResult(...args);
 // Non-display formula consumers retain their existing empty-value error contract.
 return result.error?"FORMULAERROR":text(result.value);
};
const formulaDisplayErrorColor="#dc2626";
/** One Smart blue for every default fill (buttons, tabs, badges, card buttons). */
const SMART_BLUE="#007aff";
/** Text colour readable on a fill: the authored colour when it is readable (contrast >= 3),
 * else white or near-black, whichever reads better. Black text on blue never appears. */
const hexRgb=c=>{const m=/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c||"").trim());if(!m)return null;
 const h=m[1].length===3?m[1].replace(/./g,x=>x+x):m[1];return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));};
const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;})
 .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
// A selected tab on a strong colour (iOS blue) reads white, not the dark label colour.
export function selectedTabText(fill,explicit){
 if(typeof explicit==="string"&&explicit)return explicit;
 const bg=hexRgb(fill);
 return bg&&luminance(bg)>0.45?"#1d1d1f":"#fff";
}
export function readableText(fill,preferred){
 const bg=hexRgb(fill);
 if(!bg)return preferred||undefined;
 const own=hexRgb(preferred);
 if(own&&contrast(bg,own)>=3)return preferred;
 return contrast(bg,[255,255,255])>=contrast(bg,[29,29,31])?"#fff":"#1d1d1f";
}
// Initials for a person/record card with no photo ("Jane Smith" → "JS").
const initialsOf=name=>String(name??"").trim().split(/\s+/).filter(Boolean).slice(0,2)
 .map(word=>word[0].toUpperCase()).join("");
function SmartPicture({src,alt,loadAsset,style,initials=false}){
 const source=useTenantImageSource(src,loadAsset);
 const [failed,setFailed]=React.useState(false);
 React.useEffect(()=>setFailed(false),[src]);
 // No picture (none set, or it failed to load): the same grey stripes the Page Builder
 // shows, so an empty image area reads as "no image" instead of a blank box.
 return source&&!failed?<img src={source} alt={alt} style={style} onError={()=>setFailed(true)}/>
  :initials&&initialsOf(alt)
   ?<div className="smart-image-initials" role="img" aria-label={alt}
     style={{...style,objectFit:undefined,display:"grid",placeItems:"center"}}>
     <span>{initialsOf(alt)}</span></div>
  :<div className="smart-image-none" role="img" aria-label={alt?alt+": no image":"No image"}
    style={{...style,objectFit:undefined,minHeight:style?.height===undefined?48:undefined}}/>;
}
// Reuse the normal authorised record-filter matcher for independent value
// visibility. Global object filtering/paging remains untouched.
const fieldAllows=(p,key,record)=>{
 if(typeof p.fieldAllowed==='function')return p.fieldAllowed(key,record??{});
 // Outside the authorised page runtime, reject configured scoped rules rather
 // than silently exposing an unverified value.
 return !p.dataFieldFilters||typeof p.dataFieldFilters!=='object'
   ||!Object.prototype.hasOwnProperty.call(p.dataFieldFilters,key);
};
const scopedExpression=(p,key,source,record)=>fieldAllows(p,key,record)
 ?(key==="textSource"&&p.dataCollection&&record&&
    (/(?:^|[=(,])\s*COLLECTION\s*\(/i.test(String(source??""))
     ||/^\s*=?\s*@[A-Za-z][A-Za-z0-9_]*\s*$/i.test(String(source??"")))
    ?text(isGridKind(p.kind)&&record.__collectionManual===false
      ?record.Name??"":record.__collectionLabel??record.Name??"")
    :expression(source,record,p.pageState,p.objectApiName,p.formulaCollectionSources,p.namedCollections,undefined,p.sessionId,p.readComponent,p.objects,p.__codeLookup,p.builderPreview===true)):"";
const scopedDisplayExpression=(p,key,source,record)=>{
 if(!fieldAllows(p,key,record))return {value:""};
 // A selected collection row already provides its authorised caption.
 if(key==="textSource"&&p.dataCollection&&record&&
   (/(?:^|[=(,])\s*COLLECTION\s*\(/i.test(String(source??""))
    ||/^\s*=?\s*@[A-Za-z][A-Za-z0-9_]*\s*$/i.test(String(source??""))))
  return {value:scopedExpression(p,key,source,record)};
 const result=expressionResult(source,record,p.pageState,p.objectApiName,
  p.formulaCollectionSources,p.namedCollections,undefined,p.sessionId,p.readComponent,p.objects,p.__codeLookup,p.builderPreview===true);
 return result.error?{value:"FORMULAERROR",error:result.error}:{value:result.value};
};
const recordOf=p=>p.objectApiName&&Array.isArray(p.records)
 ?(p.records[0]??{}):p.record&&typeof p.record==="object"&&!Array.isArray(p.record)?p.record:
 Array.isArray(p.records)&&p.records.length?p.records[0]:Array.isArray(p.items)&&p.items.length?p.items[0]:{};
// Editor-only examples are derived from the existing shared record source.
// They never have a database Id and never invoke a Flow action.
const editorCardRows=(count)=>Array.from({length:Math.min(36,Math.max(1,count))},(_,i)=>({
 __builderSample:true,Name:"Product Name "+(i+1),Price:"Price",Quantity:1
}));
const recordsOf=p=>{
 const records=Array.isArray(p.records)?p.records:Array.isArray(p.items)?p.items:[];
 return isGridKind(p.kind)&&p.builderPreview===true&&!p.loading&&!records.length
  ?editorCardRows(number(p.cardsPerRow,3)*number(p.cardsPerColumn,3)):records;
};
const isBuilderEmpty=p=>p.builderPreview===true&&!p.loading&&recordsOf(p).length===0;
// Image bindings must resolve once per authorised record, not once for the grid.
// Plain API names and @Field expressions both use the same record values.
const boundImage=(p,record)=>{
 if(!fieldAllows(p,'imageSource',record))return '';
  const source=p.imageSource??p.src??'';
 // An image binding is a row value, not a scalar formula. Resolve direct fields
 // from the row and relationship mentions from the metadata-hydrated values
 // before asking the general formula converter to evaluate anything.
 const binding=typeof source==='string'?/^=?\s*@((?:[A-Za-z][A-Za-z0-9_]*\.)*[A-Za-z][A-Za-z0-9_]*)\s*$/.exec(source.trim()):null;
 const path=binding?.[1];
 if(path&&record){
  if(!path.includes('.')&&Object.prototype.hasOwnProperty.call(record,path))return text(record[path]);
  const values=record.__mentionValues;
  if(path.includes('.')&&values&&typeof values==='object'&&!Array.isArray(values)){
   const exact='@'+path;
   if(Object.prototype.hasOwnProperty.call(values,exact))return text(values[exact]);
   // Legacy row bindings may omit the current object (`@Product.ImageUrl`),
   // while hydration stores the fully-qualified relationship path.
   const suffix='.'+path;
   const matches=Object.keys(values).filter(key=>key.endsWith(suffix));
   if(matches.length===1)return text(values[matches[0]]);
  }
 }
 return expression(source,record,p.pageState,p.objectApiName,p.formulaCollectionSources,p.namedCollections,undefined,p.sessionId,p.readComponent,p.objects,p.__codeLookup,p.builderPreview===true);
};
const gridText=(p,key,record)=>isGridKind(p.kind)
 ?scopedExpression(p,key,p[key]??"",record):"";
// A card's selection follows its authored Page State action (or named Collection).
// This shares the existing session binding: no separate Card Grid selection store.
const cardSelection=p=>{
 const action=p.actionFlows?.click;
 const formula=action?.actionType==="Formula"&&typeof action.formula==="string"
  ?/^@ThisPage\.[A-Za-z_][A-Za-z0-9_]{0,79}\.([A-Za-z][A-Za-z0-9_]{0,63})\s*:=\s*([\s\S]+)$/i.exec(action.formula.trim()):null;
 const stateKey=action?.actionType==="PageState"&&typeof action.stateKey==="string"
  ?action.stateKey:formula?.[1];
 const rhs=formula?.[2]?.trim();
 const source=rhs? /^@(?:[A-Za-z][A-Za-z0-9_]*\.)?([A-Za-z][A-Za-z0-9_]*)$/.exec(rhs)?.[1]:null;
 const pageValue=stateKey?p.pageState?.[stateKey]:undefined;
 if(pageValue!==undefined&&pageValue!==null&&pageValue!==""){
  const value=action?.actionType==="PageState"?String(action.value??""):"";
  const eventField=/^\$event\.record\.([A-Za-z][A-Za-z0-9_]*)$/.exec(value)?.[1];
  return {field:source||eventField||"Id",value:pageValue};
 }
 const collectionName=p.dataCollection?.name;
 const selected=collectionName&&p.pageState?.collectionSelections&&
  Object.entries(p.pageState.collectionSelections).find(([name])=>
   name.toLowerCase()===collectionName.toLowerCase())?.[1];
 return selected?{field:"Id",value:selected}:null;
};
const selectedCard=(selection,record)=>{
 if(!selection||!record)return false;
 const field=selection.field;
 const raw=selection.value;
 const value=raw&&typeof raw==="object"
  ?(raw.record?.[field]??raw[field]??(field==="Id"?raw.recordId??raw.id:undefined)??raw.value)
  :raw;
 const rowValue=record[field]??(field==="Id"?record.id:undefined);
 return value!==null&&value!==undefined&&value!==""&&
  rowValue!==null&&rowValue!==undefined&&String(value)===String(rowValue);
};
function SmartCard({p,record,onButtonClick,onCustomButton,onSelect,selected=false}){
 const image=boundImage(p,record);
 const imageError=image==='FORMULAERROR';
 // Distinguish an unset tenant brand from an unbound image in Builder previews.
 const tenantLogoReference=/^=?\s*@ThisTenant\.Company\.Logo$/i.test(String(p.imageSource??p.src??"").trim());
 const missingImageLabel=tenantLogoReference
  ?"Tenant logo unavailable — Company Settings › Branding":"Image Here";
 const preview=p.previewOnly===true||p.builderPreview===true||p.preview===true;
 const sample=Boolean(p.builderPreview===true&&record?.__builderSample===true);
 const headerResult=scopedDisplayExpression(p,"textSource",p.textSource??p.title??p.label??"",record);
 const header=text(headerResult.value)||(sample?"Product Name":preview?"Text here":"");
 const badgeResult=scopedDisplayExpression(p,"badgeText",p.badgeText??"",record);
 const badge=text(badgeResult.value);
 // Card Grid uses the same record-scoped, permission-aware formula evaluation as other Data fields.
 React.useEffect(()=>{
  if(p.kind==='smart_image')p.onFormulaDisplay?.({textSource:header,imageSource:image,badgeText:badge});
 },[p.kind,p.onFormulaDisplay,header,image,badge]);
 const description=gridText(p,"cardDescription",record);
 const value=gridText(p,"cardValue",record);
 const buttonText=gridText(p,"cardButtonText",record);
 const customButtons=["customButton1","customButton2"].filter(key=>
  p[key+"Visible"]!==false&&Boolean(p.builderPreview||p.actionFlows?.[key]||
   typeof p[key+"Label"]==="string"&&p[key+"Label"].trim()));
 const single=p.kind==="smart_image";
 const grid=isGridKind(p.kind);
 const idCard=p.kind==="smart_id_card";
 // An ID card shows its photo beside the details unless a placement is authored.
 const imagePlacement=p.imagePlacement||(idCard?"left":p.imagePlacement);
 const horizontal=["left","right"].includes(imagePlacement);
 const imageHeight=number(p.imageHeight,220,0,1200);
 // Keep the historical automatic image fill/50-50 split until a dimension is
 // authored. The image area uses height for top/bottom, width for left/right.
 const imageWidth=p.imageWidth===undefined||p.imageWidth===null||p.imageWidth===""
  ?null:number(p.imageWidth,0,0,1200);
 const hasImageHeight=p.imageHeight!==undefined&&p.imageHeight!==null&&p.imageHeight!=="";
 const imageVisible=horizontal?imageWidth!==0:imageHeight>0;
 const headerHeight=number(p.headerBoxHeight,44,0,1200);
 // Optional shared Card Grid spacing keeps the historic 4px/10px layout
 // until a tenant explicitly configures the new Card Padding control.
 const cardPadding=grid&&p.cardPadding!==undefined&&p.cardPadding!==null&&p.cardPadding!==""
  ?number(p.cardPadding,10,0,160):null;
 const focused=grid&&selected;
 const focusedWidth=number(p.focusedCardWidth,0,0,1200);
 const focusedHeight=number(p.focusedCardHeight,0,0,1200);
 // An explicitly authored Card Grid header height is a bounded box, not merely
 // a minimum. Unconfigured grids and standalone Images keep intrinsic growth.
 const fixedGridHeader=grid&&p.headerBoxHeight!==undefined
   &&p.headerBoxHeight!==null&&p.headerBoxHeight!=="";
 const captionFontSize=focused&&p.focusedTextSize!==undefined
   &&p.focusedTextSize!==null&&p.focusedTextSize!==""
   ?number(p.focusedTextSize,16,8):number(p.textSize,16,8);
 // Keep as much vertical padding as fits one text line in a compact header.
 const headerPaddingY=fixedGridHeader
   ?Math.min(cardPadding===null?4:cardPadding,
     Math.max(0,Math.floor((headerHeight-Math.ceil(captionFontSize*1.2))/2)))
   :null;
 const focusedText=focused&&p.focusedTextColor?String(p.focusedTextColor):null;
 const focusedWeight=focused&&typeof p.focusedTextBold==="boolean"
  ?(p.focusedTextBold?700:400):undefined;
 // Standalone Image has exactly ONE decorative stroke, on the native image.
 // A card-grid item remains a separate card with an optional image stroke.
 // Never paint an implicit card border around an independently bordered Image.
 const strokeWidth=p.borderWidth===undefined?1:number(p.borderWidth,1,0,24);
 const imageStroke=p.imageBorderColor||(single?p.borderColor:undefined);
 const nativeImageBorder=imageStroke&&strokeWidth>0?strokeWidth+"px solid "+imageStroke:undefined;
 const activeShadow=focused&&p.focusedCardShadow!==undefined&&p.focusedCardShadow!==null
  ?p.focusedCardShadow:p.shadow;
 const cardBorder=single?"none":strokeWidth===0?"none":
  (strokeWidth+"px solid "+(p.borderColor||"#e2e8f0"));
 const headerWrap=p.headerWrapText??p.wrapText;
 const headerNode=header&&headerHeight>0&&<div data-md-bind={p.builderPreview?"textSource":undefined} data-md-bind-titles={p.builderPreview?"Card title":undefined} className="smart-card-content" style={{
     ...smartPartOffsetStyle(p,"header"),order:1,flex:horizontal&&!idCard?(imageVisible?"1 1 50%":"1 1 100%"):undefined,
     display:"flex",alignItems:fixedGridHeader?"safe center":"center",
     // Explicit Card Grid heights bound the title box; overflow remains accessible without a visible scrollbar.
     // Standalone Image captions retain intrinsic growth for large typography.
     height:headerHeight,minHeight:fixedGridHeader?0:"max-content",
     width:(grid||single)&&p.headerBoxWidth!==undefined&&p.headerBoxWidth!==null&&p.headerBoxWidth!==""
       ?"min(100%, "+number(p.headerBoxWidth,0,0,1200)+"px)":undefined,
     maxHeight:fixedGridHeader?headerHeight:undefined,
     alignSelf:horizontal&&!idCard?"safe center":undefined,flexShrink:0,
     fontWeight:focusedWeight??(p.headerBold===false?400:700),
     // Standalone Image's visible caption is edited by the shared Typography
     // Label Alignment control; Card Grid retains its prior Header precedence.
     textAlign:(single?p.labelAlignment||p.headerAlignment:p.headerAlignment||p.labelAlignment)||"left",
     justifyContent:(single?p.labelAlignment||p.headerAlignment:p.headerAlignment||p.labelAlignment)==="right"?"flex-end":
       (single?p.labelAlignment||p.headerAlignment:p.headerAlignment||p.labelAlignment)==="center"?"center":"flex-start",
     fontSize:p.headerTextSize!==undefined&&p.headerTextSize!==null&&p.headerTextSize!==""
       ?number(p.headerTextSize,16,8,96):single?number(p.textSize,16,8):undefined,
     border:p.headerBorderColor?"1px solid "+p.headerBorderColor:undefined,
     borderRadius:p.headerRadius!==undefined?number(p.headerRadius,0,0,600):undefined,
     boxShadow:p.headerShadow==="large"?"0 8px 20px #0003":p.headerShadow==="medium"?"0 3px 9px #0003":p.headerShadow==="small"?"0 1px 4px #0002":undefined,
     backgroundColor:p.headerBodyColor||undefined,
     color:headerResult.error?formulaDisplayErrorColor:
      focusedText||p.headerTextColor||(single?p.labelColor||p.defaultValueColor||undefined:p.defaultValueColor||p.labelColor||undefined),
     // pre-line: wraps like normal, and a CHAR(10) in a formula starts a new line.
     whiteSpace:headerWrap===false?"nowrap":"pre-line",
     overflow:fixedGridHeader?"auto":headerWrap===false?"auto":"visible",overflowWrap:"anywhere",
     // A caption can still scroll by wheel/touch, but never shows native scroll arrows.
     scrollbarWidth:fixedGridHeader||headerWrap===false?"none":undefined,
     padding:fixedGridHeader
       ?headerPaddingY+"px "+(cardPadding===null?10:cardPadding)+"px"
       :cardPadding===null?"4px 10px":cardPadding+"px"
   }} data-design-area={p.builderPreview?"Header":undefined}>{header}</div>;
 return <article className="smart-card"
  data-design-area={p.builderPreview&&grid?"Card Body":undefined}
  onClick={onSelect?event=>{if(event.target.closest("button"))return;onSelect();}:undefined}
  onKeyDown={onSelect?event=>{
   if(event.target!==event.currentTarget)return;
   if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelect();}
  }:undefined}
  role={onSelect?"button":undefined} tabIndex={onSelect?0:undefined} style={{
  display:"flex",flexDirection:horizontal?"row":"column",
  background:grid&&selected&&p.selectedCardColor?p.selectedCardColor:
   single?(p.imageBackgroundColor??p.backgroundColor??"transparent"):(p.backgroundColor||"#fff"),
  border:focused&&p.focusedCardBorderColor
   ?Math.max(1,strokeWidth)+"px solid "+p.focusedCardBorderColor:cardBorder,
  // A font size entered in Design must not be silently reduced to 96px.
  // Preserve existing overflow behaviour for large authored content, but hide
  // the unwanted card-level scrollbar in Card Grid.
  borderRadius:number(p.radius,12),overflow:"hidden",overflowY:"auto",scrollbarWidth:grid?"none":undefined,position:"relative",minWidth:0,
  fontSize:focused&&p.focusedTextSize!==undefined&&p.focusedTextSize!==null&&p.focusedTextSize!==""
   ?number(p.focusedTextSize,16,8):number(p.textSize,16,8),
  color:focusedText||undefined,
  boxShadow:activeShadow==="large"?"0 8px 20px #0003":activeShadow==="medium"?"0 3px 9px #0003":activeShadow==="small"?"0 1px 4px #0002":"none",
  ...(single?{height:"100%",minHeight:0}:{}),
  ...(grid?{height:"100%",minHeight:0}:{}),
  ...(focused&&focusedWidth>0?{width:"min(100%, "+focusedWidth+"px)"}:{}),
  ...(focused&&focusedHeight>0?{height:"min(100%, "+focusedHeight+"px)"}:{}),
  ...(focused&&(focusedWidth>0||focusedHeight>0)?{margin:"auto"}:{})
 }} data-selected={selected?"true":undefined}>
  {imageVisible&&<div data-design-area={p.builderPreview?"Image":undefined} data-md-bind={p.builderPreview?"imageSource":undefined} data-md-bind-titles={p.builderPreview?"Card image":undefined} style={{...smartPartOffsetStyle(p,"image"),order:["right","bottom"].includes(imagePlacement)?2:0,
    flex:horizontal?(imageWidth!==null?"0 0 "+imageWidth+"px":idCard?"0 0 34%":"1 1 50%"):
      single?(hasImageHeight?"0 1 "+imageHeight+"px":"1 1 auto"):
      grid?(hasImageHeight?"0 0 "+imageHeight+"px":"1 1 "+imageHeight+"px"):undefined,
    // A user-defined side image cannot squeeze adjacent text to zero. A
    // captionless standalone Image can still use its full component width.
    maxWidth:horizontal&&imageWidth!==null
      ?(grid||header?"calc(100% - 96px)":"100%"):undefined,
    minWidth:0,minHeight:0,
    ...(single?{display:"flex"}:{}),
    ...(grid?{overflow:"hidden",maxHeight:horizontal?undefined:imageHeight,
      backgroundColor:p.imageBackgroundColor||undefined}:{} ),
    borderRadius:p.imageRadius!==undefined?number(p.imageRadius,0,0,600):undefined,
    boxShadow:p.imageShadow==="large"?"0 8px 20px #0003":p.imageShadow==="medium"?"0 3px 9px #0003":p.imageShadow==="small"?"0 1px 4px #0002":undefined}}>
   {imageError?<span role="alert" style={{color:formulaDisplayErrorColor,padding:8}}>FORMULAERROR</span>
    :single&&p.builderPreview&&!image
     ?<div className="smart-image-empty smart-editor-image-placeholder" aria-label={missingImageLabel}
        style={{height:"100%",width:"100%",border:nativeImageBorder,
          borderRadius:number(p.radius,12),boxSizing:"border-box",overflow:"hidden"}}>
        <span>{missingImageLabel}</span>
      </div>
     // Builder only: an unbound image keeps a visible "Image Here" box on real
     // rows too, so its Data Source icon stays reachable after an object is chosen.
     :grid&&preview&&!image&&(sample||p.builderPreview!==true||!String(p.imageSource??p.src??"").trim())
    ?<div className="smart-card-image-placeholder" aria-hidden="true" style={{
       height:"100%",minHeight:0,display:"grid",placeItems:"center",
       background:"var(--md-card-placeholder,#edf2f7)",color:"#526276",fontSize:12
     }}>Image Here</div>
    :<SmartPicture src={image} alt={header} loadAsset={p.loadAsset} initials={idCard}
      style={{height:single||grid?"100%":imageHeight,width:"100%",display:"block",
       maxHeight:grid?"100%":undefined,
       objectFit:p.imageFill==="fit"?"contain":p.imageFill==="stretch"?"fill":"cover",
       boxSizing:"border-box",borderRadius:single?number(p.imageRadius??p.radius,12):p.imageRadius!==undefined?number(p.imageRadius,0,0,600):undefined,
       border:nativeImageBorder}}/>}
  </div>}
  {idCard?<div className="smart-id-card-body" style={{order:1,flex:"1 1 auto",minWidth:0,minHeight:0,
    display:"flex",flexDirection:"column",overflow:"auto",scrollbarWidth:"thin"}}>
   {headerNode}
   <SmartIdCardFields p={p} record={record} sample={sample}
    resolve={(key,source)=>scopedDisplayExpression(p,key,source,record)}
    offsetStyle={key=>smartPartOffsetStyle(p,key)}
    padding={cardPadding} focusedText={focusedText} errorColor={formulaDisplayErrorColor}/>
  </div>:headerNode}
  {grid&&!idCard&&(description||value||buttonText||customButtons.length>0||p.builderPreview)&&<div className="smart-card-details"
   // After the title (order 1): name first, then price / description / buttons.
   style={{order:2,...(cardPadding===null?{}:{padding:cardPadding+"px"})}}>
   {(description||p.builderPreview)&&<span data-md-bind={p.builderPreview?"cardDescription":undefined} data-md-bind-titles={p.builderPreview?"Card description":undefined} className="smart-card-description" data-design-area={p.builderPreview?"Header Supporting":undefined} 
     style={{...smartPartOffsetStyle(p,"supporting"),color:description==='FORMULAERROR'?formulaDisplayErrorColor:
      focusedText||p.supportingTextColor||undefined,
      backgroundColor:p.supportingBackgroundColor||undefined,
      border:p.supportingBorderColor?"1px solid "+p.supportingBorderColor:undefined,
      fontWeight:focusedWeight??(typeof p.supportingBold==="boolean"?(p.supportingBold?700:400):undefined),
      fontSize:p.supportingTextSize!==undefined&&p.supportingTextSize!==null&&p.supportingTextSize!==""
       ?number(p.supportingTextSize,14,8,96):undefined,
      width:p.supportingBoxWidth!==undefined&&p.supportingBoxWidth!==null&&p.supportingBoxWidth!==""?number(p.supportingBoxWidth,0,0,1200)+"px":undefined,
      minHeight:p.supportingBoxHeight!==undefined&&p.supportingBoxHeight!==null&&p.supportingBoxHeight!==""?number(p.supportingBoxHeight,0,0,1200)+"px":undefined,
      borderRadius:p.supportingRadius!==undefined?number(p.supportingRadius,0,0,600):undefined,
      boxShadow:p.supportingShadow==="large"?"0 8px 20px #0003":p.supportingShadow==="medium"?"0 3px 9px #0003":p.supportingShadow==="small"?"0 1px 4px #0002":undefined,
      whiteSpace:p.supportingWrapText===false?"nowrap":p.supportingWrapText===true?"pre-line":undefined,
      textAlign:["left","center","right"].includes(p.supportingAlignment)?p.supportingAlignment:undefined}}>{description||(p.builderPreview?"Supporting text":"")}</span>}
   {(value||buttonText||customButtons.length>0||p.builderPreview)&&<div data-design-area={p.builderPreview?"Footer":undefined} className="smart-card-footer"
    style={{...smartPartOffsetStyle(p,"footer"),backgroundColor:p.footerBackgroundColor||undefined,
     border:p.footerBorderColor?"1px solid "+p.footerBorderColor:undefined,
     borderRadius:p.footerRadius!==undefined?number(p.footerRadius,0,0,600):undefined,
     boxShadow:p.footerShadow==="large"?"0 8px 20px #0003":p.footerShadow==="medium"?"0 3px 9px #0003":p.footerShadow==="small"?"0 1px 4px #0002":undefined,
     whiteSpace:p.footerWrapText===false?"nowrap":p.footerWrapText===true?"normal":undefined,
     height:p.footerHeight!==undefined&&p.footerHeight!==null&&p.footerHeight!==""
      ?number(p.footerHeight,0,0,1200):undefined,
     minHeight:p.footerHeight!==undefined&&p.footerHeight!==null&&p.footerHeight!==""
      ?number(p.footerHeight,0,0,1200):undefined,
     width:p.footerWidth!==undefined&&p.footerWidth!==null&&p.footerWidth!==""
      ?number(p.footerWidth,0,0,1200)+"px":undefined,
     maxWidth:"100%",
     justifyContent:p.footerAlignment==="center"?"center":p.footerAlignment==="right"?"flex-end":
      p.footerAlignment==="left"?"flex-start":undefined}}>
    {!value&&!buttonText&&!customButtons.length&&p.builderPreview&&<strong className="smart-card-value" style={{fontSize:12,opacity:.65}}>Footer</strong>}
    {value&&<strong data-md-bind={p.builderPreview?"cardValue":undefined} data-md-bind-titles={p.builderPreview?"Card value":undefined} className="smart-card-value"
      style={{color:value==='FORMULAERROR'?formulaDisplayErrorColor:
       focusedText||p.footerTextColor||undefined,
       fontWeight:focusedWeight??(typeof p.footerBold==="boolean"?(p.footerBold?700:400):undefined),
       fontSize:p.footerTextSize!==undefined&&p.footerTextSize!==null&&p.footerTextSize!==""
        ?number(p.footerTextSize,19,8,96):undefined}}>{value}</strong>}
    {(buttonText||p.builderPreview)&&<button data-md-bind={p.builderPreview?"cardButtonText":undefined} data-md-bind-titles={p.builderPreview?"Card button text":undefined} type="button" data-design-area={p.builderPreview?"Button 3":undefined} className="smart-card-button"
      disabled={!onButtonClick||p.builderPreview} aria-label={buttonText||"Button"}
      style={{
       ...smartPartOrderStyle(p.cardButtonPlacement,"right"),
       ...smartPartOffsetStyle(p,"cardButton"),
       backgroundColor:p.cardButtonFill||p.accentColor||SMART_BLUE,
       borderColor:p.cardButtonBorderColor||p.cardButtonFill||p.accentColor||SMART_BLUE,
       ...smartShapeAppearance(p.cardButtonShape||"shape:round-rectangle",
        p.cardButtonRadius!==undefined&&p.cardButtonRadius!==null&&p.cardButtonRadius!==""
         ?number(p.cardButtonRadius,8,0,200)
         :p.cardButtonShape==="shape:rectangle"?0:8),
       color:readableText(p.cardButtonFill||p.accentColor||SMART_BLUE,p.cardButtonTextColor)||"#fff",
       fontSize:number(p.cardButtonTextSize,14,8,48),
       boxShadow:p.cardButtonShadow==="large"?"0 8px 20px #0003":p.cardButtonShadow==="medium"?"0 3px 9px #0003":p.cardButtonShadow==="small"?"0 1px 4px #0002":undefined,
       width:p.cardButtonWidth!==undefined&&p.cardButtonWidth!==null&&p.cardButtonWidth!==""
        ?number(p.cardButtonWidth,0,0,1200)+"px":undefined,
       height:p.cardButtonHeight!==undefined&&p.cardButtonHeight!==null&&p.cardButtonHeight!==""
        ?number(p.cardButtonHeight,0,0,1200)+"px":undefined,
       fontWeight:typeof p.cardButtonBold==="boolean"?(p.cardButtonBold?700:400):undefined,
       whiteSpace:p.cardButtonWrapText===false?"nowrap":
        p.cardButtonWrapText===true?"normal":undefined,
       // Design 2 Button R3C2 aligns the button caption, not the card header.
       textAlign:["left","center","right"].includes(p.cardButtonAlignment)
        ?p.cardButtonAlignment:undefined,
       justifyContent:p.cardButtonAlignment==="left"?"flex-start":
        p.cardButtonAlignment==="right"?"flex-end":
        p.cardButtonAlignment==="center"?"center":undefined
      }}
      onClick={event=>{event.stopPropagation();onButtonClick?.();}}>{buttonText||(p.builderPreview?"Button":"")}</button>}
    {customButtons.map(key=>{
     const label=gridText(p,key+"Label",record)||(key==="customButton1"?"+":"−");
     return <button key={key} data-md-bind={p.builderPreview?(key+"Label"):undefined} data-design-area={p.builderPreview?(key==="customButton1"?"Button":"Button 2"):undefined} type="button" className="smart-card-button smart-card-custom-action"
      style={{...smartCustomButtonAppearance(p,key),...smartPartOrderStyle(p[key+"Placement"],"right"),...smartPartOffsetStyle(p,key)}} disabled={!p.actionFlows?.[key]||!onCustomButton||p.previewOnly||p.builderPreview}
      aria-label={label}
      onClick={event=>{event.stopPropagation();onCustomButton?.(key);}}>{label}</button>;
    })}
   </div>}
  </div>}
  {(Boolean(badge)||p.builderPreview)&&<span title={badgeResult.error||undefined} data-design-area={p.builderPreview?"Badge":undefined} data-md-bind={p.builderPreview?"badgeText":undefined} data-md-bind-titles={p.builderPreview?"Badge text":undefined} className={"smart-badge "+(p.badgeAlignment||"image-top-right")}
   style={{...smartPartOffsetStyle(p,"badge"),fontWeight:p.badgeBold===false?400:700,fontSize:number(p.badgeTextSize,12),
   color:badgeResult.error?formulaDisplayErrorColor:readableText(p.badgeBodyColor||SMART_BLUE,p.badgeTextColor)||"#fff",
   background:badgeResult.error?"#fff":p.badgeBodyColor||SMART_BLUE,
   border:p.badgeBorderColor?"1px solid "+p.badgeBorderColor:undefined,
   borderRadius:p.badgeRadius!==undefined&&p.badgeRadius!==null&&p.badgeRadius!==""
    ?number(p.badgeRadius,0,0,200):undefined,
   width:p.badgeWidth!==undefined&&p.badgeWidth!==null&&p.badgeWidth!==""
    ?number(p.badgeWidth,0,0,1200)+"px":undefined,
   height:p.badgeHeight!==undefined&&p.badgeHeight!==null&&p.badgeHeight!==""
    ?number(p.badgeHeight,0,0,1200)+"px":undefined,
   boxShadow:p.badgeShadow==="large"?"0 8px 20px #0003":p.badgeShadow==="medium"?"0 3px 9px #0003":p.badgeShadow==="small"?"0 1px 4px #0002":undefined,
   textAlign:p.badgeTextAlignment||undefined,
   whiteSpace:p.badgeWrapText===false?"nowrap":p.badgeWrapText===true?"normal":undefined,
   boxSizing:"border-box",
   ...(p.badgeWidth!==undefined&&p.badgeWidth!==null&&p.badgeWidth!==""||
       p.badgeHeight!==undefined&&p.badgeHeight!==null&&p.badgeHeight!==""
       ?{display:"inline-flex",alignItems:"center",justifyContent:p.badgeTextAlignment==="left"?"flex-start":p.badgeTextAlignment==="right"?"flex-end":"center"}:{})
   }}>{badge||(p.builderPreview?"Badge":"")}</span>}
 </article>;
}
/**
 * A simple dropdown, not a search/lookup. The initial value is always the
 * zero-based first option; options use the same authorised Object/Collection rows
 * as Tabs and Card Grid, or an explicit Page State array.
 */
function selectorPicklist(ref,objects){
 const match=/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(typeof ref==="string"?ref.trim():"");
 if(!match||!Array.isArray(objects))return null;
 const field=objects.find(object=>object?.apiName===match[1])?.fields?.find(item=>item?.apiName===match[2]);
 if(!Array.isArray(field?.picklistValues))return null;
 return field.picklistValues.map(value=>typeof value==="string"?value:value?.value??value?.label)
  .filter(value=>typeof value==="string"&&value).slice(0,200);
}
function SmartSelector({p,fire}){
 // Prefer Page Runtime's authorised collection. When a standalone editor or
 // Flow preview has no collection owner, resolve the same bounded typed
 // COLLECTION/TABLE expression against ONLY the already-authorised sources.
 // No lookup queries, new evaluator, or untrusted JSON parsing.
 const sourced=Array.isArray(p.dataCollection?.items);
 const formula=typeof p.selectorOptionsFormula==="string"?p.selectorOptionsFormula.trim():"";
 const fallback=!sourced&&formula?buildCollectionSource(formula,
   p.formulaCollectionSources??{},formulaSourceFields(p.objects),
   node=>{const converter=formulaConverter(p);
    return converter?converter.compileNode(node)(recordOf(p)):collectionLiteral(node);}):null;
 const formulaItems=Array.isArray(fallback?.value?.items)?fallback.value.items:null;
 // "Picklist field" (Object.Field): the field's picklist values from Object Manager, so a
 // reason list is edited in one place and every selector using it follows.
 const picklistItems=selectorPicklist(p.selectorPicklistField,p.objects);
 const rows=sourced?recordsOf(p)
  :picklistItems??formulaItems??(Array.isArray(p.options)&&p.options.length?p.options
   :Array.isArray(p.items)&&p.items.length?p.items:recordsOf(p));
 const options=rows.slice(0,200).map((raw,index)=>{
  const row=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{Name:raw,__collectionValue:raw};
  const caption=p.textSource?scopedExpression(p,"textSource",p.textSource,row):"";
  const label=text(caption||(row.__collectionLabel??row.label??row.Name??row.name??row.title??row.id??""));
  return {index,label,value:row.__collectionValue??row.value??row.Id??row.id??index,record:row};
 });
 const fingerprint=JSON.stringify(options.map(item=>[item.label,item.value]));
 // Nothing is chosen until the user picks (or the page gives a value, e.g.
 // @ThisPage.Category.Value = pr.MenuCategory): the box shows its placeholder, never a
 // silently pre-selected first row whose value was never published.
 const [active,setActive]=React.useState(-1);
 React.useEffect(()=>setActive(-1),[fingerprint]);
 if(p.selectorMultiSelect===true)return <SmartMultiSelector p={p} fire={fire} options={options} fingerprint={fingerprint}/>;
 const given=p.value!==undefined&&p.value!==null&&p.value!==""?p.value
  :typeof p.defaultValue==="string"&&p.defaultValue.trim()?scopedExpression(p,"defaultValue",p.defaultValue,recordOf(p)):"";
 const preset=given===""||given===undefined||given===null?-1
  :options.findIndex(item=>String(item.value)===String(given)||item.label===String(given));
 const selected=active>=0&&active<options.length?active:preset;
 const placeholder=text(scopedExpression(p,"label",p.placeholder??p.label??"Select",recordOf(p)));
 return <div className="smart-selector"
   data-md-bind={p.builderPreview&&p.selectorOptionsFormula?"selectorOptionsFormula":undefined}
   style={{fontSize:number(p.textSize,16),color:p.labelColor||"#263b56",
    "--smart-selector-bg":p.backgroundColor||"#fff",
    "--smart-selector-fg":p.labelColor||"#263b56",
    "--smart-selector-focus":p.defaultValueColor||SMART_BLUE}}>
  <select className="smart-selector-control" role="combobox"
   data-md-bind={p.builderPreview?"textSource":undefined}
   aria-label={placeholder} disabled={p.disabled===true||options.length===0}
   style={{textAlign:p.labelAlignment||"left",
    border:p.borderColor?"1px solid "+p.borderColor:"1px solid #b8c7d7",
    ...smartShapeAppearance(p.shapeId,number(p.radius,12)),
    boxShadow:p.shadow==="large"?"0 8px 20px #0003":
     p.shadow==="medium"?"0 3px 9px #0003":p.shadow==="small"?"0 1px 4px #0002":"none"}}
   value={selected<0?"":String(selected)} data-empty={selected<0?"true":undefined}
   onChange={event=>{
    const index=Number(event.target.value),item=options[index];
    if(!item)return;
    setActive(index);
    fire("change",{index,value:item.value,label:item.label,record:item.record});
   }}>
   {selected<0&&<option value="" disabled>{options.length?placeholder:"No options"}</option>}
   {options.map(item=><option value={String(item.index)} key={item.index}>{item.label}</option>)}
  </select>
 </div>;
}
/** Multi-select: a compact button ("Categories (3)") opening a checkbox list with
 * search, Select all and Clear. Its value is the ticked values joined by ";", so a
 * filter reads it with INCLUDES(@ThisPage.Name.Selected.Value, @Object.Field).
 * Nothing ticked = blank value (show everything). */
function SmartMultiSelector({p,fire,options,fingerprint}){
 const [picked,setPicked]=React.useState(()=>new Set());
 const [open,setOpen]=React.useState(false);
 const [query,setQuery]=React.useState("");
 const root=React.useRef(null);
 React.useEffect(()=>{setPicked(current=>new Set([...current].filter(value=>options.some(item=>String(item.value)===value))));},[fingerprint]);
 React.useEffect(()=>{
  if(!open)return;
  const away=event=>{if(root.current&&!root.current.contains(event.target))setOpen(false);};
  const key=event=>{if(event.key==="Escape")setOpen(false);};
  document.addEventListener("pointerdown",away);document.addEventListener("keydown",key);
  return ()=>{document.removeEventListener("pointerdown",away);document.removeEventListener("keydown",key);};
 },[open]);
 const publish=next=>{
  setPicked(next);
  const chosen=options.filter(item=>next.has(String(item.value)));
  fire("change",{value:chosen.map(item=>String(item.value)).join(";"),
   label:chosen.map(item=>item.label).join(", ")});
 };
 const toggle=value=>{const next=new Set(picked);if(next.has(value))next.delete(value);else next.add(value);publish(next);};
 const term=query.trim().toLowerCase();
 const visible=options.filter(item=>!term||item.label.toLowerCase().includes(term));
 const caption=text(scopedExpression(p,"label",p.placeholder??p.label??"Select",recordOf(p)));
 return <div className="smart-selector smart-multi-selector" ref={root}
   style={{fontSize:number(p.textSize,16),color:p.labelColor||"#263b56",
    "--smart-selector-bg":p.backgroundColor||"#fff","--smart-selector-fg":p.labelColor||"#263b56",
    "--smart-selector-focus":p.defaultValueColor||SMART_BLUE}}>
  <button type="button" className="smart-selector-control smart-multi-selector-button" aria-haspopup="listbox"
   aria-expanded={open} disabled={p.disabled===true||options.length===0}
   style={{textAlign:p.labelAlignment||"left",
    border:p.borderColor?"1px solid "+p.borderColor:"1px solid #b8c7d7",
    ...smartShapeAppearance(p.shapeId,number(p.radius,12))}}
   onClick={()=>{if(!p.builderPreview)setOpen(value=>!value);}}>
   <span>{caption}{picked.size?" ("+picked.size+")":""}</span><span aria-hidden="true">▾</span>
  </button>
  {open&&<div className="smart-multi-selector-panel" role="listbox" aria-multiselectable="true" aria-label={caption}>
   <input className="smart-multi-selector-search" type="search" placeholder="Search…" aria-label={"Search "+caption}
    value={query} onChange={event=>setQuery(event.target.value)} autoFocus/>
   <div className="smart-multi-selector-tools">
    <button type="button" onClick={()=>publish(new Set(options.map(item=>String(item.value))))}>Select all</button>
    <button type="button" onClick={()=>publish(new Set())}>Clear</button>
   </div>
   <div className="smart-multi-selector-list">
    {visible.map(item=>{const value=String(item.value);return <label key={item.index} className="smart-multi-selector-item">
     <input type="checkbox" checked={picked.has(value)} onChange={()=>toggle(value)}/>{item.label}</label>;})}
    {!visible.length&&<p className="smart-multi-selector-empty">No matches</p>}
   </div>
  </div>}
 </div>;
}
function SmartLookup({p,style,fire}){
 const querySource=scopedExpression(p,"lookupValueFormula",p.lookupValueFormula??"",recordOf(p));
 const [query,setQuery]=React.useState(querySource);
 React.useEffect(()=>setQuery(querySource),[querySource]);
 const placeholder=scopedExpression(p,"label",p.placeholder??p.label??"Search records…",recordOf(p));
 const [opened,setOpened]=React.useState(false);
 const [results,setResults]=React.useState([]);
 const [busy,setBusy]=React.useState(false);
 const [searchError,setSearchError]=React.useState("");
 const listId=React.useId();
 const search=typeof p.searchRecords==="function"?p.searchRecords:null;
 // Search a full authorised Object, not the grid's currently loaded rows.
 // Debounce and cancel obsolete responses so typing cannot show stale matches.
 React.useEffect(()=>{
  let active=true;
  const term=query.trim();
  setResults([]);
  setSearchError("");
  setBusy(false);
  if(!opened||!term||p.builderPreview||p.previewOnly)return()=>{active=false};
  if(!search){
   setSearchError("Search Box requires an Object search source");
   return()=>{active=false};
  }
  setBusy(true);
  const timer=setTimeout(()=>{
   Promise.resolve().then(()=>search(term)).then(rows=>{
    if(active)setResults(Array.isArray(rows)?rows.slice(0,20):[]);
   }).catch(error=>{
    if(active)setSearchError(error instanceof Error?error.message:"Record search failed");
   }).finally(()=>{if(active)setBusy(false)});
  },300);
  return()=>{active=false;clearTimeout(timer)};
 },[query,search,opened,p.objectApiName,p.previewOnly,p.builderPreview]);
 const candidates=p.builderPreview||p.previewOnly
  ?recordsOf(p).slice(0,200).filter(row=>row&&typeof row==="object"):[...results];
 const display=row=>text(scopedExpression(p,"textSource",p.textSource??row.Name??row.name??row.label??row.title??row.Id??row.id??"",row));
 const matches=p.builderPreview||p.previewOnly
  ?candidates.filter(row=>display(row).toLowerCase().includes(query.toLowerCase())).slice(0,20):candidates;
 return <div data-md-bind={p.builderPreview&&p.collectionFormula?"collectionFormula":undefined} className="smart-lookup" style={{...style,"--smart-placeholder-color":p.labelColor||"#64748b"}}>
  <input data-md-bind={p.builderPreview?"label lookupValueFormula":undefined} data-md-bind-titles={p.builderPreview?"Search placeholder|Search value":undefined} className="smart-search" type="search" role="combobox"
   aria-label={text(placeholder||"Search records")}
   aria-expanded={opened&&matches.length>0} aria-controls={listId}
   placeholder={text(placeholder||"Search records…")}
   style={{textAlign:p.labelAlignment||"left",fontSize:number(p.textSize,16),color:p.labelColor||undefined,
    fontWeight:p.headerBold===true?700:p.headerBold===false?400:undefined,
    boxShadow:p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":p.shadow==="small"?"0 1px 4px #0002":"none",
    background:p.backgroundColor||"#fff",borderColor:p.borderColor||undefined,
    ...smartShapeAppearance(p.shapeId,number(p.radius,12))}}
   value={query} onFocus={()=>setOpened(true)}
   onChange={event=>{setQuery(event.target.value);setOpened(true);fire("change",event.target.value)}}/>
  {opened&&query.trim()&&matches.length>0&&<div id={listId} className="smart-lookup-menu" role="listbox" style={{textAlign:p.labelAlignment||"left",fontSize:number(p.textSize,16)}}>
   {matches.map((record,i)=><button type="button" key={text(record.Id??record.id??i)} role="option"
    aria-selected={false} style={{textAlign:"inherit",fontSize:"inherit"}} onMouseDown={event=>event.preventDefault()}
    onClick={()=>{setQuery(display(record));setOpened(false);fire("select",{record,value:record.Id??record.id??null})}}>
     {display(record)}
   </button>)}
  </div>}
  {opened&&query.trim()&&!p.builderPreview&&!p.previewOnly&&
   (busy||searchError||!matches.length)&&
   <div role={searchError?"alert":"status"} className="smart-lookup-feedback"
    style={{color:searchError?"#dc2626":undefined}}>{
      searchError?searchError:busy?"Searching…":"No matches found"
    }</div>}
 </div>;
}
function SmartTabs({p,record,fire}){
 // Zero-based default; invalid/fractional values revert to the legacy first tab.
 const configuredTabIndex=Number.isInteger(Number(p.tabIndex))&&Number(p.tabIndex)>=0
  &&p.tabIndex!==""&&p.tabIndex!==null?Number(p.tabIndex)
  // Default tab -1: no tab is selected when the page opens.
  :Number(p.tabIndex)===-1&&p.tabIndex!==""&&p.tabIndex!==null?-1:0;
 const [active,setActive]=React.useState(configuredTabIndex);
 React.useEffect(()=>setActive(configuredTabIndex),[configuredTabIndex]);
 const vertical=p.tabOrientation==="vertical";
 const count=number(p.tabCount,Array.isArray(p.tabs)?Math.max(1,p.tabs.length):3,1,20);
 // When bound to an Object, the shared Page Runtime supplies only filtered,
 // permission-checked records. Never generate unlimited tabs from raw records.
 const dynamic=Boolean(p.objectApiName&&p.textSource);
 const hasCollection=p.dataCollection&&typeof p.dataCollection.name==='string'
  &&Array.isArray(p.dataCollection.items);
 const collectionTabs=hasCollection?recordsOf(p).slice(0,count).map((row,index)=>({
  label:p.textSource?scopedExpression(p,"textSource",p.textSource,row):String(row.__collectionLabel??row.Name??''),value:row.__collectionValue,
  id:'collection-'+index,record:row
 })):null;
 const recordTabs=collectionTabs??(dynamic?(isBuilderEmpty(p)?Array.from({length:Math.min(count,5)},(_,i)=>({
   label:"Tab "+(i+1),id:"editor-tab-"+i
  })):recordsOf(p).slice(0,count).map(row=>({
   label:scopedExpression(p,"textSource",p.textSource,row),id:row?.Id??row?.id
  }))):Array.from({length:count},(_,i)=>Array.isArray(p.tabs)&&p.tabs[i]!==undefined
   ?p.tabs[i]:i===0&&typeof p.label==="string"&&p.label&&!p.label.startsWith("@")
     ?p.label:"Tab "+(i+1)));
 // Static captions are formulas on stable tab identities, never independent records.
 // Collection and Object captions still share the one textSource mapping.
 const tabs=dynamic||hasCollection?recordTabs:recordTabs.map((item,index)=>{
  const row=item&&typeof item==='object'?item:null;
  const source=row?row.label??'':item;
  return {...(row||{}),id:typeof row?.id==='string'&&row.id?row.id:'static-tab-'+index,
   label:scopedExpression(p,'tabCaptionFormula',String(source??''),recordOf(p))};
 });
 // The page-scoped selection is authoritative for data-backed Tabs. Clearing a
 // parent selection must not leave a dependent child visibly selected.
 const changeAction=p.actionFlows?.change;
 const formulaStateKey=changeAction?.actionType==="Formula"&&typeof changeAction.formula==="string"
  ?(/^@ThisPage\.[A-Za-z_][A-Za-z0-9_]{0,79}\.([A-Za-z][A-Za-z0-9_]{0,63})\s*:=/i.exec(changeAction.formula.trim())
   // =STATE(category, @record.Id): the tab shows the selection held in that Page State,
   // so another control (e.g. an "All" button doing =STATE(category, "*")) can change it.
   ??/^=?\s*STATE\s*\(\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*,/i.exec(changeAction.formula.trim()))?.[1]:null;
 const stateKey=dynamic?(changeAction?.actionType==="PageState"?changeAction.stateKey:formulaStateKey):null;
 const selectedCollection=hasCollection&&p.pageState?.collectionSelections
  ?Object.entries(p.pageState.collectionSelections).find(([name])=>
    name.toLowerCase()===p.dataCollection.name.toLowerCase())?.[1]:null;
 const selectedId=hasCollection?selectedCollection?.Id
  :stateKey&&p.pageState?p.pageState[stateKey]:undefined;
 const indexForSelection=selectedId===null||selectedId===undefined||selectedId===""?-1:
  tabs.findIndex((tab,index)=>{
   const id=hasCollection?tab?.record?.Id??tab?.record?.id??tab?.value:tab?.id;
   return String(id??"")===String(selectedId);
  });
 // Default index is bounded by the filtered, permission-checked tab list.
 // An existing explicit PageState/Collection selection always has priority.
 // Default value (formula): the tab whose caption it names, e.g. the role an employee has now.
 // While it is still loading (blank) no tab is selected, so a saved value is never
 // overwritten by the first tab.
 const hasDefaultCaption=typeof p.defaultValue==="string"&&p.defaultValue.trim()!==""&&!p.builderPreview;
 const defaultCaption=hasDefaultCaption
  ?text(scopedExpression(p,"defaultValue",p.defaultValue,recordOf(p))).trim().toLowerCase():"";
 const captionIndex=defaultCaption?tabs.findIndex(tab=>text(tab?.label??tab).trim().toLowerCase()===defaultCaption):-1;
 const defaultTabIndex=hasDefaultCaption?captionIndex
  :tabs.length&&configuredTabIndex>=0?Math.min(configuredTabIndex,tabs.length-1):-1;
 // A held value that is no tab (e.g. "*" for All) means no tab is selected.
 const heldOtherValue=!hasCollection&&Boolean(stateKey)&&selectedId!==null&&selectedId!==undefined
  &&selectedId!==""&&indexForSelection<0;
 const selectedTabIndex=(hasCollection||stateKey)
  ?indexForSelection>=0?indexForSelection:heldOtherValue?-1:defaultTabIndex
  :tabs.length?Math.max(0,Math.min(active,tabs.length-1)):-1;
 const autoSelected=React.useRef(null);
 const userPickedTab=React.useRef(false);
 const selectedTabRef=React.useRef(null);
 const selectTab=(index,initialisingDefault=false)=>{
  setActive(index);
  if(hasCollection){
   const item=recordTabs[index];
   const itemId=item?.record?.Id??item?.record?.id??item?.value;
   fire("change",{index,value:itemId??"",record:{
    ...item?.record,Id:itemId??"",Name:item?.label??item?.record?.Name??"",
    ...(item?.record?.__collectionCriteriaField?{
     Field:item.record.__collectionCriteriaField,
     Criteria:item.record.__collectionCriteria}: {})},
    collectionName:p.dataCollection.key??p.dataCollection.name});
  }else if(dynamic){
   const row=recordsOf(p)[index];
   fire("change",{index,value:String(row?.Id??row?.id??""),record:row});
  }else{
   const chosen=recordTabs[index];
   const identifier=chosen&&typeof chosen==="object"
    ?chosen.id??chosen.value??chosen.label:chosen;
   fire("change",{index,value:String(identifier??""),record:{
    Id:String(identifier??""),Name:text(chosen?.label??chosen??"")}});
  }
  // Programmatic default initialisation must not clear its own once-only guard.
  if(!initialisingDefault){autoSelected.current=null;userPickedTab.current=true;}
 };
 const defaultItem=tabs[defaultTabIndex];
 const defaultItemId=defaultItem
  ?hasCollection?defaultItem?.record?.Id??defaultItem?.record?.id??defaultItem?.value
   :defaultItem?.id??defaultItem?.value
  :null;
 // Publish the selected default into the already-authorised state pathway;
 // never execute arbitrary Flows or side-effecting Actions during page load.
 React.useEffect(()=>{
  if(!tabs.length||p.loading||p.previewOnly||p.builderPreview||
    !(hasCollection||stateKey)||typeof p.onAction!=="function")return;
  // Automatic default selection is not permission to execute an authored Flow
  // or arbitrary action during page load. State bindings are safe to initialise.
  if(changeAction&&changeAction.actionType!=="PageState"&&
    !(changeAction.actionType==="Formula"&&formulaStateKey))return;
  // A tab the user picked stays. A tab picked automatically follows the default
  // when it changes (e.g. the record's value arrives after the page opened).
  if(indexForSelection>=0&&(userPickedTab.current||!hasDefaultCaption||indexForSelection===defaultTabIndex)){
   autoSelected.current=null;return;}
  if(heldOtherValue||defaultTabIndex<0)return;
  const key=String(p.pageSessionKey??"")+"|"+String(p.componentId??"")+"|"+
   String(hasCollection?p.dataCollection.name:stateKey)+"|"+String(defaultTabIndex)+"|"+String(defaultItemId??"");
  if(autoSelected.current===key)return;
  autoSelected.current=key;
  selectTab(defaultTabIndex,true);
 },[indexForSelection,defaultItemId,defaultTabIndex,tabs.length,p.loading,p.previewOnly,p.builderPreview,
   p.pageSessionKey,p.componentId,p.onAction,hasCollection,stateKey,p.dataCollection?.name,heldOtherValue,hasDefaultCaption]);
 // Focus the actual selected initial tab only if no other control owns focus.
 React.useEffect(()=>{
  if(selectedTabIndex<0||!tabs.length||p.loading||
   p.previewOnly||p.builderPreview||typeof document==="undefined"||
   document.activeElement!==document.body)return;
  selectedTabRef.current?.focus({preventScroll:true});
 },[selectedTabIndex,tabs.length,p.loading,p.previewOnly,p.builderPreview]);
 React.useEffect(()=>{
  if(tabs.length&&active>=tabs.length)setActive(defaultTabIndex);
 },[active,tabs.length,defaultTabIndex]);
 // Horizontal tabs that do not fit: no scrollbar; a faded arrow at each side that
 // has more tabs (tap to scroll, swiping still works).
 const tabsScroller=React.useRef(null);
 const [tabEdges,setTabEdges]=React.useState({left:false,right:false});
 React.useEffect(()=>{
  const el=tabsScroller.current;
  if(!el||vertical)return;
  const update=()=>{
   const left=el.scrollLeft>2,right=el.scrollLeft+el.clientWidth<el.scrollWidth-2;
   setTabEdges(prev=>prev.left===left&&prev.right===right?prev:{left,right});
  };
  update();
  el.addEventListener("scroll",update,{passive:true});
  const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(update):null;
  observer?.observe(el);
  return ()=>{el.removeEventListener("scroll",update);observer?.disconnect();};
 },[vertical,tabs.length]);
 const scrollTabs=direction=>{
  const el=tabsScroller.current;
  if(el)el.scrollBy({left:direction*Math.max(120,el.clientWidth*0.7),behavior:"smooth"});
 };
 const fade=p.backgroundColor&&p.backgroundColor!=="transparent"?p.backgroundColor:"#F2F2F7";
 const arrow=side=><button type="button" className={"smart-tabs-arrow is-"+side} aria-label={side==="left"?"More tabs left":"More tabs right"}
  tabIndex={-1} onClick={()=>scrollTabs(side==="left"?-1:1)}
  style={{background:"linear-gradient(to "+(side==="left"?"right":"left")+", "+fade+" 55%, transparent)"}}>
  <span aria-hidden="true">{side==="left"?"‹":"›"}</span></button>;
 return <>{!vertical&&!p.builderPreview&&tabEdges.left&&arrow("left")}
 {!vertical&&!p.builderPreview&&tabEdges.right&&arrow("right")}
 <div ref={tabsScroller} data-md-bind={p.builderPreview&&p.collectionFormula&&(dynamic||hasCollection)?"collectionFormula":undefined} className="smart-tabs-shell" style={{background:p.backgroundColor||undefined,
   display:"flex",flexDirection:"column",height:"100%",minHeight:0,width:"100%"}}>
  <nav className={"smart-tabs"+(p.backgroundColor?"":" is-segmented")} role="tablist" aria-label="Tabs"
   aria-orientation={vertical?"vertical":"horizontal"} style={{
    width:"100%",height:"100%",flex:"1 1 auto",minHeight:0,
    flexDirection:vertical?"column":"row",flexWrap:vertical?"nowrap":"wrap",
    alignItems:vertical?"stretch":undefined,alignContent:vertical?"flex-start":"stretch",
    overflowY:vertical?"auto":undefined,overflowX:vertical?"hidden":undefined}}>
   {tabs.map((tab,index)=><button data-md-bind={p.builderPreview?(dynamic||hasCollection?"textSource":"tabCaptionFormula"):undefined} data-md-bind-titles={p.builderPreview?"Tab caption":undefined} data-md-bind-index={p.builderPreview&&!(dynamic||hasCollection)?index:undefined} data-md-bind-item={p.builderPreview&&typeof tab?.id==="string"?tab.id:undefined} key={tab?.id??index} ref={index===selectedTabIndex?selectedTabRef:null} type="button" role="tab"
    aria-selected={selectedTabIndex===index} style={{height:number(p.tabHeight,44),
     maxHeight:vertical?undefined:"100%",minHeight:vertical?number(p.tabHeight,44):0,
     flex:vertical?"0 0 auto":"1 1 auto",
     width:vertical?"100%":p.wrapText===true?number(p.tabWidth,120):undefined,
     minWidth:vertical?0:number(p.tabWidth,120),
     // Wrap Text: the tab keeps its set width and a long caption wraps inside it.
     maxWidth:!vertical&&p.wrapText===true?number(p.tabWidth,120):undefined,
     borderLeft:vertical?"4px solid "+(selectedTabIndex===index?(p.selectedTabColor||SMART_BLUE):"transparent"):undefined,
     borderRadius:number(p.radius,10),fontSize:number(p.textSize,16),fontWeight:p.headerBold===true?700:p.headerBold===false?400:undefined,textAlign:p.labelAlignment||"center",boxShadow:p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":p.shadow==="small"?"0 1px 4px #0002":"none",color:selectedTabIndex===index?selectedTabText(p.selectedTabColor||SMART_BLUE,p.selectedTextColor):readableText(p.tabColor||"#fff",p.labelColor),
     background:selectedTabIndex===index?p.selectedTabColor||SMART_BLUE:p.tabColor||"#fff",
    borderColor:p.borderColor||undefined}}
    tabIndex={selectedTabIndex===index||selectedTabIndex<0&&index===0?0:-1}
    onClick={()=>selectTab(index)}>{text(tab?.label??tab)}</button>)}
   {(dynamic||hasCollection)&&tabs.length===0&&<span className="smart-tabs-empty">No matching records</span>}
  </nav>
 </div></>;
}
function SmartToggle({p,fire}){
 const asBoolean=v=>v===true||v==="true"||v==="True";
 const [checked,setChecked]=React.useState(()=>asBoolean(p.value??p.defaultCheck??p.defaultValue??false));
 const [saving,setSaving]=React.useState(false);
 React.useEffect(()=>setChecked(asBoolean(p.value??p.defaultCheck??p.defaultValue??false)),[p.value,p.defaultCheck,p.defaultValue]);
 const bound=p.toggleFieldBound===true;
 const disabled=bound&&(p.toggleFieldReady!==true||saving);
 const change=e=>{
  const next=e.target.checked;
  if(!bound){setChecked(next);fire("change",next);if(p.actionFlows?.click)fire("click",next);return;}
  if(disabled||typeof p.onBoundToggleChange!=="function")return;
  setChecked(next);setSaving(true);
  void Promise.resolve().then(()=>p.onBoundToggleChange(next))
   .then(()=>{fire("change",next);if(p.actionFlows?.click)fire("click",next);})
   .catch(()=>setChecked(asBoolean(p.value??false)))
   .finally(()=>setSaving(false));
 };
 return <label data-md-bind={p.builderPreview?"textSource":undefined} data-md-bind-titles={p.builderPreview?"Boolean field":undefined} className="smart-switch" title={p.toggleFieldError||undefined}>
  <input type="checkbox" role="switch" aria-label={p.toggleFieldError||"Toggle"}
   aria-busy={saving} checked={checked} disabled={disabled} onChange={change}/>
  <span className="smart-switch-track" style={{background:checked?(p.backgroundColor||"#34c759"):"#e5e5ea",
   border:p.borderColor?"1px solid "+p.borderColor:undefined,
   ...smartShapeAppearance(p.shapeId,p.shapeId==='shape:rectangle'?0:number(p.radius,999)),
   boxShadow:p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":p.shadow==="small"?"0 1px 4px #0002":"none"}}>
   <span className="smart-switch-thumb"/></span></label>;
}
// An editable Smart Input stays focused while its authorised formula/default
// value changes asynchronously. Do not key/remount the native input on changes.
function SmartReactiveInput({value,onValueChange,rows=1,type="text",uploadImage=null,keypad="",...props}){
 const [draft,setDraft]=React.useState(value);
 const draftRef=React.useRef(value);
 const ownEditAt=React.useRef(0);
 draftRef.current=draft;
 // Keypad (number / decimal / date): tapping the box opens on-screen keys, no OS keyboard.
 const usesKeypad=["number","decimal","date"].includes(keypad)&&rows<=1&&!props.readOnly&&!props.disabled;
 React.useEffect(()=>usesKeypad?()=>closeKeypad():undefined,[usesKeypad]);
 const keypadProps=usesKeypad?{inputMode:"none",
  onFocus:event=>openKeypad(event.currentTarget,keypad,()=>draftRef.current,next=>{
   draftRef.current=next;ownEditAt.current=Date.now();setDraft(next);onValueChange(next);}),
  onClick:event=>openKeypad(event.currentTarget,keypad,()=>draftRef.current,next=>{
   draftRef.current=next;ownEditAt.current=Date.now();setDraft(next);onValueChange(next);})}:{};
 const [upload,setUpload]=React.useState({busy:false,error:""});
 const fileRef=React.useRef(null);
 // The user's own edit can change the value handed back (e.g. a value an action gave
 // is dropped once the user types over it): that must not wipe what was just typed.
 // Only a change arriving right after the user's own key counts as theirs; a later
 // value from an action (a quick-amount button, a clear) still shows.
 React.useEffect(()=>{
  if(Date.now()-ownEditAt.current<400){ownEditAt.current=0;return;}
  setDraft(value);
 },[value]);
 const change=event=>{
  const next=event.target.value;
  ownEditAt.current=Date.now();
  setDraft(next);
  onValueChange(next);
 };
 const field=rows>1
  ?<textarea {...props} rows={rows} value={draft} onChange={change}/>
  :<input {...props} {...keypadProps} type={type} value={draft} onChange={change}/>;
 if(typeof uploadImage!=="function")return field;
 // The field keeps holding a URL. Uploading stores the file as a tenant media
 // asset and puts its asset: URL in the field, so typing a URL still works.
 const pick=async event=>{
  const file=event.target.files?.[0];
  event.target.value="";
  if(!file)return;
  setUpload({busy:true,error:""});
  try{
   const ref=await uploadImage(file);
   setDraft(ref);onValueChange(ref);setUpload({busy:false,error:""});
  }catch(error){setUpload({busy:false,error:error instanceof Error?error.message:"Upload failed"});}
 };
 // An uploaded photo is stored as asset:<id>; people see "Photo added", never the code.
 const uploaded=typeof draft==="string"&&/^asset:/i.test(draft.trim());
 const shown=uploaded
  ?<div className={field.props.className} role="status" aria-label={(props["aria-label"]||"Photo")+": photo added"}
    style={{...field.props.style,paddingRight:96,display:"flex",alignItems:"center",color:"#1D1D1F"}}>Photo added</div>
  :React.cloneElement(field,{style:{...field.props.style,paddingRight:52}});
 return <div className="smart-input-upload" style={{position:"relative",width:"100%",height:"100%"}}>
  {shown}
  {uploaded&&!props.readOnly?<button type="button" aria-label="Remove photo" title="Remove photo"
   onClick={()=>{ownEditAt.current=Date.now();setDraft("");onValueChange("");}}
   style={{position:"absolute",right:50,top:"50%",transform:"translateY(-50%)",width:40,height:40,maxHeight:"calc(100% - 8px)",
    border:0,borderRadius:10,cursor:"pointer",background:"#FFEBEA",color:"#FF3B30",fontSize:16,lineHeight:1}}>✕</button>:null}
  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pick}/>
  <button type="button" aria-label={uploaded?"Change photo":"Upload image"} title={upload.error||(uploaded?"Change photo":"Upload image")} disabled={upload.busy}
   onClick={()=>fileRef.current?.click()}
   style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",width:40,height:40,maxHeight:"calc(100% - 8px)",
    border:0,borderRadius:10,cursor:"pointer",background:upload.error?"#FFEBEA":"#E5F0FF",
    color:upload.error?"#FF3B30":"#007AFF",fontSize:18,lineHeight:1,opacity:upload.busy?.6:1}}>
   {upload.busy?"…":uploaded?"↻":"⇪"}
  </button>
 </div>;
}
// Field rules (Property "Field" + "Required"): the Object Manager's Required always applies,
// the box's own Required can only add to it; field access hides or locks the box.
function useFieldRule(p,name){
 const bound=name==="smart_text"&&!p.builderPreview&&typeof p.boundField==="string"?p.boundField:"";
 const [objectApi="",fieldApi=""]=bound.split(".");
 const [access,setAccess]=React.useState(null);
 const [missing,setMissing]=React.useState(false);
 const valueRef=React.useRef("");
 const seenRef=React.useRef(undefined);
 const boxRef=React.useRef(null);
 React.useEffect(()=>{
  setAccess(null);
  if(!objectApi||!fieldApi||typeof p.fieldAccess!=="function")return;
  let live=true;
  p.fieldAccess(objectApi).then(fields=>{if(live)setAccess(fields?.[fieldApi]??null);}).catch(()=>{});
  return ()=>{live=false;};
 },[objectApi,fieldApi,p.fieldAccess]);
 const hidden=Boolean(access)&&!access.read;
 const locked=Boolean(access)&&!hidden&&!(p.editingRecord?access.edit:access.create);
 const required=name==="smart_text"&&!p.builderPreview&&!hidden&&!locked&&(p.mandatory===true||Boolean(access?.required));
 const label=String(access?.label||p.label||p.placeholder||fieldApi||"this box");
 const labelRef=React.useRef(label);labelRef.current=label;
 React.useEffect(()=>{
  if(!required||typeof p.registerRequired!=="function")return;
  return p.registerRequired({label:labelRef.current,value:()=>valueRef.current,
   visible:()=>Boolean(boxRef.current&&boxRef.current.getClientRects().length),flag:setMissing});
 },[required,p.registerRequired]);
 // The value an action or formula puts in the box counts until the user types over it.
 const seen=value=>{if(seenRef.current!==value){seenRef.current=value;valueRef.current=value;}};
 const typed=value=>{valueRef.current=value;if(missing&&String(value??"").trim())setMissing(false);};
 const wrap=field=>{
  if(!required&&!locked&&!bound)return field;
  return <div ref={boxRef} className={"smart-field-rule"+(missing?" is-missing":"")+(locked?" is-locked":"")}
   style={{position:"relative",width:"100%",height:"100%"}}>
   {field}
   {required?<span className="smart-required-mark" aria-hidden="true">*</span>:null}
   {locked?<span className="smart-locked-mark" aria-hidden="true">🔒</span>:null}
  </div>;
 };
 return {hidden,locked,required,missing,label,boxRef,seen,typed,wrap};
}
export default function SmartRuntime(p){
 // Page code: the page converter turned this component's formulas into plain functions.
 // There is no other formula engine on a published page: rows still loading show blank.
 const code=p.__formulaCode&&p.__formulaCode.functions instanceof Map?p.__formulaCode.functions:null;
 const converter=formulaConverter(p);
 const compile=converter?converter.compile:null;
 const lookup=code||compile?(v,record)=>{
  let run;
  try{run=(code?convertedFormula(code,v):null)??(compile?compile(v):null);}
  catch(error){return {value:"",error:error instanceof Error?error.message:"Formula failed"};}
  if(!run)return undefined;
  try{return {value:run(record||{})};}
  catch(error){
   if(error&&error.notHeld===true)return {value:""};
   return {value:"",error:error instanceof Error?error.message:"Formula failed"};
  }
 }:undefined;
 if(lookup&&converter)lookup.rowTotals=(v,rows,record)=>{
  try{
   const run=withRowTotals(v,rows,node=>converter.compileNode(node));
   return run?{value:run(record||{})}:undefined;
  }catch(error){return {value:"",error:error instanceof Error?error.message:"Formula failed"};}
 };
 p={...p,__codeLookup:lookup};
 // Re-render when the tenant brand arrives so @ThisTenant.Company.Name / .Logo show without a reload.
 React.useSyncExternalStore(subscribeTenantBrand,getTenantBrand,getTenantBrand);
 const name=p.kind||"smart_text",record=recordOf(p),label=scopedExpression(p,"label",p.label||"",record);
 // Show when / Disable when (Data): formulas such as  @ThisPage.Total.Value = 0.
 // A formula that cannot run hides (Show when) or disables (Disable when): fail closed.
 const live=!p.builderPreview&&!p.designMode;
 const blankFormula=v=>v===undefined||v===null||(typeof v==="string"&&!v.trim());
 const formulaTrue=v=>!(v===false||v===0||v===null||v===undefined||String(v).trim()===""
  ||String(v).toUpperCase()==="FALSE"||String(v)==="0"||v==="FORMULAERROR");
 const showWhen=p.visibleFormula;
 const hiddenNow=live&&!blankFormula(showWhen)
  &&!formulaTrue(typeof showWhen==="string"?scopedExpression(p,"visibleFormula",showWhen,record):showWhen);
 const disableWhen=p.disabledFormula;
 const disabledByFormula=live&&!blankFormula(disableWhen)&&(()=>{
  const result=typeof disableWhen==="string"?scopedExpression(p,"disabledFormula",disableWhen,record):disableWhen;
  return result==="FORMULAERROR"||formulaTrue(result);
 })();
 const isDisabled=live&&(p.disabled===true||disabledByFormula);
 // Formulas elsewhere can read @ThisPage.<Name>.Disabled / .Visible / .Caption: the page is told
 // only when one of them changes, and only formulas naming this component redraw.
 const reportFormulaState=p.onFormulaState;
 const captionNow=typeof label==="string"||typeof label==="number"?String(label):"";
 React.useEffect(()=>{
  if(live&&typeof reportFormulaState==="function")
   reportFormulaState({Disabled:isDisabled,Visible:!hiddenNow,Caption:captionNow});
 },[live,reportFormulaState,isDisabled,hiddenNow,captionNow]);
 // Style = iOS is saved on newly inserted components. Older saved components have
 // no Style value and stay Classic. Configured properties always win over either.
 // iOS is the only Smart style (the Classic/iOS switch was removed).
 const ios=true;
 const style={fontSize:number(p.textSize,16),color:p.labelColor||undefined,textAlign:p.labelAlignment||"left",borderRadius:number(p.radius,12)};
 const buttonIcon=name==="smart_button"?icons.find(icon=>icon.id===p.shapeId):null;
 // Preserve selections when a data-driven category filter temporarily hides records.
 const [gridSelectedIds,setGridSelectedIds]=React.useState([]);
 // Measure the actual inner viewport, not the configured canvas height. Percentage
 // grid tracks can resolve to their min-content size inside an overflow scroller,
 // exposing part of a second row even when the author selects one visible row.
 const gridViewportRef=React.useRef(null);
 const [gridViewportHeight,setGridViewportHeight]=React.useState(0);
 React.useEffect(()=>{
  if(!isGridKind(name))return;
  const grid=gridViewportRef.current;
  if(!grid)return;
  const measureGridViewport=()=>{
   // Reserve the Card Grid's 4px inset on both edges so authored card
   // borders, rounded corners and shadows are not clipped by the scroller.
   const height=Math.max(0,grid.clientHeight-8);
   setGridViewportHeight(previous=>previous===height?previous:height);
  };
  measureGridViewport();
  if(typeof ResizeObserver!=="undefined"){
   const observer=new ResizeObserver(measureGridViewport);
   observer.observe(grid);
   return ()=>observer.disconnect();
  }
  // Older browsers still update when their window changes size.
  window.addEventListener("resize",measureGridViewport);
  return ()=>window.removeEventListener("resize",measureGridViewport);
 },[name]);
 const shadowStyle={boxShadow:p.calendarShadowColor?"0 4px 10px "+p.calendarShadowColor:p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":p.shadow==="small"?"0 1px 4px #0002":"none",borderRadius:number(p.radius,12)};
 const fieldRule=useFieldRule(p,name);
 const fire=(event,value)=>{if(p.previewOnly||p.builderPreview)return;
  if(isDisabled&&name==="smart_button")return;
  if(typeof p.onAction==="function")void Promise.resolve(p.onAction({event,value})).catch(()=>{});
 };
 let content;
 // Icon side follows an explicit text alignment: left text puts the icon at the
 // far right (e.g. "Start Order  →"), right text puts it at the far left, and
 // centred or unset text keeps the icon just before the caption.
 const iconSide=buttonIcon&&label?(p.labelAlignment==="left"?"end":p.labelAlignment==="right"?"start":"inline"):"inline";
 if(name==="smart_button")content=<button data-md-bind={p.builderPreview?"label":undefined} data-md-bind-titles={p.builderPreview?"Button text":undefined} type="button" className={"smart-button"+(p.wrapText===true?" is-wrapped":"")+(isDisabled?" is-disabled":"")}
   disabled={isDisabled} aria-disabled={isDisabled||undefined}
   title={label&&label.length>18?label:!label&&buttonIcon?.label?buttonIcon.label:undefined} aria-label={label||buttonIcon?.label||"Button"}
   onClick={()=>fire("click",record)} data-icon-side={iconSide==="inline"?undefined:iconSide}
   style={{...style,...shadowStyle,...smartShapeAppearance(p.shapeId,number(p.radius,12)),
    padding:buttonIcon&&!label?"4px":undefined,
    justifyContent:label?(p.labelAlignment==="right"?"flex-end":p.labelAlignment==="center"?"center":"flex-start"):"center",
    ...(p.wrapText===true?{textAlign:p.labelAlignment==="right"?"right":p.labelAlignment==="center"?"center":"left"}:{}),
    fontWeight:typeof p.headerBold==="boolean"?(p.headerBold?700:400):undefined,
    background:p.backgroundColor||SMART_BLUE,color:readableText(p.backgroundColor||SMART_BLUE,p.labelColor)||"#fff",borderColor:p.borderColor,
    ...(isDisabled?{opacity:.4,filter:"grayscale(.7)",cursor:"not-allowed"}:{})}}>
   {buttonIcon&&<span className="smart-button-glyph" aria-hidden="true" style={{
     backgroundColor:p.iconFillColor||p.labelColor||"#fff",
     WebkitMaskImage:'url(/smart-icons/'+buttonIcon.id+'.svg)',
     maskImage:'url(/smart-icons/'+buttonIcon.id+'.svg)',
     ...(iconSide==="end"?{order:2,marginLeft:"auto"}:iconSide==="start"?{marginRight:"auto"}:{})
   }}/>}
   {label&&<span className="smart-button-label">{label}</span>}
 </button>;
 else if(name==="smart_numpad")content=<SmartNumpad
   p={{...p,
     numpadPlaceholder:scopedExpression(p,"numpadPlaceholder",p.numpadPlaceholder??"Enter number",record),
     numpadPrefix:scopedExpression(p,"numpadPrefix",p.numpadPrefix??"",record),
     numpadSuffix:scopedExpression(p,"numpadSuffix",p.numpadSuffix??"",record)}}
   fire={fire}
   // A value an action gave it (@ThisPage.amt.Value = "") wins over its own source.
   sourceValue={p.givenValue?p.value
    :scopedExpression(p,"textSource",p.textSource??p.defaultValue??"",record)}
   given={p.givenValue}
   buttonLabels={[1,2,3].map(index=>scopedExpression(p,
     "customButton"+index+"Label",p["customButton"+index+"Label"]??
       (index===3?"Submit":"Custom "+index),record))}/>;
 else if(name==="smart_toggle")content=<SmartToggle p={p} fire={fire}/>;
 else if(name==="smart_textbox"){
  // A single native surface composed of two independently styled halves.
  // Reuse the shared formula and field-visibility engines, not a second binder.
  const caption=scopedExpression(p,"label",p.properties?.label??p.label??"",record)||"";
  const valueResult=scopedDisplayExpression(p,"textSource",p.textSource??"",record);
  const value=valueResult.value;
  const editable=p.readonly===false&&!p.recordId&&!p.previewOnly&&!p.builderPreview;
  const align=choice=>["left","center","right"].includes(choice)?choice:"left";
  const alignItems=(choice)=>choice==="right"?"flex-end":choice==="center"?"center":"flex-start";
  content=<div className="smart-textbox-pair" role="group" aria-label={caption||"Smart Textbox"}
   style={{borderColor:p.borderColor||"#d2dbe5",borderWidth:number(p.borderWidth,1,0,24),
    borderRadius:number(p.radius,6,0,128),
    boxShadow:p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":p.shadow==="small"?"0 1px 4px #0002":"none",
    fontSize:number(p.textSize,14,8,96)}}>
   <span data-md-bind={p.builderPreview?"label":undefined} data-md-bind-titles={p.builderPreview?"Textbox caption":undefined} className="smart-textbox-caption" style={{backgroundColor:p.backgroundColor||"#f1f5f9",
     color:p.labelColor||"#334155",textAlign:align(p.labelAlignment),
     justifyContent:alignItems(p.labelAlignment)}}>
    {caption|| (p.builderPreview?"Caption":"")}
   </span>
   <div data-design-area={p.builderPreview?"Header":undefined} className="smart-textbox-value-panel" style={{
    ...smartPartOffsetStyle(p,"header"),backgroundColor:p.headerBodyColor||"#fff",color:p.headerTextColor||"#1e293b",
    border:p.headerBorderColor?'1px solid '+p.headerBorderColor:undefined,
    height:p.headerBoxHeight!==undefined&&p.headerBoxHeight!==null&&p.headerBoxHeight!==''?number(p.headerBoxHeight,0,0,1200):undefined,
    minHeight:p.headerBoxHeight!==undefined&&p.headerBoxHeight!==null&&p.headerBoxHeight!==''?number(p.headerBoxHeight,0,0,1200):undefined,
    width:p.headerBoxWidth!==undefined&&p.headerBoxWidth!==null&&p.headerBoxWidth!==''?number(p.headerBoxWidth,0,0,1200):undefined,
    maxWidth:'100%',
    borderRadius:p.headerRadius!==undefined&&p.headerRadius!==null&&p.headerRadius!==""
     ?number(p.headerRadius,0,0,128):undefined,
    fontSize:p.headerTextSize!==undefined&&p.headerTextSize!==null&&p.headerTextSize!==""
     ?number(p.headerTextSize,14,8,96):undefined,
    justifyContent:alignItems(p.headerAlignment)}}>
    <div key={p.textSource??""} className="smart-textbox-value" data-md-bind={p.builderPreview?"textSource":undefined} data-md-bind-titles={p.builderPreview?"Textbox value":undefined} data-design-area={p.builderPreview?"Header Supporting":undefined} role="textbox"
      aria-label={caption||"Value"} aria-readonly={!editable}
      tabIndex={editable?0:undefined} contentEditable={editable}
      suppressContentEditableWarning={editable}
      title={valueResult.error?"Formula error: "+valueResult.error:undefined}
      style={{color:valueResult.error?formulaDisplayErrorColor:p.supportingTextColor||p.headerTextColor||"#1e293b",
       fontWeight:p.supportingBold===true||p.headerBold===true?700:400,
       borderColor:p.supportingBorderColor||"transparent",
       backgroundColor:p.supportingBackgroundColor||undefined,
       borderRadius:p.supportingRadius!==undefined&&p.supportingRadius!==null&&p.supportingRadius!==""
        ?number(p.supportingRadius,0,0,128):undefined,
       height:p.supportingBoxHeight!==undefined&&p.supportingBoxHeight!==null&&p.supportingBoxHeight!==""
        ?number(p.supportingBoxHeight,24,12,600):undefined,
       width:p.supportingBoxWidth!==undefined&&p.supportingBoxWidth!==null&&p.supportingBoxWidth!==''?number(p.supportingBoxWidth,0,0,1200):undefined,
       boxShadow:p.supportingShadow==='large'?'0 8px 20px #0003':p.supportingShadow==='medium'?'0 3px 9px #0003':p.supportingShadow==='small'?'0 1px 4px #0002':undefined,
       fontSize:p.supportingTextSize!==undefined&&p.supportingTextSize!==null&&p.supportingTextSize!==""
        ?number(p.supportingTextSize,14,8,96):undefined,
       textAlign:align(p.supportingAlignment||p.headerAlignment),
       whiteSpace:(p.supportingWrapText??p.wrapText)===false?"nowrap":"pre-wrap",
       textOverflow:p.wrapText===false?"ellipsis":undefined}}>
      {text(value)|| (p.builderPreview?"Text Here":"")}
    </div>
   </div>
  </div>;
 }
 else if(name==="smart_text"||name==="smart_label"){
  // Rows = 1 preserves the existing input; 2–12 renders a native textarea.
  const inputRows=Math.max(1,Math.min(12,Math.trunc(number(p.inputRows,1,1,12))));
  // Keep each Data expression scoped to the property that actually owns it.
  // A label/value formula must not borrow defaultValue's field-filter rule.
  const hasValue=key=>p[key]!==undefined&&p[key]!==null&&p[key]!=="";
  const valueKey=["textSource","defaultValue","value","label"]
   .find(hasValue)??"label";
  const inputKey=["textSource","defaultValue","value"]
   .find(hasValue)??"defaultValue";
  const contentResult=scopedDisplayExpression(p,valueKey,p[valueKey]??"",record);
   const contentValue=contentResult.value;
  const inputResult=scopedDisplayExpression(p,inputKey,p[inputKey]??"",record);
   const inputContentValue=inputResult.value;
  // A Data formula is a read-only value unless the author attached an actual
  // input change action (or explicitly requested an editable input).
  // Rendering it as an uncontrolled input can leave the initial empty value
  // on screen after an asynchronous formula/record update.
  // displayMode is recognised only for backwards compatibility with saved pages;
  // the renderer never requires it for a formula and it is not a ribbon setting.
  const formulaValue=value=>typeof value==="string"&&(
   /^\s*=/.test(value)||/@[A-Za-z]/.test(value)||
   /^\s*"/.test(value)||
   /^\s*-?(?:\d+(?:\.\d*)?|\.\d+)\s*[+\-*/&]/.test(value)||
   /^\s*[A-Za-z][A-Za-z0-9_]*\s*\(/.test(value));
  const dataBound=typeof p.textSource==="string"&&p.textSource.trim().length>0
   ||["label","defaultValue","value"].some(key=>formulaValue(p[key]));
  const editable=p.readonly===false||Boolean(p.actionFlows?.change);
  const displayText=name==="smart_label"||
   (!editable&&(dataBound||p.displayMode==="display"));
  content=displayText
   ?<div data-md-bind={p.builderPreview?valueKey:undefined} data-md-bind-titles={p.builderPreview?"Display text":undefined} className="smart-display-text" title={contentResult.error?"Formula error: "+contentResult.error:undefined} style={{...style,...shadowStyle,
     color:contentResult.error?formulaDisplayErrorColor:style.color,
     ...(name==="smart_label"?smartShapeAppearance(p.shapeId,number(p.radius,12)):{}),
     width:"100%",height:"100%",minWidth:0,minHeight:0,display:"flex",alignItems:"safe center",
     // Overflow-safe alignment keeps the top of large text visible in short authored frames.
     lineHeight:1.2,
     justifyContent:p.labelAlignment==="right"?"flex-end":p.labelAlignment==="center"?"center":"flex-start",
     padding:"0 12px",overflow:"hidden",overflowWrap:"anywhere",
     whiteSpace:p.wrapText===false?"nowrap":"pre-wrap",
     fontWeight:p.headerBold===true?700:400,
     background:p.backgroundColor||"transparent",
     // A border colour is a visible native border, not just the editor selection outline.
     // Preserve an explicit zero width; give formula failures a visible frame in the editor.
     borderStyle:"solid",borderWidth:p.borderWidth===undefined||p.borderWidth===null||p.borderWidth===""
       ?(p.borderColor||(p.builderPreview&&contentResult.error)?1:0):number(p.borderWidth,0,0,24),
     borderColor:contentResult.error&&p.builderPreview?formulaDisplayErrorColor:p.borderColor||"transparent"}}>{text(contentValue)||(name==="smart_label"&&p.builderPreview?"Label":"")}</div>
   :fieldRule.hidden?null:(fieldRule.seen(inputContentValue),fieldRule.wrap(<SmartReactiveInput value={inputContentValue} readOnly={fieldRule.locked||undefined} aria-required={fieldRule.required||undefined} aria-invalid={fieldRule.missing||undefined}
  title={inputResult.error?"Formula error: "+inputResult.error:fieldRule.locked?"You don't have permission to edit "+fieldRule.label:fieldRule.missing?fieldRule.label+" is required":undefined} data-md-bind={p.builderPreview?inputKey:undefined} data-md-bind-titles={p.builderPreview?"Input value":undefined} className="smart-input-box" type={p.maskInput===true&&inputRows<=1?"password":"text"}
  autoComplete={p.maskInput===true?"off":undefined} spellCheck={p.maskInput===true?false:undefined}
  aria-label={label||text(p.placeholder||"Input")}
  placeholder={p.builderPreview===true&&![p.placeholder,p.textSource,p.defaultValue,p.value].some(v=>v!==undefined&&v!==null&&v!=="")
    &&!(p.properties&&Object.prototype.hasOwnProperty.call(p.properties,"label"))
    ?"Text Here":label||text(p.placeholder||"")}
  style={{...style,...shadowStyle,...smartShapeAppearance(p.shapeId,number(p.radius,12)),width:"100%",height:"100%",minWidth:0,minHeight:0,
    fontSize:number(p.textSize,16),color:inputResult.error?formulaDisplayErrorColor:p.defaultValueColor||p.labelColor||undefined,
    // Explicit solid border on every side instead of the browser's native inset border.
    // A configured zero border width intentionally removes the visible outline.
    borderStyle:"solid",
    borderWidth:p.borderWidth===undefined||p.borderWidth===null||p.borderWidth===""?1:number(p.borderWidth,1,0,24),
    borderColor:p.borderColor||(ios?"transparent":"#b8c7d7"),
    padding:inputRows>1?"8px 12px":"0 12px",lineHeight:inputRows>1?1.35:1.2,
    resize:inputRows>1?"none":undefined,overflowY:inputRows>1?"auto":undefined,
    background:p.backgroundColor||(ios?"#f2f2f7":"#fff"),
    textAlign:p.labelAlignment||"left","--smart-placeholder-color":p.labelColor||"#64748b"}}
  rows={inputRows} uploadImage={p.allowImageUpload===true&&!p.builderPreview?p.uploadImage:null}
  keypad={p.builderPreview?"":p.keypad} onValueChange={value=>{fieldRule.typed(value);fire("change",value);}}/>));
 }
 else if(name==="smart_selector")content=<SmartSelector p={p} fire={fire}/>;
 else if(name==="smart_search")content=<SmartSearch p={p} fire={fire}
   placeholder={text(scopedExpression(p,"label",p.placeholder??p.label??"Search",recordOf(p)))}
   style={{background:p.backgroundColor||(ios?"#e9e9ee":"#fff"),borderColor:p.borderColor||"transparent",
    color:p.labelColor||undefined,fontSize:number(p.textSize,16),
    boxShadow:p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":p.shadow==="small"?"0 1px 4px #0002":"none",
    ...smartShapeAppearance(p.shapeId,number(p.radius,12))}}/>;
 else if(name==="smart_lookup")content=<SmartLookup p={p} fire={fire}
   style={{...style,backgroundColor:p.backgroundColor||undefined,borderColor:p.borderColor||undefined,
    width:"100%",height:"100%",minHeight:0,color:p.labelColor||undefined,fontSize:number(p.textSize,16)}}/>;
 else if(name==="smart_image")content=<SmartCard p={p} record={
   (p.imageSourceMode==="field"||typeof p.imageSource==="string"&&p.imageSource.startsWith("@"))&&Array.isArray(p.records)
   ?(p.records.find(r=>boundImage(p,r))??record):record
 }/>;
 else if(isGridKind(name)){
  const rows=Math.max(1,Math.floor(number(p.cardsPerColumn,3,1,40)));
  const columns=Math.max(1,Math.floor(number(p.cardsPerRow,3,1,12)));
  const gap=number(p.gap,12,0,160);
  // One visible row: the card fills the grid, so a short grid no longer gets a
  // scrollbar from a fixed 96px card floor. Several rows keep the 96px default.
  // A Card Min Height the builder sets is honoured down to 24px either way.
  const minimumCardHeight=number(p.cardMinHeight,rows===1?24:96,24,1200);
  // The requested column count remains exact, but cards never collapse below
  // a usable minimum width. Excess columns scroll horizontally in this grid.
  const minimumCardWidth=number(p.cardMinWidth??p.cardWidth,180,96,1200);
  const authoredCardHeight=p.cardBodyHeight!==undefined&&p.cardBodyHeight!==null&&p.cardBodyHeight!==''
   ?number(p.cardBodyHeight,96,24,1200):null;
  const authoredCardWidth=p.cardBodyWidth!==undefined&&p.cardBodyWidth!==null&&p.cardBodyWidth!==''
   ?number(p.cardBodyWidth,180,96,1200):null;
  const boundRows=recordsOf(p);
  const selection=p.selectedCardColor||p.focusedCardWidth||p.focusedCardHeight||p.focusedCardBorderColor||p.focusedCardShadow||
   p.focusedTextColor||p.focusedTextBold!==undefined||p.focusedTextSize
   ?cardSelection(p):null;
  const selectable=p.selectionMode==="single"||p.selectionMode==="multiple";
  const previewRows=(p.previewOnly===true||p.builderPreview===true||p.preview===true)&&boundRows.length===0
    ?Array.from({length:columns*rows},(_,i)=>({Id:"card-preview-"+i,Name:"Sample item "+(i+1)}))
    :boundRows;
  content=<div ref={gridViewportRef} data-design-area={p.builderPreview?"Grid":undefined} data-md-bind={p.builderPreview&&p.collectionFormula?"collectionFormula":undefined} className="smart-grid" role="region" aria-label={name==="smart_id_card"?"Record cards":"Product cards"} tabIndex={0}
   onKeyDown={event=>{
     // The inner grid is an independent keyboard scroller. Never steal
     // arrow/action keys from a focused card or from the Page Builder.
     if(event.target!==event.currentTarget)return;
     const scroller=event.currentTarget;
     if(event.key==="End"){event.preventDefault();scroller.scrollTop=scroller.scrollHeight;}
     else if(event.key==="Home"){event.preventDefault();scroller.scrollTop=0;}
     else if(event.key==="PageDown"){event.preventDefault();scroller.scrollTop+=scroller.clientHeight;}
     else if(event.key==="PageUp"){event.preventDefault();scroller.scrollTop-=scroller.clientHeight;}
   }}
   style={{
   boxSizing:"border-box",width:"100%",height:"100%",minHeight:0,minWidth:0,
   overflowY:"auto",overflowX:"auto",
   border:p.gridBorderColor?"1px solid "+p.gridBorderColor:undefined,
   borderRadius:p.gridRadius!==undefined?number(p.gridRadius,0,0,600):undefined,
   boxShadow:p.gridShadow==="large"?"0 8px 20px #0003":p.gridShadow==="medium"?"0 3px 9px #0003":p.gridShadow==="small"?"0 1px 4px #0002":undefined,
   // Contain sideways swipes only: a vertical swipe that reaches the end of the
   // grid must keep scrolling the page on phones.
   overscrollBehaviorX:"contain",overscrollBehaviorY:"auto",
   // Keep the full border and shadow inside the scroll viewport in both
   // published pages and the Page Builder (all Cards/Rows settings).
   padding:4,scrollPadding:4,
   gap,
   gridTemplateColumns:authoredCardWidth!==null
    ?"repeat("+columns+","+authoredCardWidth+"px)"
    :"repeat("+columns+",minmax("+minimumCardWidth+"px,1fr))",
   // Keep every authorised record; 'Rows' controls the *visible* viewport only.
   // A measured pixel row height avoids percentage tracks shrinking to their
   // min-content size and painting a second row within a one-row viewport.
   gridAutoRows:"max("+minimumCardHeight+"px, calc((100% - 8px - "+(rows-1)*gap+"px) / "+rows+"))",
   ...(authoredCardHeight!==null?{gridAutoRows:authoredCardHeight+"px"}:{}),
   ...(gridViewportHeight>0&&authoredCardHeight===null?{
    gridAutoRows:Math.max(minimumCardHeight,(gridViewportHeight-(rows-1)*gap)/rows)+"px"
   }:{}),
   alignContent:"start",backgroundColor:p.gridBackgroundColor||undefined
  }}>
   {previewRows.map((r,i)=>{
    // One shared click event handles either the authored card button or the
    // legacy whole-card selection. Never nest an actionable button in a button.
    const actionable=Boolean(p.actionFlows?.click&&!p.previewOnly&&!p.builderPreview);
    const hasButton=typeof p.cardButtonText==="string"&&p.cardButtonText.trim()!=="";
    const hasCustomButton=["customButton1","customButton2"].some(key=>
     p[key+"Visible"]!==false&&Boolean(p.actionFlows?.[key]||
      typeof p[key+"Label"]==="string"&&p[key+"Label"].trim()));
    const recordId=r?.Id??r?.id??null,recordKey=recordId===null?null:String(recordId);
    const isSelected=selectable&&recordKey!==null
     ?gridSelectedIds.includes(recordKey)||(gridSelectedIds.length===0&&p.selectionMode==="single"&&selectedCard(selection,r))
     :selectedCard(selection,r);
    const selectRecord=()=>{
     const payload={record:r,recordId};
     if(selectable&&recordKey!==null){
      const next=p.selectionMode==="multiple"
       ?gridSelectedIds.includes(recordKey)?gridSelectedIds.filter(id=>id!==recordKey):[...gridSelectedIds,recordKey]
       :[recordKey];
      setGridSelectedIds(next);
      fire("change",{...payload,selectedRecordIds:next});
     }
     if(actionable)fire("click",payload);
    };
    const legacyWrapper=actionable&&!hasButton&&!hasCustomButton&&!selectable;
    const card=<SmartCard p={p} record={r} selected={isSelected}
      onSelect={!legacyWrapper&&(selectable||!hasButton&&hasCustomButton&&actionable)?selectRecord:null}
      onButtonClick={actionable?selectRecord:null}
      onCustomButton={key=>fire(key,{record:r,recordId})}/>;
    return legacyWrapper
      ?<button key={r?.Id??r?.id??i} type="button" className="smart-grid-action"
        aria-label={"Select "+text(r?.Name??r?.name??r?.label??"product")}
        onClick={selectRecord}>{card}</button>
      :<React.Fragment key={r?.Id??r?.id??i}>{card}</React.Fragment>;
   })}
   {/* A published grid with no authorised records shows a quiet empty state
       instead of a blank coloured block. */}
   {!previewRows.length&&!p.loading?<div className="smart-grid-empty" role="status"
     style={{gridColumn:"1 / -1",alignSelf:"center",textAlign:"center",padding:"8px 12px",
      opacity:.85,fontSize:14,color:p.supportingTextColor||p.headerTextColor||p.labelColor||undefined}}>
     Nothing to show yet</div>:null}
  </div>;
 }
 else if(name==="smart_cart")content=<SmartCart p={p} records={recordsOf(p)} Picture={SmartPicture} expression={(formula,row)=>{
  const rows=recordsOf(p);
  const pagination=p.recordPagination;
  const complete=!pagination||(pagination.offset===0&&pagination.total<=rows.length);
  return expression(formula,row,p.pageState,p.objectApiName,p.formulaCollectionSources,p.namedCollections,
   complete&&rows.length<=200?rows:undefined,p.sessionId,p.readComponent,p.objects,p.__codeLookup,p.builderPreview===true);
 }} resolveImage={(row)=>boundImage(p,row)}
    fieldAllowed={(key,row)=>fieldAllows(p,key,row)} fire={fire}/>;
 else if(name==="smart_calendar")content=<SmartScheduleCalendar p={p} fire={fire}
   records={recordsOf(p)} resolve={(key,source,row)=>scopedExpression(p,key,source,row)}/>;
 else if(name==="smart_tabs")content=<SmartTabs p={p} record={record} fire={fire}/>;
 else if(name==="smart_keyboard")content=<SmartKeyboard p={p} fire={fire}/>;
 else if(name==="smart_dock")content=<SmartDock p={p} fire={fire}
   resolve={(key,fallback)=>scopedExpression(p,key,p[key]??fallback,record)}/>;
 else if(name==="smart_navigation"){
  const items=Array.isArray(p.items)&&p.items.length?p.items:recordsOf(p);
  const entries=items.length?items:isBuilderEmpty(p)?["Home","Products","Settings"]:p.textSource?[record]:[];
  const labelOf=item=>{
    if(item&&typeof item==="object"){
      if(typeof item.label==="string"&&item.label)return item.label;
      return scopedExpression(p,"textSource",p.textSource??item.Name??item.name??item.title??item.id??"",item);
    }
    return text(item);
  };
  const fit=p.imageFill==="fit"?"contain":p.imageFill==="stretch"?"fill":"cover";
  content=<nav data-md-bind={p.builderPreview&&p.collectionFormula?"collectionFormula":undefined} className="smart-navigation" style={{width:"100%",height:"100%",
   minWidth:0,minHeight:0,overflow:"auto",flexWrap:"nowrap",alignItems:"flex-start",flexDirection:p.navigationDirection==="vertical"?"column":"row"}}>
    {entries.map((item,i)=>{
      const label=labelOf(item);
      const src=item&&typeof item==="object"?item.imageSrc??item.imageUrl:null;
      const imageSrc=typeof src==="string"?src:"";
      return <button data-md-bind={p.builderPreview&&p.textSource&&!(item&&typeof item==="object"&&item.label)?"textSource":undefined} data-md-bind-titles={p.builderPreview?"Navigation item text":undefined} key={item?.id??i} type="button" className="smart-navigation-item"
        style={{flex:"0 0 auto",height:p.wrapText===true?"auto":32,maxHeight:"100%",minHeight:p.wrapText===true?32:0,
          width:p.wrapText===true?number(p.tabWidth,140):undefined,maxWidth:p.wrapText===true?number(p.tabWidth,140):undefined,
          color:p.labelColor||undefined,background:p.backgroundColor||(ios?"rgb(255 255 255 / .82)":"#fff"),
          boxShadow:p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":p.shadow==="small"?"0 1px 4px #0002":"none",
          borderColor:p.borderColor||undefined,borderRadius:number(p.radius,ios?10:4),fontSize:number(p.textSize,16),
          fontWeight:p.headerBold===true?700:p.headerBold===false?400:undefined}}
        onClick={()=>{fire("click",item);if(p.onNavigate&&item?.target)p.onNavigate(item.target)}}>
        {imageSrc&&<span data-design-area={p.builderPreview?"Image":undefined}><SmartPicture
         src={imageSrc} alt={label} loadAsset={p.loadAsset} style={{
         width:number(p.imageWidth,22,8,200),height:number(p.imageHeight,22,8,200),objectFit:fit,
         border:p.imageBorderColor?"1px solid "+p.imageBorderColor:undefined,
         backgroundColor:p.imageBackgroundColor||undefined,
         borderRadius:p.imageRadius!==undefined?number(p.imageRadius,0,0,600):undefined,
         boxShadow:p.imageShadow==="large"?"0 8px 20px #0003":p.imageShadow==="medium"?"0 3px 9px #0003":undefined,
         boxSizing:"border-box"}}/></span>}{label}
      </button>;
    })}
  </nav>;
 }else content=<div className="smart-container" style={{
    background:p.backgroundColor??p.imageBackgroundColor??"transparent",
    border:p.borderColor?"1px solid "+p.borderColor:0,
    borderRadius:number(p.radius,12),...shadowStyle,...smartShapeAppearance(p.shapeId,number(p.radius,12))
 }}>{p.children||(p.builderPreview?<span className="smart-editor-container-placeholder">Drop components here</span>:null)}</div>;
 // Show when (Data): a formula such as COUNTIFS(Cart, ..., PaymentStatus, "Card") > 0.
 // Blank always shows; FALSE, 0 or blank text hides at runtime. The builder always shows it.
 // Page code may already have run it (a total such as COUNTIFS): then it arrives as TRUE/FALSE/0.
 // Marker only: the page frame around a hidden component must not catch taps meant for what is under it.
 if(hiddenNow)return <span data-smart-hidden="true" hidden/>;
 // Geometry-only technical host; the native Smart surface owns all visible styling.
 // An ID card is a Card Grid surface too: it shares the grid sizing/scroll CSS.
 return <div className={"smart-runtime "+name+(name==="smart_id_card"?" smart_card_grid":"")+(ios?" smart-ios":"")+((name==="smart_tabs"||name==="smart_navigation")&&p.wrapText===true?" smart-wrap-text":"")}
  data-builder-preview={p.builderPreview?"true":undefined} style={{
   display:"flex",flexDirection:"column",boxSizing:"border-box",border:0,
   background:"transparent",boxShadow:"none",padding:0,margin:0,
   minWidth:0,minHeight:0,width:p.canvasFrameSized===true?"100%":p.width!==undefined&&p.width!==''?number(parseFloat(p.width),undefined,0,10000):"100%",
   height:p.canvasFrameSized===true?"100%":p.height!==undefined&&p.height!==''?number(parseFloat(p.height),undefined,0,10000):"100%"
 }}>{content}</div>;
}
