import {activePage,shownPages,tabBarLook} from "./multiPageModel.js";

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
 */
export default function SmartComponent(p){
 const pages=React.Children.toArray(p.children)
  .filter(child=>child&&child.props&&child.props["data-page-key"]!=null)
  .map(child=>({key:String(child.props["data-page-key"]),label:String(child.props["data-page-label"]??child.props["data-page-key"]),
   selected:child.props["data-page-selected"]==="true",node:child}));
 const builder=p.builderPreview===true;
 const shown=shownPages(pages,p.multiPageVisible,builder);
 const formulaActive=String(p.multiPageActive??"").trim();
 const [picked,setPicked]=React.useState(null);
 // A new Active tab value (e.g. the other split row tapped) takes over from a tapped tab.
 React.useEffect(()=>setPicked(null),[formulaActive]);
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
 return <div className={"smart-multipage is-"+style.toLowerCase()+" align-"+look.align+" size-"+look.size+" shape-"+look.shape}
  data-builder-preview={builder?"true":undefined}
  style={{background:p.backgroundColor||undefined,borderRadius:radius,
   border:p.borderColor?"1px solid "+p.borderColor:undefined}}>
  {tabBar&&shown.length>0&&<div className="smart-multipage-tabbar">
   <div className="smart-multipage-tabs" role="tablist" aria-label={p.label||"Pages"}>
    {shown.map(page=><button type="button" role="tab" key={page.key} aria-selected={open?.key===page.key}
     className={open?.key===page.key?"active":""} onClick={()=>choose(page.key)}>{page.label}</button>)}
   </div>
  </div>}
  <div className="smart-multipage-page" role="tabpanel">
   {open?open.node:<span className="smart-multipage-empty">{String(p.multiPageEmptyText??"")||
    (builder?"Drop a Smart Container here for each page":"")}</span>}
  </div>
 </div>;
}
