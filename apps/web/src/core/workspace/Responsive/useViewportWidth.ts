import {useEffect,useState} from 'react';

/** Debounced viewport width, used only to resolve published form-factor targets.
 * Does not inspect or expose tenant or user metadata. */
export function useViewportWidth():number {
  const [width,setWidth]=useState(()=>typeof window==='undefined'?0:window.innerWidth);
  useEffect(()=>{
    let pending:number|undefined;
    const update=()=>{
      window.clearTimeout(pending);
      pending=window.setTimeout(()=>setWidth(window.innerWidth),200);
    };
    window.addEventListener('resize',update,{passive:true});
    return ()=>{window.removeEventListener('resize',update);window.clearTimeout(pending);};
  },[]);
  return width;
}
