import {useRef,useState} from 'react';
export function useFlowPropertiesWidth(){
 const [propertiesWidth,setPropertiesWidth]=useState(()=>{
  try {const saved=Number(window.localStorage.getItem('metadrive.flowBuilder.propertiesWidth'));return Number.isFinite(saved)&&saved>=280?saved:285;}catch{return 285;}
 });
 const workareaRef=useRef<HTMLDivElement>(null);
 const clampPropertiesWidth=(width:number)=>{
  const available=workareaRef.current?.clientWidth??1100;
  return Math.round(Math.max(280,Math.min(width,Math.max(280,Math.min(available*.5,available-560)))));
 };
 return {propertiesWidth,setPropertiesWidth,workareaRef,clampPropertiesWidth};
}
export function FlowPropertiesResizeHandle({width,setWidth,clamp}:{width:number;setWidth:(width:number)=>void;clamp:(width:number)=>number}){
 const resize=useRef<{x:number;width:number}|null>(null);
 const persist=(next:number)=>{try{window.localStorage.setItem('metadrive.flowBuilder.propertiesWidth',String(next));}catch{/* unavailable */}};
 return <div role="separator" aria-label="Resize Flow properties panel" aria-orientation="vertical"
 tabIndex={0} title="Drag to resize the properties panel; use arrow keys for fine adjustment"
 style={{cursor:'col-resize',touchAction:'none',background:'#e3e7ed',borderLeft:'1px solid #ccd3dd',borderRight:'1px solid #ccd3dd'}}
 onPointerDown={event=>{if(event.button!==0)return;resize.current={x:event.clientX,width};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}}
 onPointerMove={event=>{if(resize.current)setWidth(clamp(resize.current.width+resize.current.x-event.clientX));}}
 onPointerUp={event=>{if(!resize.current)return;resize.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);persist(width);}}
 onPointerCancel={()=>{resize.current=null;}}
 onKeyDown={event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();const next=clamp(width+(event.key==='ArrowLeft'?20:-20));setWidth(next);persist(next);}}/>;
}
