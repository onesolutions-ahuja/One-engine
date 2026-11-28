import {useEffect,useRef} from 'react';
import {showMessageScreen} from './messageScreen';
import './RuntimeComponentNotices.css';

/**
 * Errors of a component on a running page. They never push the page around:
 * - an action error (a tap that failed, e.g. a link to a deleted page) opens a small message box;
 * - a data error on a placed (free-canvas) component is a small "!" badge with the text on hover.
 * Before, both were inline blocks above the component, which moved dock bars and buttons.
 * Pages laid out in regions (not on a canvas) keep the inline message, where nothing overlaps.
 */
export default function RuntimeComponentNotices({actionError,clearActionError,dataErrors,placed}:{
 actionError:string;clearActionError:()=>void;dataErrors:readonly (string|null|undefined|false)[];placed:boolean;
}){
 const shown=useRef('');
 const anchor=useRef<HTMLSpanElement>(null);
 useEffect(()=>{
  if(!actionError||shown.current===actionError)return;
  shown.current=actionError;
  // The component that failed is outlined red while its message is open.
  const host=anchor.current?.closest<HTMLElement>('.free-canvas-runtime-component')
   ??anchor.current?.closest<HTMLElement>('[data-compiled-component]')??null;
  host?.classList.add('runtime-action-error');
  void showMessageScreen({kind:'info',message:actionError}).then(()=>{
   host?.classList.remove('runtime-action-error');
   shown.current='';
   clearActionError();
  });
 },[actionError]); // eslint-disable-line react-hooks/exhaustive-deps
 const messages=dataErrors.filter((message):message is string=>typeof message==='string'&&message.length>0);
 const marker=<span ref={anchor} hidden/>;
 if(!messages.length)return marker;
 if(!placed)return <>{marker}{messages.map((message,index)=><div key={index} className="records-message" role="alert">{message}</div>)}</>;
 return <>{marker}<span role="alert" aria-label={messages.join('; ')} title={messages.join('\n')} className="runtime-component-notice"
  style={{position:'absolute',right:2,top:2,zIndex:5,display:'grid',placeItems:'center',width:16,height:16,
   borderRadius:4,background:'#fff4db',color:'#9a3412',border:'1px solid #f59e0b',fontSize:12,fontWeight:700,
   pointerEvents:'auto'}}>!</span></>;
}
