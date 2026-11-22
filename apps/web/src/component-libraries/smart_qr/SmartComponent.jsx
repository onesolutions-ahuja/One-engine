import {runComponentFormula} from "../shared/formulaCodeLookup.js";
import {encodeQr} from "./qrEncode.mjs";
import {hiddenByShowWhen} from "../shared/showWhen.js";

/** Smart QR: Text Source is any formula (a field such as @Sale.PaymentLink, page state or
 * text). With an Object it reads the first loaded record, like Smart Image loads a photo. */
// Small cache: re-renders with the same value never re-encode.
const cache=new Map();
function matrixFor(text){
 if(!text)return null;
 if(cache.has(text))return cache.get(text);
 let matrix=null;
 try{matrix=encodeQr(text);}catch{matrix=null;}
 if(cache.size>20)cache.clear();
 cache.set(text,matrix);
 return matrix;
}
export default function SmartComponent(p){
 if(hiddenByShowWhen(p))return <span data-smart-hidden="true" hidden/>;
 const records=Array.isArray(p.records)?p.records:Array.isArray(p.items)?p.items:[];
 const row=records[0]||p.record||{};
 const source=p.textSource;
 const value=typeof source==="string"&&source?runComponentFormula(p,source,row).value:"";
 const allowed=typeof p.fieldAllowed!=="function"||p.fieldAllowed("textSource",row);
 const text=allowed&&value!==null&&value!==undefined?String(value):"";
 const matrix=matrixFor(text);
 const dark=p.labelColor||"#1d1d1f",light=p.backgroundColor||"#ffffff";
 const caption=typeof p.label==="string"?p.label:"";
 // Nothing to encode: hidden at runtime (e.g. no payment link yet), a hint in the builder.
 if(!matrix&&!(p.editing||p.designMode||p.builderPreview))return null;
 if(!matrix)return <div className="smart-qr smart-qr-empty" style={{background:light,borderRadius:p.radius,border:p.borderColor?'1px solid '+p.borderColor:undefined,boxShadow:p.shadow==='large'?'0 8px 20px #0003':p.shadow==='medium'?'0 3px 9px #0003':p.shadow==='small'?'0 1px 4px #0002':undefined}}>
  <span>QR: set Text Source</span></div>;
 const size=matrix.length,quiet=4,view=size+quiet*2;
 let path="";
 matrix.forEach((cells,y)=>cells.forEach((on,x)=>{if(on)path+="M"+(x+quiet)+" "+(y+quiet)+"h1v1h-1z";}));
 return <div className="smart-qr" style={{background:light,borderRadius:p.radius,border:p.borderColor?"1px solid "+p.borderColor:undefined}}>
  <svg viewBox={"0 0 "+view+" "+view} role="img" aria-label={caption||"QR code"} shapeRendering="crispEdges">
   <rect width={view} height={view} fill={light}/><path d={path} fill={dark}/>
  </svg>
  {caption&&<div className="smart-qr-caption" style={{color:p.headerTextColor||dark,fontSize:p.headerTextSize}}>{caption}</div>}
 </div>;
}
