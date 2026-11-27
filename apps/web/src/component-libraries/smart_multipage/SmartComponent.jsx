import {activePage,shownPages,tabBarLook} from "./multiPageModel.js";
import {smartIconPaint} from "../smart_icon/iconPaint.js";

/**
 * Smart MultiPage: a card with tabs, like the VBA MultiPage. Each direct child of this
 * component is one page (its own design area; usually a Smart Container). The page key
 * is the child's "Page key" property or, when blank, its name.
 *  - Visible tabs: formula giving the page keys to show, e.g. =@ThisPage.Mode1&","&@ThisPage.Mode2.
 *    Blank shows every page. A new package just adds a page; nothing else changes.
 *  - Active tab: formula giving the open page; a tapped tab wins until that formula changes.
 *  - Show tab bar off: pages switch only by formula.
 *  - Tab alignment / size / shape: Segmented is a compact macOS-style control (centred by
 *    default); Stretch keeps the old full-width bar.
 *  - Change event: runs with the tapped page key, e.g. =STATE(payTab, @Value).
 *  - Tab icons: each page's "Tab icon" (pageIcon); Tab icon colour / Selected tab icon colour
 *    on the MultiPage (blank: grey, and blue on the open tab).
 *  - SCREEN(page, MultiPage, n) opens tab n (the tab's id: data-page-requested on that page).
 *  - Designer: click a tab to open and edit it, double-click to rename; tabs are added from the
 *    MultiPage bar under the canvas (the Page Builder handles these through data-multipage-*).
 */
export default function SmartComponent(p){
 const pages=React.Children.toArray(p.children)
  .filter(child=>child&&child.props&&child.props["data-page-key"]!=null)
  .map(child=>({key:String(child.props["data-page-key"]),label:String(child.props["data-page-label"]??child.props["data-page-key"]),
   icon:child.props["data-page-icon"]?String(child.props["data-page-icon"]):"",
   selected:child.props["data-page-selected"]==="true",
   requested:child.props["data-page-requested"]?String(child.props["data-page-requested"]):"",node:child}));
 const builder=p.builderPreview===true;
 const shown=shownPages(pages,p.multiPageVisible,builder);
 const formulaActive=String(p.multiPageActive??"").trim();
 const [picked,setPicked]=React.useState(null);
 // A new Active tab value (e.g. the other split row tapped) takes over from a tapped tab.
 React.useEffect(()=>setPicked(null),[formulaActive]);
 // SCREEN(page, MultiPage, n) opens that tab; a later tap or a newer SCREEN wins.
 const requested=pages.find(page=>page.requested);
 const requestKey=requested?requested.requested+":"+requested.key:"";
 React.useEffect(()=>{if(requested&&!builder)setPicked(requested.key);},[requestKey]);
 const selected=builder?shown.find(page=>page.selected)?.key:undefined;
 const open=activePage(shown,{picked,active:formulaActive,selected});
 const tabBar=p.multiPageTabBar!==false&&p.multiPageTabBar!=="false";
 const style=["Tabs","Pills","Segmented"].includes(p.multiPageTabStyle)?p.multiPageTabStyle:"Segmented";
 const look=tabBarLook(p);
 const choose=key=>{
  setPicked(key);
  if(!p.previewOnly&&!builder&&typeof p.onAction==="function")
   void Promise.resolve(p.onAction({event:"change",value:key})).catch(()=>{});
 };
 const radius=Number.isFinite(Number(p.radius))?Number(p.radius):12;
 // Many tabs: the strip scrolls sideways; arrows show only when tabs are hidden that side.
 const strip=React.useRef(null);
 const [more,setMore]=React.useState({left:false,right:false});
 const measure=React.useCallback(()=>{
  const el=strip.current;if(!el)return;
  const next={left:el.scrollLeft>1,right:el.scrollLeft+el.clientWidth<el.scrollWidth-1};
  setMore(old=>old.left===next.left&&old.right===next.right?old:next);
 },[]);
 React.useEffect(()=>{
  const el=strip.current;if(!el)return undefined;
  measure();
  const observer=typeof ResizeObserver==="function"?new ResizeObserver(measure):null;
  observer?.observe(el);
  return ()=>observer?.disconnect();
 },[measure,shown.length,tabBar]);
 // Keep the open tab in view (never scrolls the page itself).
 React.useEffect(()=>{
  const el=strip.current;const tab=el?.querySelector("button.active");
  if(!el||!tab)return;
  if(tab.offsetLeft<el.scrollLeft)el.scrollLeft=tab.offsetLeft;
  else if(tab.offsetLeft+tab.offsetWidth>el.scrollLeft+el.clientWidth)el.scrollLeft=tab.offsetLeft+tab.offsetWidth-el.clientWidth;
  measure();
 },[open?.key,measure]);
 const scrollTabs=dir=>{const el=strip.current;if(el)el.scrollBy({left:dir*Math.max(120,el.clientWidth*.7),behavior:"smooth"});};
 return <div className={"smart-multipage is-"+style.toLowerCase()+" align-"+look.align+" size-"+look.size+" shape-"+look.shape}
  data-builder-preview={builder?"true":undefined}
  style={{background:p.backgroundColor||undefined,borderRadius:radius,
   border:p.borderColor?"1px solid "+p.borderColor:undefined}}>
  {tabBar&&(shown.length>0||builder)&&<div className="smart-multipage-tabbar">
   {more.left&&<button type="button" className="smart-multipage-scroll is-left" aria-label="Show earlier tabs"
    data-multipage-scroll="-1" onClick={()=>scrollTabs(-1)}>‹</button>}
   <div className="smart-multipage-tabs" role="tablist" aria-label={p.label||"Pages"} ref={strip} onScroll={measure}>
    {shown.map(page=><button type="button" role="tab" key={page.key} aria-selected={open?.key===page.key}
     data-multipage-tab={page.key} title={builder?"Click to open this tab; double-click to rename":undefined}
     className={open?.key===page.key?"active":""} onClick={()=>choose(page.key)}>
     {page.icon&&<span className="smart-multipage-tab-icon" aria-hidden="true"
      style={smartIconPaint(page.icon,open?.key===page.key?(p.multiPageSelectedIconColor||"#007aff"):(p.multiPageIconColor||"#3a3a3c"))}/>}
     <span className="smart-multipage-tab-label">{page.label}</span></button>)}
   </div>
   {more.right&&<button type="button" className="smart-multipage-scroll is-right" aria-label="Show more tabs"
    data-multipage-scroll="1" onClick={()=>scrollTabs(1)}>›</button>}
  </div>}
  <div className="smart-multipage-page" role="tabpanel">
   {open?open.node:<span className="smart-multipage-empty">{String(p.multiPageEmptyText??"")||
    (builder?"Add a tab from the MultiPage bar below":"")}</span>}
  </div>
 </div>;
}
