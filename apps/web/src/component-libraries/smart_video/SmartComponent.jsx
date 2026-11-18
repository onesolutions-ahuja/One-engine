import React from "react";
import {convertedFormula} from "../shared/formulaCodeLookup.js";
import {evaluateFieldExpression} from "../shared/FieldExpression.js";
import {hiddenByShowWhen} from "../shared/showWhen.js";
import {videoList} from "./videoList.mjs";

/** Smart Video: like Smart Image, the source is metadata — a URL, a record field
 * (@Product.VideoUrl) or a formula. Several URLs separated by ";" (or new lines) play one
 * after another. Image Fill decides fit (fill = cover, fit = whole video, stretch).
 * Plays muted and on a loop unless the page says otherwise (browsers only autoplay muted). */
const fitFor=fill=>fill==="fit"?"contain":fill==="stretch"?"fill":"cover";
const off=value=>value===false||value==="false"||value===0||value==="0";

export default function SmartComponent(p){
 const [index,setIndex]=React.useState(0);
 const records=Array.isArray(p.records)?p.records:Array.isArray(p.items)?p.items:[];
 const row=records[0]||p.record||{};
 const source=p.imageSource;
 let value=source;
 if(typeof source==="string"&&/^\s*=|^\s*@/.test(source)){
  const code=p.__formulaCode&&p.__formulaCode.functions instanceof Map?p.__formulaCode.functions:null;
  const run=code?convertedFormula(code,source):null;
  try{
   value=run?run(row):evaluateFieldExpression(source,row,{readComponent:p.readComponent,
    rootObjectApiName:p.objectApiName,pageState:p.pageState,sessionId:p.sessionId,
    collectionSources:p.formulaCollectionSources,namedCollections:p.namedCollections,
    namedCollectionSelections:p.pageState?.collectionSelections});
  }catch{value="";}
 }
 const list=videoList(value);
 const key=list.join(";");
 React.useEffect(()=>setIndex(0),[key]);
 if(hiddenByShowWhen(p))return null;
 const design=p.editing||p.designMode||p.builderPreview;
 const box={borderRadius:p.radius,border:p.borderColor?"1px solid "+p.borderColor:undefined,
  background:p.backgroundColor||undefined};
 if(!list.length)return design?<div className="smart-video smart-video-empty" style={box}>
  <span>Video: set Image Source to a video URL or field</span></div>:null;
 const current=list[Math.min(index,list.length-1)];
 const many=list.length>1;
 const ended=()=>{
  if(typeof p.onAction==="function"&&!design)void Promise.resolve(p.onAction({event:"ended",value:current})).catch(()=>{});
  if(many)setIndex(i=>(i+1)%list.length);
 };
 return <div className="smart-video" style={box}>
  <video key={current} src={current} style={{objectFit:fitFor(p.imageFill)}}
   autoPlay={!design&&!off(p.videoAutoplay)} muted={!off(p.videoMuted)} playsInline
   loop={!many&&!off(p.videoLoop)} controls={p.videoControls===true||p.videoControls==="true"}
   preload={design?"metadata":"auto"} onEnded={ended}/>
 </div>;
}
