import * as React from 'react';
import './PreviewDeviceFrame.css';
import { attachPreviewDragScroll } from './previewDragScroll';

/** Screen size of each device in Preview (CSS pixels), like Chrome's device mode. */
const SCREEN_HEIGHT:Record<string,number>={Phone:844,Tablet:768};

/**
 * Builder Preview only. Phone and Tablet layouts run inside a device-sized screen
 * that scrolls on its own, so the page behaves like it does on the device:
 * the page scrolls under a fixed screen, and fixed elements stay inside it.
 * The screen is also where SCREEN(...,popup) pages open (data-formula-screen-host).
 * Like Chrome's device mode, the mouse can drag-scroll it (see previewDragScroll);
 * wheel and trackpad scrolling work as normal. Desktop is unchanged.
 */
export default function PreviewDeviceFrame({device,width,children}:{
 device:string;width:number;children:React.ReactNode
}){
 const height=SCREEN_HEIGHT[device];
 const screen=React.useRef<HTMLDivElement>(null);
 React.useEffect(()=>{
  // On the whole screen, so open popup pages drag-scroll too.
  const root=screen.current;
  return root?attachPreviewDragScroll(root):undefined;
 },[height]);
 if(!height)return <>{children}</>;
 const screenWidth=Math.max(320,Math.round(width||390));
 return <div className="preview-device-frame" data-device={device}>
  <div ref={screen} className="preview-device-viewport" data-formula-screen-host="true" data-device={device}
   style={{width:screenWidth,'--preview-device-height':height+'px'} as React.CSSProperties}>
   <div className="preview-device-scroll">{children}</div>
  </div>
 </div>;
}
