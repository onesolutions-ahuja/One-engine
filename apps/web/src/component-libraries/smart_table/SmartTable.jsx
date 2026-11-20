import icons from "../smart_icon/iconCatalog.json";
import {smartCustomButtonAppearance} from "../smart/shared/SmartCustomButtonAppearance.js";
import {smartPartSide} from "../smart/shared/SmartPartPlacement.js";
/** Smart Table is presentation-only: Object API, filters, formula projections,
 * selected-field permissions and action execution are owned by shared runtimes.
 */
const finite=(value,fallback,min,max)=>Number.isFinite(Number(value))
 ?Math.max(min,Math.min(max,Number(value))):fallback;
const shadow=value=>value==="large"?"0 8px 20px #0003":
 value==="medium"?"0 3px 9px #0003":value==="small"?"0 1px 4px #0002":"none";
const colour=(value,fallback)=>typeof value==="string"&&value?value:fallback;
const plain=value=>value===undefined||value===null?"":String(value);
const fieldKey=source=>/^=?\s*@(?:[A-Za-z][A-Za-z0-9_]*\.)?([A-Za-z][A-Za-z0-9_]*)$/.exec(plain(source).trim())?.[1];
const own=(row,key)=>row&&Object.prototype.hasOwnProperty.call(row,key);
const knownIcons=new Set(icons.map(icon=>icon.id));
export default function SmartTable({p,records,expression,fieldAllowed,fire}){
 const realRows=Array.isArray(records)?records:[];
 const preview=p.builderPreview===true&&realRows.length===0;
 const rows=preview?[{Id:"preview-1",Name:"Example",Price:12,Quantity:2},
   {Id:"preview-2",Name:"Another item",Price:8,Quantity:1}]:realRows;
 const sourceObject=p.dataCollection?.objectApiName||p.objectApiName;
 const metadata=Array.isArray(p.objects)?p.objects.find(item=>item.apiName===sourceObject):null;
 const fields=Array.isArray(metadata?.fields)?metadata.fields:[];
 const allowed=new Set(fields.map(field=>field.apiName));
 const projected=Array.isArray(p.dataCollection?.columns)?p.dataCollection.columns:null;
 const sourceColumns=projected??(fields.length?fields.map(field=>field.apiName):
  Object.keys(rows[0]||{}).filter(key=>/^[A-Za-z][A-Za-z0-9_]*$/.test(key)));
 // Columns (optional): "Name, SKU, StockLevel, Status" — fields in this order; a name that
 // is not a field is a formula column (its Column N Source). Header N / Color N / Align N
 // then apply to any column. Without it the table keeps showing every field.
 const listed=typeof p.tableColumns==="string"&&p.tableColumns.trim()
  ?p.tableColumns.split(",").map(item=>item.trim()).filter(item=>/^[A-Za-z][A-Za-z0-9_]*$/.test(item)).slice(0,12):null;
 const slot=(index,part)=>p["column"+(index+1)+part];
 const keys=listed?listed.filter((key,index)=>!["Id","id"].includes(key)
   &&(!fields.length||allowed.has(key)||Boolean(slot(index,"Source"))))
  :[...new Set(sourceColumns)].filter(key=>typeof key==="string"
  &&/^[A-Za-z][A-Za-z0-9_]*$/.test(key)&&!["Id","id"].includes(key)
  &&(!fields.length||allowed.has(key))&&(!key.startsWith("__"))).slice(0,128);
 const columns=keys.map((key,index)=>({
  key,index,
  label:(listed&&plain(slot(index,"Header")))||fields.find(item=>item.apiName===key)?.label||key,
  override:listed?slot(index,"Source")||null:index>0&&index<5?p["column"+(index+1)+"Source"]:null,
  color:listed?slot(index,"Color")||null:null,
  align:listed&&["left","center","right"].includes(slot(index,"Align"))?slot(index,"Align"):null
 }));
 const cellColor=(row,column)=>{
  if(!column.color)return undefined;
  const result=plain(/^\s*=|@/.test(column.color)?expression(column.color,row):column.color).trim();
  return /^#[0-9a-f]{3,8}$|^rgba?\([0-9., %]+\)$|^[a-z]{3,20}$/i.test(result)?result:undefined;
 };
 // Up to four row buttons, hidden by default: a button shows when made visible
 // (eye on), or — for tables saved before this — when it already has an action.
 const actions=[1,2,3,4].map(n=>{
  const event="customButton"+n;
  const visible=p[event+"Visible"]===true||(p[event+"Visible"]!==false&&Boolean(p.actionFlows?.[event]));
  const icon=knownIcons.has(p[event+"Icon"])?p[event+"Icon"]:"";
  const display=icon?(p[event+"Display"]||"icon+text"):"text";
  return {event,visible,icon,display,
   label:plain(p[event+"Label"])||(n===1?"Delete":n===2?"View":"Button "+n),
   side:smartPartSide(p[event+"Placement"],"right")};
 }).filter(action=>action.visible||(p.builderPreview&&p[action.event+"Visible"]===true));
 const startActions=actions.filter(action=>action.side==="left");
 const endActions=actions.filter(action=>action.side!=="left");
 const [selected,setSelected]=React.useState(null);
 // Style = iOS (saved on new inserts). Configured colours still win; this only
 // changes the defaults used when nothing was set. Older tables stay Classic.
 // iOS is the only Smart style (the Classic/iOS switch was removed).
 const ios=true;
 const border=value=>value?"1px solid "+value:"1px solid transparent";
 const headingStyle={
  backgroundColor:colour(p.headerBodyColor,ios?"#f9f9fb":"#f3f6fb"),
  // Default Value Color is retired for Smart Table; Header Label Color owns this.
  color:colour(p.headerTextColor,ios?"#6e6e73":"#172a45"),
  borderBottom:border(p.headerBorderColor),
  textAlign:p.headerAlignment||p.labelAlignment||"left",
  fontSize:finite(p.headerTextSize??p.textSize,13,9,96),
  height:p.headerBoxHeight!==undefined&&p.headerBoxHeight!==null&&p.headerBoxHeight!==""
   ?finite(p.headerBoxHeight,0,0,2000):undefined,
  fontWeight:p.headerBold===false?400:ios?600:700,
  whiteSpace:p.wrapText===false?"nowrap":"pre-line"
 };
 const rowHeight=finite(p.rowHeight,40,22,300);
 const rowStyle=row=>({
  height:rowHeight,minHeight:rowHeight,
  color:colour(p.rowLabelColor,"#27374d"),
  fontSize:finite(p.rowTextSize,13,8,96),
  fontWeight:p.rowBold===true?700:undefined,
  textAlign:p.rowAlignment||undefined,
  whiteSpace:p.rowWrapText===false?"nowrap":undefined,
  // A selected row keeps its selected colour; otherwise the Row fill applies.
  background:selected!==null&&String(row.Id??row.id)===selected
   ?colour(p.selectedRowColor,ios?"#e5f0ff":"#e7f1ff"):p.rowBackgroundColor?colour(p.rowBackgroundColor,undefined):undefined
 });
 const value=(row,column)=>{
  if(!column.override)return plain(row?.[column.key]);
  if(typeof fieldAllowed==="function"&&!fieldAllowed("column"+(column.index+1)+"Source",row))
   return "";
  return plain(expression(column.override,row));
 };
 // Show only (optional): "Status=Low|Out of stock" keeps rows whose column shows one of
 // those values. For rules the server cannot filter by (formula fields, field vs field).
 // Blank shows every row; it can be a page formula (follow a tab).
 const showWhen=plain(p.tableShowWhen).trim();
 const showMatch=/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(showWhen);
 const showColumn=showMatch?columns.find(col=>col.key===showMatch[1]):null;
 const allowedValues=showMatch?new Set(showMatch[2].split("|").map(v=>v.trim().toLowerCase())):null;
 const visibleRows=showColumn&&!preview?rows.filter(row=>allowedValues.has(value(row,showColumn).trim().toLowerCase())):rows;
 // Sort (optional): "InStock asc" orders the loaded rows by that column's shown value
 // (numbers as numbers). Works for formula columns, which the server cannot sort by.
 const [sortKey,sortDir]=plain(p.tableSort).trim().split(/\s+/);
 const sortColumn=sortKey?columns.find(col=>col.key===sortKey):null;
 const sortedRows=sortColumn&&!preview?[...visibleRows].map(row=>({row,shown:value(row,sortColumn)}))
  .sort((a,b)=>{
   // UK dates (DD/MM/YYYY HH:mm or DD/MM HH:mm) sort by date, not as text.
   const when=text=>{const m=/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text.trim());
    return m?Number(m[3]||2000)*1e8+Number(m[2])*1e6+Number(m[1])*1e4+Number(m[4]||0)*100+Number(m[5]||0):NaN;};
   const x=Number.isFinite(when(a.shown))?when(a.shown):Number(a.shown),y=Number.isFinite(when(b.shown))?when(b.shown):Number(b.shown);
   const both=a.shown!==""&&b.shown!==""&&Number.isFinite(x)&&Number.isFinite(y);
   const order=both?x-y:a.shown.localeCompare(b.shown,undefined,{numeric:true,sensitivity:"base"});
   return sortDir==="desc"?-order:order;
  }).map(item=>item.row):visibleRows;
 const pick=row=>{
  const id=row.Id??row.id;
  if(id===undefined||id===null||preview)return;
  setSelected(String(id));
  fire?.("rowSelect",{record:row,recordId:id});
 };
 const buttonCell=(list,row,id,side)=><td className={"smart-table-actions smart-table-actions-"+side}
   style={{borderBottom:border(p.rowBorderColor??(ios?"rgb(60 60 67 / .12)":undefined))}}>
   {list.map(action=>{
    const iconOnly=action.icon&&action.display==="icon";
    return <button type="button" key={action.event} className="smart-table-row-button"
     data-design-area={p.builderPreview?(action.event==="customButton1"?"Button":"Button "+action.event.slice(-1)):undefined}
     aria-label={action.label+" "+id} title={iconOnly?action.label:undefined}
     style={smartCustomButtonAppearance(p,action.event)}
     disabled={preview||p.previewOnly===true||!p.actionFlows?.[action.event]}
     onClick={event=>{event.stopPropagation();
      fire?.(action.event,{record:row,recordId:row?.Id??row?.id??null});
     }}>
     {action.icon&&<span className="smart-table-row-icon" aria-hidden="true" style={{
      WebkitMaskImage:"url(/smart-icons/"+action.icon+".svg)",maskImage:"url(/smart-icons/"+action.icon+".svg)"}}/>}
     {!iconOnly&&<span>{action.label}</span>}
    </button>;
   })}
  </td>;
 const total=showColumn?visibleRows.length:typeof p.recordPagination?.total==="number"
  ?p.recordPagination.total:realRows.length;
 const shown=showColumn?visibleRows.length:realRows.length;
 const footerText=total>shown
  ?shown+" of "+total+" records":total===1?"1 record":total+" records";
 const footerStyle={
  backgroundColor:colour(p.footerBackgroundColor??p.summaryBackgroundColor,ios?"#f9f9fb":"#f5f7fa"),
  color:colour(p.footerTextColor??p.summaryTextColor,ios?"#8e8e93":"#33445d"),
  height:finite(p.footerHeight??p.summaryHeight,36,22,300),
  minHeight:finite(p.footerHeight??p.summaryHeight,36,22,300),
  fontSize:finite(p.footerTextSize??p.summaryTextSize,12,9,96),
  fontWeight:typeof p.footerBold==="boolean"?(p.footerBold?700:400):
   p.summaryTextWeight===true?700:400,
  textAlign:p.footerAlignment??p.summaryAlignment??undefined,
  border:border(p.footerBorderColor??p.summaryBorderColor),
  borderRadius:finite(p.summaryRadius,4,0,100),
  boxShadow:shadow(p.summaryShadow),
  whiteSpace:p.footerWrapText===false?"nowrap":undefined,
  width:p.footerWidth!==undefined&&p.footerWidth!==null&&p.footerWidth!==""
   ?finite(p.footerWidth,0,0,10000)+"px":
   p.summaryWidth?finite(p.summaryWidth,200,20,2000)+"px":"100%",
  maxWidth:"100%"
 };
 return <section className={"smart-table-root"+(ios?" smart-ios":"")} aria-label={p.label||"Smart Table"}
  data-builder-preview={p.builderPreview?"true":undefined}
  style={{background:colour(p.backgroundColor,"#fff"),border:border(p.borderColor),
   boxShadow:shadow(p.shadow),borderRadius:finite(p.radius,10,0,100),
   padding:0}}>
  <div data-design-area={p.builderPreview?"Table":undefined} className="smart-table-scroll" role="region" tabIndex={0}
   aria-label="Table records" aria-busy={p.loading===true}
   style={{background:colour(p.tableBackgroundColor,"#fff"),
    border:border(p.tableBorderColor),borderRadius:finite(p.tableRadius,4,0,100),
    boxShadow:shadow(p.tableShadow),
    "--smart-table-selected-row":colour(p.selectedRowColor,"#e7f1ff")}}>
   {columns.length?<table className="smart-table-native"
    style={p.rowWidth!==undefined&&p.rowWidth!==null&&p.rowWidth!==""
     ?{width:finite(p.rowWidth,0,0,10000)+"px",minWidth:0}:undefined}>
    <thead><tr data-design-area={p.builderPreview?"Header":undefined} >
      {startActions.length>0&&<th scope="col" style={headingStyle}><span className="smart-table-sr">Actions</span></th>}
      {columns.map(col=><th scope="col" key={col.key}
      data-md-bind={p.builderPreview&&(listed||col.index>0&&col.index<5)?"column"+(col.index+1)+"Source":undefined}
      data-md-bind-titles={p.builderPreview?(col.label+" column value"):undefined}
      style={col.align?{...headingStyle,textAlign:col.align}:headingStyle}>{col.label}</th>)}
      {endActions.length>0&&<th scope="col" style={headingStyle}><span className="smart-table-sr">Actions</span></th>}
    </tr></thead>
    <tbody>{sortedRows.map((row,index)=>{
     const id=String(row?.Id??row?.id??index);
     const active=selected===id;
     // Selected Row Border is retired: a selected row keeps its normal border.
     const borderColor=p.rowBorderColor;
     return <tr key={id} data-design-area={p.builderPreview?"Row":undefined} tabIndex={0} aria-selected={active}
       style={rowStyle(row)} onClick={()=>pick(row)}
       onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){
        event.preventDefault();pick(row);
       }}}>
       {startActions.length>0&&buttonCell(startActions,row,id,"start")}
       {columns.map((col,i)=><td key={col.key}
         style={{borderBottom:border(borderColor??(ios?"rgb(60 60 67 / .12)":undefined)),
          borderTop:active?border(borderColor):undefined,
          borderTopLeftRadius:i===0?finite(p.rowRadius,0,0,100):undefined,
          borderBottomLeftRadius:i===0?finite(p.rowRadius,0,0,100):undefined,
          borderTopRightRadius:i===columns.length-1&&!endActions.length?finite(p.rowRadius,0,0,100):undefined,
          borderBottomRightRadius:i===columns.length-1&&!endActions.length?finite(p.rowRadius,0,0,100):undefined,
          textAlign:col.align||p.rowAlignment||"left",height:rowHeight,
          ...(cellColor(row,col)?{color:cellColor(row,col),fontWeight:600}:{}),
          ...(col.align==="right"?{fontVariantNumeric:"tabular-nums"}:{})}}>
         {value(row,col)}</td>)}
       {endActions.length>0&&buttonCell(endActions,row,id,"end")}
      </tr>;
    })}</tbody>
   </table>:<p className="smart-table-empty">Select a table source to display fields.</p>}
   {!sortedRows.length&&!p.loading&&<p className="smart-table-empty">{plain(p.emptyText)||"No records"}</p>}
  </div>
  {/* Show record count: off for receipts and lists where "3 records" is noise. */}
  {p.footerVisible===false?null:<footer data-design-area={p.builderPreview?"Footer":undefined} className="smart-table-footer" style={footerStyle}>{footerText}</footer>}
 </section>;
}
