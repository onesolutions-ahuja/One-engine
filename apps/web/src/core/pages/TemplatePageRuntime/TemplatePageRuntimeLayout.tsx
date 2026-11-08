import type { ReactNode } from 'react';
import { Grid2X2 } from 'lucide-react';

type TemplatePageRuntimeLayoutProps = {
  apiName: string;
  label: string;
  pageType: string;
  template?: string;
  fullscreen: boolean;
  phone: boolean;
  layoutVariant?: string;
  overlayOpen?: boolean;
  canvasFillColor?:string;
  embedded?: boolean;
  header: ReactNode;
  main: ReactNode;
  sidebar: ReactNode;
};

/** Shared, metadata-selected runtime layout. No app-specific paths or names. */
export default function TemplatePageRuntimeLayout({
  apiName, label, pageType, template, fullscreen, phone, layoutVariant, overlayOpen, embedded, header, main, sidebar, canvasFillColor
}: TemplatePageRuntimeLayoutProps) {
  const rail = fullscreen && layoutVariant === 'rail-checkout';
  const hasSidebar = template === 'main-sidebar' || template === 'header-main-sidebar';
  // Grid-region children must stretch: shared CSS otherwise uses align-content:start
  // and leaves sandboxed 100%-height iframes at their intrinsic minimum height.
  const fill = (items: ReactNode) => <div style={{flex:'1 1 0',minHeight:0,minWidth:0,display:'flex',flexDirection:'column'}}>{items}</div>;
  return <div className="records-page lightning-app-page" data-lightning-page={apiName}
    data-standalone-presentation={fullscreen ? 'true' : undefined}
    style={fullscreen ? { width:'100%', maxWidth:'none', height:embedded?'100%':'100dvh', minHeight:0,
      padding:0, margin:0, display:'flex', flexDirection:'column', overflow:'hidden',
      background:canvasFillColor??'#f7f7f7' } : {backgroundColor:canvasFillColor??'#ffffff'}}>
    {!fullscreen && pageType !== 'App Page' && <div className="record-detail-heading surface">
      <div className="record-object-icon"><Grid2X2 size={18}/></div>
      <div><div className="eyebrow">{pageType}</div><h1>{label}</h1></div>
    </div>}
    {!rail && header}
    <div className={hasSidebar ? 'record-runtime-layout has-sidebar' : 'record-runtime-layout'}
      style={rail ? {flex:1,minHeight:0,minWidth:0,display:'grid',gridTemplateColumns:phone?'132px minmax(0,1fr)':'224px minmax(0,1fr)',gridTemplateRows:'minmax(0,1fr) 84px',alignItems:'stretch',alignContent:'stretch',gap:0,width:'100%',margin:0,padding:0,overflow:'hidden'} : fullscreen ? {flex:1,minHeight:0,minWidth:0,display:'grid',
        gridTemplateColumns:hasSidebar && !phone ? 'minmax(0,1fr) minmax(300px,30%)' : 'minmax(0,1fr)',
        gap:0,margin:0,padding:0,width:'100%',overflow:'hidden'} : undefined}>
      {rail && <aside style={{gridColumn:1,gridRow:1,minHeight:0,display:'flex',flexDirection:'column',overflowY:'auto',background:'#fff',borderRight:'1px solid #eee'}} >{fill(header)}</aside>}
      <main className="record-runtime-main"
        style={rail ? {gridColumn:2,gridRow:1,minWidth:0,minHeight:0,display:'flex',flexDirection:'column',gap:0,overflowY:'auto',padding:phone?10:24,boxSizing:'border-box',background:canvasFillColor??'#f8f8f8'} : fullscreen ? {minWidth:0,minHeight:0,overflowY:'auto',padding:phone?12:20,
          boxSizing:'border-box',background:canvasFillColor??'#f7f7f7'} : {backgroundColor:canvasFillColor??'#ffffff'}} >{rail?fill(main):main}</main>
      {hasSidebar && <aside className="record-runtime-sidebar"
        style={rail ? {gridColumn:'1 / -1',gridRow:overlayOpen?'1 / -1':2,minWidth:0,minHeight:0,display:'flex',flexDirection:'column',gap:0,overflow:'hidden',padding:0,background:overlayOpen?'transparent':'#fff',borderTop:overlayOpen?'none':'1px solid #e9e9e9',zIndex:overlayOpen?20:1} : fullscreen ? {minWidth:0,minHeight:0,overflowY:'auto',padding:0,
          borderLeft:phone?'none':'1px solid #e8e8e8',background:'#fff'} : undefined} >{rail?fill(sidebar):sidebar}</aside>}
    </div>
  </div>;
}
