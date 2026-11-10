import * as React from 'react';
import './PreviewDeviceFrame.css';

/** Screen size of each device in Preview (CSS pixels), like Chrome's device mode. */
const SCREEN_HEIGHT:Record<string,number>={Phone:844,Tablet:768};

/**
 * Builder Preview only. Phone and Tablet layouts run inside a device-sized screen
 * that scrolls on its own, so the page behaves like it does on the device:
 * the page scrolls under a fixed screen, and fixed elements stay inside it.
 * The screen is also where SCREEN(...,popup) pages open (data-formula-screen-host).
 * Desktop is unchanged.
 */
export default function PreviewDeviceFrame({device,width,children}:{
 device:string;width:number;children:React.ReactNode
}){
 const height=SCREEN_HEIGHT[device];
 if(!height)return <>{children}</>;
 const screenWidth=Math.max(320,Math.round(width||390));
 return <div className="preview-device-frame" data-device={device}>
  <div className="preview-device-viewport" data-formula-screen-host="true" data-device={device}
   style={{width:screenWidth,'--preview-device-height':height+'px'} as React.CSSProperties}>
   <div className="preview-device-scroll">{children}</div>
  </div>
 </div>;
}
