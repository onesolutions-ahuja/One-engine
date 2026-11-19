import {idCardFieldSlots,idCardFieldColumns,idCardFieldLayout,idCardFieldStyle,idCardLabelStyle} from "./idCardFields.mjs";

/** The field list of one Smart ID Card. Every value goes through the caller's
 * resolve(key,source): the same record-scoped, permission-aware formula path as
 * the Card Grid title (page code first, field filters honoured). Each field is
 * its own Design area ("Field N") and data binding, so in the Page Builder it
 * can be clicked to style, bound with the field picker and dragged to a new X/Y. */
export default function SmartIdCardFields({p,record,sample,resolve,offsetStyle,padding,focusedText,errorColor}){
 const builder=p.builderPreview===true;
 const slots=idCardFieldSlots(p,builder);
 if(!slots.length)return null;
 const layout=idCardFieldLayout(p);
 const labelStyle=idCardLabelStyle(p);
 return <div className="smart-id-card-fields" data-layout={layout} style={{order:2,
   gridTemplateColumns:"repeat("+idCardFieldColumns(p)+",minmax(0,1fr))",
   padding:padding===null||padding===undefined?"2px 10px 10px":padding+"px"}}>
  {slots.map(({n,keys,configured})=>{
   const labelSource=p[keys.label];
   const valueSource=p[keys.source];
   const label=labelSource!==undefined&&labelSource!==null&&labelSource!==""
    ?String(resolve(keys.label,labelSource).value??""):"";
   const result=valueSource!==undefined&&valueSource!==null&&valueSource!==""
    ?resolve(keys.source,valueSource):{value:""};
   const shown=result.error?"FORMULAERROR":String(result.value??"");
   // Builder placeholders keep empty slots visible and clickable; never published.
   const placeholderLabel=builder&&!configured?"Field "+n:"";
   const placeholderValue=builder&&!shown&&(sample||!configured||!record)?"Value":"";
   return <div key={n} className="smart-id-card-field" data-field={n}
    data-design-area={builder?keys.area:undefined}
    style={{...offsetStyle(keys.offset),...idCardFieldStyle(p,n),
     ...(focusedText?{color:focusedText}:{})}}>
    {(label||placeholderLabel)&&<span className="smart-id-card-label"
      data-md-bind={builder?keys.label:undefined} data-md-bind-titles={builder?"Field "+n+" caption":undefined}
      style={labelStyle}>{label||placeholderLabel}</span>}
    <span className="smart-id-card-value" title={result.error||undefined}
     data-md-bind={builder?keys.source:undefined} data-md-bind-titles={builder?"Field "+n+" value":undefined}
     style={result.error?{color:errorColor}:undefined}>{shown||placeholderValue}</span>
   </div>;
  })}
 </div>;
}
