/** Smart Table is presentation-only: Object API, filters, formula projections,
 * selected-field permissions and action execution are owned by shared runtimes.
 */
const finite=(value,fallback,min,max)=>Number.isFinite(Number(value))
 ?Math.max(min,Math.min(max,Number(value))):fallback;
const shadow=value=>value==="large"?"0 8px 20px #0003":
 value==="medium"?"0 3px 9px #0003":value==="small"?"0 1px 4px #0002":"none";
const colour=(value,fallback)=>typeof value==="string"&&value?value:fallback;
const plain=value=>value===undefined||value===null?"":String(value);
const fieldKey=source=>/^@([A-Za-z][A-Za-z0-9_]*)$/.exec(plain(source).trim())?.[1];
const own=(row,key)=>row&&Object.prototype.hasOwnProperty.call(row,key);
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
 const keys=[...new Set(sourceColumns)].filter(key=>typeof key==="string"
  &&/^[A-Za-z][A-Za-z0-9_]*$/.test(key)&&!["Id","id"].includes(key)
  &&(!fields.length||allowed.has(key))&&(!key.startsWith("__"))).slice(0,128);
 const columns=keys.map((key,index)=>({
  key,index,label:fields.find(item=>item.apiName===key)?.label||key,
  override:index>0&&index<5?p["column"+(index+1)+"Source"]:null
 }));
 const actions=[
  {event:"customButton1",label:p.customButton1Label||"Delete",enabled:p.customButton1Visible!==false},
  {event:"customButton2",label:p.customButton2Label||"View",enabled:p.customButton2Visible!==false}
 ].filter(action=>action.enabled);
 const [selected,setSelected]=React.useState(null);
 const border=value=>value?"1px solid "+value:"1px solid transparent";
 const headingStyle={
  backgroundColor:colour(p.headerBodyColor,"#f3f6fb"),
  // Default Value Color is retired for Smart Table; Header Label Color owns this.
  color:colour(p.headerTextColor,"#172a45"),
  borderBottom:border(p.headerBorderColor),
  textAlign:p.headerAlignment||p.labelAlignment||"left",
  fontSize:finite(p.headerTextSize??p.textSize,13,9,96),
  height:p.headerBoxHeight!==undefined&&p.headerBoxHeight!==null&&p.headerBoxHeight!==""
   ?finite(p.headerBoxHeight,0,0,2000):undefined,
  fontWeight:p.headerBold===false?400:700,
  whiteSpace:p.wrapText===false?"nowrap":"normal"
 };
 const rowHeight=finite(p.rowHeight,40,22,300);
 const rowStyle=row=>({
  height:rowHeight,minHeight:rowHeight,
  color:colour(p.rowLabelColor,"#27374d"),
  fontSize:finite(p.rowTextSize,13,8,96),
  fontWeight:p.rowBold===true?700:undefined,
  textAlign:p.rowAlignment||undefined,
  background:selected!==null&&String(row.Id??row.id)===selected
   ?colour(p.selectedRowColor,"#e7f1ff"):undefined
 });
 const value=(row,column)=>{
  if(!column.override)return plain(row?.[column.key]);
  if(typeof fieldAllowed==="function"&&!fieldAllowed("column"+(column.index+1)+"Source",row))
   return "";
  return plain(expression(column.override,row));
 };
 const pick=row=>{
  const id=row.Id??row.id;
  if(id===undefined||id===null||preview)return;
  setSelected(String(id));
  fire?.("rowSelect",{record:row,recordId:id});
 };
 const total=typeof p.recordPagination?.total==="number"
  ?p.recordPagination.total:realRows.length;
 const shown=realRows.length;
 const footerText=total>shown
  ?shown+" of "+total+" records":total===1?"1 record":total+" records";
 const footerStyle={
  backgroundColor:colour(p.footerBackgroundColor??p.summaryBackgroundColor,"#f5f7fa"),
  color:colour(p.footerTextColor??p.summaryTextColor,"#33445d"),
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
 return <section className="smart-table-root" aria-label={p.label||"Smart Table"}
  style={{background:colour(p.backgroundColor,"#fff"),border:border(p.borderColor),
   boxShadow:shadow(p.shadow),borderRadius:finite(p.radius,10,0,100),
   padding:0}}>
  <div className="smart-table-scroll" role="region" tabIndex={0}
   aria-label="Table records" aria-busy={p.loading===true}
   style={{background:colour(p.tableBackgroundColor,"#fff"),
    border:border(p.tableBorderColor),borderRadius:finite(p.tableRadius,4,0,100),
    boxShadow:shadow(p.tableShadow),
    "--smart-table-selected-row":colour(p.selectedRowColor,"#e7f1ff")}}>
   {columns.length?<table className="smart-table-native"
    style={p.rowWidth!==undefined&&p.rowWidth!==null&&p.rowWidth!==""
     ?{width:finite(p.rowWidth,0,0,10000)+"px",minWidth:0}:undefined}>
    <thead><tr>{columns.map(col=><th scope="col" key={col.key}
      data-md-bind={p.builderPreview&&col.index>0&&col.index<5?"column"+(col.index+1)+"Source":undefined}
      data-md-bind-titles={p.builderPreview?(col.label+" column value"):undefined}
      style={headingStyle}>{col.label}</th>)}
      {actions.length>0&&<th scope="col" style={headingStyle}>Actions</th>}
    </tr></thead>
    <tbody>{rows.map((row,index)=>{
     const id=String(row?.Id??row?.id??index);
     const active=selected===id;
     // Selected Row Border is retired: a selected row keeps its normal border.
     const borderColor=p.rowBorderColor;
     return <tr key={id} tabIndex={0} aria-selected={active}
       style={rowStyle(row)} onClick={()=>pick(row)}
       onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){
        event.preventDefault();pick(row);
       }}}>
       {columns.map((col,i)=><td key={col.key}
         style={{borderBottom:border(borderColor),
          borderTop:active?border(borderColor):undefined,
          borderTopLeftRadius:i===0?finite(p.rowRadius,0,0,100):undefined,
          borderBottomLeftRadius:i===0?finite(p.rowRadius,0,0,100):undefined,
          borderTopRightRadius:i===columns.length-1&&!actions.length?finite(p.rowRadius,0,0,100):undefined,
          borderBottomRightRadius:i===columns.length-1&&!actions.length?finite(p.rowRadius,0,0,100):undefined,
          textAlign:p.rowAlignment||"left",height:rowHeight}}>
         {value(row,col)}</td>)}
       {actions.length>0&&<td className="smart-table-actions"
         style={{borderBottom:border(borderColor),
          borderTopRightRadius:finite(p.rowRadius,0,0,100),
          borderBottomRightRadius:finite(p.rowRadius,0,0,100)}}>
         {actions.map(action=><button type="button" key={action.event}
           aria-label={action.label+" "+id}
           disabled={preview||p.previewOnly===true||!p.actionFlows?.[action.event]}
           onClick={event=>{event.stopPropagation();
            fire?.(action.event,{record:row,recordId:row?.Id??row?.id??null});
           }}>{action.label}</button>)}
       </td>}
      </tr>;
    })}</tbody>
   </table>:<p className="smart-table-empty">Select a table source to display fields.</p>}
   {!rows.length&&!p.loading&&<p className="smart-table-empty">No records</p>}
  </div>
  <footer className="smart-table-footer" style={footerStyle}>{footerText}</footer>
 </section>;
}
