/** Cart is presentation-only; expressions and actions use the existing shared runtimes. */
import {groupCartRows} from './cartGrouping.js';
import {smartCustomButtonAppearance} from '../smart/shared/SmartCustomButtonAppearance.js';
const n=(v,f,min=0,max=2000)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):f;
const shadow=v=>v==="large"?"0 8px 20px #0003":v==="medium"?"0 3px 9px #0003":"none";
const border=v=>v?"1px solid "+v:"1px solid transparent";
const align=v=>["left","center","right"].includes(v)?v:"left";
const summaryJustify=v=>v==="left"?"flex-start":v==="center"?"center":v==="right"?"flex-end":undefined;
const names=['Column 1','Column 2','Column 3','Column 4','Column 5'];
const headings=['Product','Unit price','Quantity','Total','Discount'];
const tracks=['minmax(0,2.2fr)','minmax(0,1fr)','minmax(78px,1.35fr)','minmax(0,1fr)','minmax(0,1fr)'];
const numericType=/^(Number|Currency|Percent|Integer|Decimal|Double|Float|Long|Short|Int)$/i;
const directField=source=>/^@([A-Za-z][A-Za-z0-9_]*)$/.exec(typeof source==="string"?source.trim():"")?.[1]??null;
const display=value=>value===null||value===undefined||value===""?"—":String(value);
export default function SmartCart({p,records,Picture,expression,fieldAllowed,fire}){
 const allows=(key,row)=>typeof fieldAllowed!=='function'||fieldAllowed(key,row);
 const fieldExpression=(key,source,row)=>allows(key,row)?expression(source,row):'';
 const demo=p.builderPreview===true&&!records.length;
 const actions=p.actionFlows&&typeof p.actionFlows==="object"&&!Array.isArray(p.actionFlows)?p.actionFlows:{};
 const canClick=Boolean(actions.click)&&!p.previewOnly&&!p.builderPreview;
 // Per-button metadata actions; legacy qtyIcon is a compatibility fallback.
 const showIncrease=p.qtyIncreaseVisible!==false;
 const showDecrease=p.qtyDecreaseVisible!==false;
 const canIncrease=showIncrease&&Boolean(actions.qtyIncrease||actions.qtyIcon)&&!p.previewOnly&&!p.builderPreview;
 const canDecrease=showDecrease&&Boolean(actions.qtyDecrease||actions.qtyIcon)&&!p.previewOnly&&!p.builderPreview;
 // Group the full authorised collection before limiting the visible rows.
 // Preserve the source records: row actions still use their real record IDs.
 const rows=demo?Array.from({length:3},(_,i)=>({id:"preview-"+i,Quantity:1,__preview:true}))
   :groupCartRows(records,{quantityField:directField(p.column3Source)||'Quantity'}).slice(0,200);
 // Select the most recently appended item by default. Preserve a manually
 // selected row until it is removed, and automatically follow newly added rows.
 const rowKeys=rows.map((row,i)=>String(row?.Id??row?.id??i));
 const rowSignature=rowKeys.join("\\u001f");
 const [selectedKey,setSelectedKey]=React.useState(()=>rowKeys.at(-1)??null);
 const previousKeys=React.useRef(rowKeys);
 React.useEffect(()=>{
   const before=previousKeys.current;
   const added=rowKeys.filter(key=>!before.includes(key));
   setSelectedKey(current=>added.length?added.at(-1):
     current&&rowKeys.includes(current)?current:rowKeys.at(-1)??null);
   previousKeys.current=rowKeys;
 },[rowSignature]);
 const expandedActions=[
  {key:"customButton1",label:String(p.customButton1Label||"Custom Button 1"),visible:p.customButton1Visible!==false},
  {key:"customButton2",label:String(p.customButton2Label||"Custom Button 2"),visible:p.customButton2Visible!==false}
 ].filter(action=>action.visible);
 // Financial amounts come from explicit permission-checked Page State/Flow
 // bindings. Do not infer VAT, discounts or a payable total from line prices.
 const money=value=>{
  if(value===null||value===undefined||value==="")return null;
  const amount=Number(value);
  if(!Number.isFinite(amount))return null;
  try{return new Intl.NumberFormat("en-GB",{style:"currency",currency:
   /^[A-Z]{3}$/.test(p.currencyCode||"")?p.currencyCode:"GBP"}).format(amount);}
  catch{return new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(amount);}
 };
 // The same existing ribbon expression evaluator resolves @Field, formulas,
 // literals and Flow-bound Page State values; all fields come from authorised rows.
 const summaryRecord=records[0]??{};
 const summarySource=(source,key)=>{
  if(!allows(key,summaryRecord))return null;
  if(typeof source==='string'&&/^\$state\.[A-Za-z][A-Za-z0-9_]{0,63}$/.test(source)){
   const key=source.slice(7);
   return p.pageState&&Object.prototype.hasOwnProperty.call(p.pageState,key)
    ?p.pageState[key]:null;
  }
  return expression(source,summaryRecord);
 };
 // Summary slots accept free-form text as well as numeric bindings. Only
 // numeric results (and explicitly numeric Object fields) receive the default
 // currency formatter; user-authored text must never be coerced to a number.
 const summaryValue=(source,key)=>{
  const value=summarySource(source,key);
  if(value===null||value===undefined||value==="")return null;
  const fieldName=directField(source);
  const sourceObject=Array.isArray(p.objects)
   ?p.objects.find(item=>item.apiName===p.objectApiName):null;
  const field=fieldName?sourceObject?.fields?.find(item=>item.apiName===fieldName):null;
  if(field){
   if(numericType.test(field.dataType))return money(value);
   return typeof value==="string"||typeof value==="number"||typeof value==="boolean"
    ?String(value):null;
  }
  if(typeof value==="number"||typeof value==="string"&&value.trim()!==""
    &&Number.isFinite(Number(value)))return money(value);
  return typeof value==="string"||typeof value==="boolean"?String(value):null;
 };
 const displayFormula=(key,source,fallback)=>typeof source==='string'&&source.trim()
  ?fieldExpression(key,source,{}):fallback;
 const summaryLabel=(key,fallback)=>displayFormula(key,p[key],fallback);
 const summaryLabels={
  Subtotal:summaryLabel('subtotalLabel','Subtotal'),
  Discount:summaryLabel('discountLabel','Discount'),
  Tax:summaryLabel('taxLabel','Tax'),
  Total:summaryLabel('totalLabel','Total')
 };
 const summaryAmounts={Subtotal:summaryValue(p.subtotalValue,'subtotalValue'),
  Discount:summaryValue(p.discountValue,'discountValue'),
  Tax:summaryValue(p.taxValue,'taxValue'),
  Total:summaryValue(p.totalValue,'totalValue')};
 const rowHeight=n(p.rowHeight,64,24);
 const rowLimit=Math.floor(n(p.cardsPerRow,5,1,50));
 const visible=Array.isArray(p.columnVisibility)
   ?names.flatMap((name,index)=>p.columnVisibility.includes(name)?[index]:[])
   :[0,1,2,3,4];
 const columns=visible.length?visible.map(index=>tracks[index]).join(' '):'1fr';
 const columnHeadings=headings.map((heading,index)=>
  displayFormula('cartColumn'+(index+1)+'Header',p['cartColumn'+(index+1)+'Header'],heading));
 const supportingDefault=demo?'Preview items (3)':
  rows.reduce((sum,row)=>sum+Number(row.Quantity||0),0)+' items';
 const supportingText=displayFormula('cartSupportingSource',p.cartSupportingSource,supportingDefault);
 // The visible row count measures actual cell content, not just the configured min-height.
 const effectiveRowHeight=Math.max(rowHeight,visible.includes(0)?n(p.imageHeight,44,16)+14:0,
   visible.includes(2)?40:0);
 const sources=[null,p.column2Source,p.column3Source,p.column4Source,p.column5Source];
 const object=Array.isArray(p.objects)?p.objects.find(item=>item.apiName===p.objectApiName):null;
 const quantityField=directField(p.column3Source);
 const field=quantityField?object?.fields?.find(item=>item.apiName===quantityField):null;
 const renderQuantity=(record,name,payload)=>{
  const legacy=!p.column3Source;
  const legacyKey=['Quantity','quantity','Qty','qty'].find(key=>record?.[key]!==undefined);
  const fieldName=legacy?legacyKey:quantityField;
  const raw=fieldName?record?.[fieldName]:undefined;
  const computed=legacy?raw:fieldExpression('column3Source',p.column3Source,record);
  // A calculated number is not a writable numeric field: suppress +/- for formulas.
  const numeric=allows('column3Source',record)&&Boolean(fieldName)&&(legacy
   ?(typeof raw==='number'&&Number.isFinite(raw)||
     typeof raw==='string'&&raw.trim()!==''&&Number.isFinite(Number(raw)))
   :field?numericType.test(field.dataType):typeof raw==='number'&&Number.isFinite(raw));
  const quantity=numeric&&computed!==null&&computed!==undefined&&computed!==''&&Number.isFinite(Number(computed))
    ?Number(computed):null;
  if(!numeric)return <span className="smart-cart-qty-value">{display(computed)}</span>;
  return <div className="smart-cart-qty-controls" aria-label={"Quantity controls for "+String(name||"Product")}>
   {showDecrease&&<button type="button" data-design-area={p.builderPreview?"Button 5":undefined} className="smart-cart-qty-button" style={smartCustomButtonAppearance(p,"qtyDecrease")}
    aria-label={"Decrease quantity for "+String(name||"Product")}
    disabled={demo||!canDecrease||payload.recordId===null||quantity===null||quantity<=0}
    onClick={()=>fire?.(actions.qtyDecrease?'qtyDecrease':'qtyIcon',{...payload,delta:-1,operation:"decrement",fieldApiName:fieldName,quantity:Number(payload.record?.[fieldName]??quantity)})}>−</button>}
   <span className="smart-cart-qty-value" aria-label={quantity===null?"Quantity not bound":"Quantity "+quantity}>{display(computed)}</span>
   {showIncrease&&<button type="button" data-design-area={p.builderPreview?"Button 4":undefined} className="smart-cart-qty-button" style={smartCustomButtonAppearance(p,"qtyIncrease")}
    aria-label={"Increase quantity for "+String(name||"Product")}
    disabled={demo||!canIncrease||payload.recordId===null||quantity===null}
    onClick={()=>fire?.(actions.qtyIncrease?'qtyIncrease':'qtyIcon',{...payload,delta:1,operation:"increment",fieldApiName:fieldName,quantity:Number(payload.record?.[fieldName]??quantity)})}>+</button>}
  </div>;
 };
 return <section className="smart-cart-root" aria-label="Smart Cart" style={{
  backgroundColor:p.backgroundColor||"#fff",border:border(p.borderColor),
  borderRadius:n(p.radius,12),boxShadow:shadow(p.shadow)}}>
  <header data-design-area={p.builderPreview?"Header":undefined} className="smart-cart-header" style={{
   backgroundColor:p.headerBodyColor??"#255d9d",
   borderRadius:n(p.headerRadius,n(p.radius,12),0,600),
   height:n(p.headerBoxHeight,52,24),minHeight:n(p.headerBoxHeight,52,24),
   border:border(p.headerBorderColor),textAlign:align(p.headerAlignment),
    fontSize:n(p.headerTextSize,18,8,96),
   fontWeight:p.headerBold===false?400:700,color:p.headerTextColor||"#fff"}}><span data-md-bind={p.builderPreview?"label":undefined} data-md-bind-titles={p.builderPreview?"Cart title":undefined}>{displayFormula("label",p.label,"Smart Cart")}</span></header>
  <div data-md-bind={p.builderPreview?"cartSupportingSource":undefined} data-md-bind-titles={p.builderPreview?"Item count or supporting text":undefined} className="smart-cart-supporting" data-design-area={p.builderPreview?"Header Supporting":undefined} style={{
   height:n(p.supportingBoxHeight,36,18),minHeight:n(p.supportingBoxHeight,36,18),
   backgroundColor:p.supportingBackgroundColor??undefined,
   fontSize:n(p.supportingTextSize,13,8,96),
   border:border(p.supportingBorderColor),textAlign:align(p.supportingAlignment),
   fontWeight:p.supportingBold===true?700:400,color:p.supportingTextColor||"#586a81"}}>
   {supportingText}
  </div>
  <div data-design-area={p.builderPreview?"Table":undefined} className="smart-cart-table" style={{
   backgroundColor:p.tableBackgroundColor||"#fff",border:border(p.tableBorderColor),
   borderRadius:n(p.tableRadius,8),boxShadow:shadow(p.tableShadow),'--smart-cart-columns':columns,
   ...(p.tableWidth!==undefined&&p.tableWidth!==null&&p.tableWidth!==""
     ?{width:n(p.tableWidth,0,0,10000)+"px",maxWidth:"100%",alignSelf:"flex-start"}:{}),
   ...(p.tableHeight!==undefined&&p.tableHeight!==null&&p.tableHeight!==""
     ?{height:n(p.tableHeight,0,0,10000)+"px",flex:"0 0 auto"}:{})
   }}>
   {visible.length===0?<p className="smart-cart-no-columns">No columns selected</p>:<>
    <div className="smart-cart-columns" aria-label="Cart columns">
     {visible.map(index=>{
      const heading='cartColumn'+(index+1)+'Header';
      // Empty carts still have a visible column header. It is the exact
      // anchor for the corresponding row-value formula until rows exist.
      const pending=rows.length===0
        ?index===0?' imageSource textSource rowSupportingSource':' column'+(index+1)+'Source'
        :'';
      const titles=[
       'Product heading|Product image|Product name|Product supporting text',
       'Unit price heading|Unit price value','Quantity heading|Quantity value',
       'Total column heading|Row total value','Discount column heading|Discount value'
      ];
      return <span data-md-bind={p.builderPreview?heading+pending:undefined}
       data-md-bind-titles={p.builderPreview?titles[index]:undefined}
       key={index}>{columnHeadings[index]}</span>;
     })}
    </div>
    <div className="smart-cart-rows" role="region" tabIndex={0} aria-label="Cart item rows"
     style={{maxHeight:rowLimit*(effectiveRowHeight+6)}}>
     {rows.map((record,i)=>{
      const name=demo?"Sample item "+(i+1):(p.textSource?fieldExpression('textSource',p.textSource,record):"Product "+(i+1));
      const src=p.imageSource?fieldExpression('imageSource',p.imageSource,record):"";
      const rowSupporting=!demo&&p.rowSupportingSource
       ?fieldExpression('rowSupportingSource',p.rowSupportingSource,record):"";
      const itemId=record?.Id??record?.id??null;
      // Target an actual persisted line; never pass a synthetic merged ID to a Flow.
      const actionRecord=record.__cartSourceRows?.[0]??record;
      const payload={record:actionRecord,recordId:actionRecord?.Id??actionRecord?.id??null,
       groupedRecord:record,groupedQuantity:record.Quantity};
      const rowKey=rowKeys[i];
      const selected=selectedKey===rowKey;
      const selectRow=()=>setSelectedKey(rowKey);
      return <div key={rowKey} className={"smart-cart-row-wrap"+(selected?" is-selected":"")}
       style={{
        ...(p.rowWidth!==undefined&&p.rowWidth!==null&&p.rowWidth!==""
         ?{width:n(p.rowWidth,0,0,10000)+"px",maxWidth:"100%"}:{}),
        // Selected Row Border is retired: a selected row keeps its normal border.
        ...(selected?{backgroundColor:p.selectedRowColor??"#f2f7ff"}
          :p.rowBackgroundColor?{backgroundColor:p.rowBackgroundColor}:{})
       }} data-design-area={p.builderPreview?"Row":undefined}>
       <div className="smart-cart-row" role="button" tabIndex={0}
        aria-selected={selected} aria-expanded={selected}
        aria-label={"Select cart row "+String(name||i+1)}
        onClick={event=>{if(event.target.closest("button"))return;selectRow();}}
        onKeyDown={event=>{
         if(event.target!==event.currentTarget)return;
         if(event.key==="Enter"||event.key===" "){event.preventDefault();selectRow();}
        }} style={{
        minHeight:rowHeight,border:border(p.rowBorderColor),
        borderRadius:n(p.rowRadius,4),color:p.rowLabelColor||"#263b56",
         fontSize:n(p.rowTextSize,13,8,96),
         fontWeight:p.rowBold===true?700:undefined,
         whiteSpace:p.rowWrapText===false?"nowrap":undefined,
         textAlign:p.rowAlignment?align(p.rowAlignment):undefined}}>
       {visible.map(index=>{
        if(index===0)return <div key={index} className={"smart-cart-product "+(p.imagePlacement==="right"?"image-right":"image-left")}>
         <span data-md-bind={p.builderPreview?"imageSource":undefined} data-md-bind-titles={p.builderPreview?"Product image":undefined} className="smart-cart-image-binding" data-design-area={p.builderPreview?"Image":undefined} ><Picture src={src} alt={String(name||"Product")} loadAsset={p.loadAsset}
          style={{width:n(p.imageHeight,44,16),height:n(p.imageHeight,44,16),
           border:border(p.imageBorderColor),borderRadius:4,
           backgroundColor:p.imageBackgroundColor||undefined,
           objectFit:p.imageFill==="fit"?"contain":p.imageFill==="stretch"?"fill":"cover",
           flex:"0 0 auto",overflow:"hidden"}}/></span>
         <div className="smart-cart-product-text">
          {canClick&&!demo&&itemId!==null?
           <button data-md-bind={p.builderPreview?"textSource":undefined} data-md-bind-titles={p.builderPreview?"Product name":undefined} type="button" className="smart-cart-product-name smart-cart-product-click"
            aria-label={"Select "+String(name||"Product")} onClick={()=>fire?.("click",payload)}>{name||"Product"}</button>:
           <span data-md-bind={p.builderPreview?"textSource":undefined} data-md-bind-titles={p.builderPreview?"Product name":undefined} className="smart-cart-product-name">{name||"Product"}</span>}
          {rowSupporting!==null&&rowSupporting!==undefined&&rowSupporting!==""&&
           <span data-md-bind={p.builderPreview?"rowSupportingSource":undefined} data-md-bind-titles={p.builderPreview?"Product supporting text":undefined} className="smart-cart-row-supporting" style={{
            backgroundColor:p.rowSupportingBackgroundColor??undefined,
            border:p.rowSupportingBorderColor?"1px solid "+p.rowSupportingBorderColor:undefined,
            borderRadius:n(p.rowSupportingRadius,0,0,128),
            minHeight:p.rowSupportingHeight===undefined?undefined:n(p.rowSupportingHeight,0,0,600),
            boxShadow:p.rowSupportingShadow?shadow(p.rowSupportingShadow):undefined,
            color:p.rowSupportingTextColor||undefined,
            fontSize:n(p.rowSupportingTextSize,11,8,96),
            fontWeight:p.rowSupportingBold===true?700:400,
            textAlign:align(p.rowSupportingAlignment),
            whiteSpace:p.rowSupportingWrapText===false?"nowrap":"normal",
            overflowWrap:"anywhere"
           }}>{rowSupporting}</span>}
         </div>
        </div>;
        if(index===2)return <div data-md-bind={p.builderPreview?"column3Source":undefined} data-md-bind-titles={p.builderPreview?"Quantity value":undefined} key={index} className="smart-cart-cell-qty">
         {renderQuantity(record,name,payload)}</div>;
        const value=demo||!sources[index]?"—":fieldExpression('column'+(index+1)+'Source',sources[index],record);
        return <span data-md-bind={p.builderPreview?("column"+(index+1)+"Source"):undefined} key={index} className="smart-cart-cell" aria-label={value==="—"?headings[index]+" not bound":undefined}>
         {display(value)}</span>;
       })}
       </div>
       {selected&&expandedActions.length>0&&<div className="smart-cart-expanded-actions" role="group"
         aria-label={"Actions for "+String(name||"selected item")}>
         {expandedActions.map(action=>{
          const raw=p[action.key+"Label"];
          const label=typeof raw==="string"&&raw.trim()
           ?fieldExpression(action.key+"Label",raw,record)
           :action.label;
          return <button data-md-bind={p.builderPreview?(action.key+"Label"):undefined} data-md-bind-titles={p.builderPreview?(action.key==="customButton1"?"Custom Button 1 text":"Custom Button 2 text"):undefined} type="button" key={action.key}
           data-design-area={p.builderPreview?(action.key==="customButton1"?"Button":"Button 2"):undefined}
           className="smart-cart-custom-action"
           style={smartCustomButtonAppearance(p,action.key)}
           disabled={demo||!actions[action.key]||itemId===null}
           aria-label={String(label||action.label)}
           onClick={()=>fire?.(action.key,{...payload,selectedRowIndex:i})}>
           {label||action.label}
          </button>;
         })}
       </div>}
      </div>;
     })}
    </div>
   </>}
  </div>
  <section data-design-area={p.builderPreview?"Summary":undefined} className="smart-cart-summary" aria-label="Cart summary" style={{
   backgroundColor:p.summaryBackgroundColor||"#f7f9fc",
   border:border(p.summaryBorderColor),borderRadius:n(p.summaryRadius,8),
   boxShadow:shadow(p.summaryShadow),minHeight:n(p.summaryHeight,148,40),
   width:p.summaryWidth?n(p.summaryWidth,600,1,10000):"100%",maxWidth:"100%"}}>
   {["Subtotal","Discount","Tax"].map(label=><div key={label} className="smart-cart-summary-line"
    style={{fontSize:n(p.summaryTextSize,14,8,96),
     textAlign:p.summaryAlignment?align(p.summaryAlignment):undefined,
     justifyContent:summaryJustify(p.summaryAlignment),
     fontWeight:p.summaryTextWeight===true?700:400,color:p.summaryTextColor||"#52657d",
     whiteSpace:p.summaryWrapText===false?"nowrap":undefined}}>
    <span data-md-bind={p.builderPreview?(label.toLowerCase()+"Label"):undefined} data-md-bind-titles={p.builderPreview?(label+" summary heading"):undefined}>{summaryLabels[label]}</span><span data-md-bind={p.builderPreview?(label.toLowerCase()+"Value"):undefined} data-md-bind-titles={p.builderPreview?(label+" amount"):undefined} aria-label={summaryAmounts[label]===null?summaryLabels[label]+" not bound":undefined}>{summaryAmounts[label]??"—"}</span></div>)}
   <div data-design-area={p.builderPreview?"Footer":undefined} className="smart-cart-summary-line smart-cart-total" style={{
    fontSize:n(p.footerTextSize,p.summary2TextSize===undefined?18:n(p.summary2TextSize,18,8,96),8,96),
    fontWeight:typeof p.footerBold==="boolean"?(p.footerBold?700:400):
      p.summary2TextWeight===false?400:700,
    textAlign:p.footerAlignment?align(p.footerAlignment):
      p.summary2Alignment?align(p.summary2Alignment):undefined,
    justifyContent:summaryJustify(p.footerAlignment||p.summary2Alignment),
    color:p.footerTextColor||p.summary2TextColor||"#1c3558",
    backgroundColor:p.footerBackgroundColor||undefined,
    borderTopColor:p.footerBorderColor||undefined,
    whiteSpace:p.footerWrapText===false?"nowrap":undefined,
    ...(p.footerWidth!==undefined&&p.footerWidth!==null&&p.footerWidth!==""
     ?{width:n(p.footerWidth,0,0,10000)+"px",maxWidth:"100%"}:{}),
    ...(p.footerHeight!==undefined&&p.footerHeight!==null&&p.footerHeight!==""
     ?{minHeight:n(p.footerHeight,0,0,10000)+"px"}:{})
   }}>
    <span data-md-bind={p.builderPreview?"totalLabel":undefined} data-md-bind-titles={p.builderPreview?"Total summary heading":undefined}>{summaryLabels.Total}</span><span data-md-bind={p.builderPreview?"totalValue":undefined} data-md-bind-titles={p.builderPreview?"Total amount":undefined} aria-label={summaryAmounts.Total===null?summaryLabels.Total+" not bound":undefined}>{summaryAmounts.Total??"—"}</span>
   </div>
  </section>
 </section>;
}
