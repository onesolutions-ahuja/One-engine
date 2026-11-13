import icons from "../smart_icon/iconCatalog.json";
import {dockItems,dockSettings} from "./dockItems.mjs";

const size=(value,fallback,min=0,max=2000)=>{
 const n=Number(value);
 return Number.isFinite(n)&&value!==""&&value!==null?Math.max(min,Math.min(max,n)):fallback;
};
// "none" keeps the built-in glass shadow; medium/large replace it.
const shadow=value=>value==="large"?"0 8px 20px #0003":value==="medium"?"0 3px 9px #0003":undefined;
const knownIcons=new Set(icons.map(icon=>icon.id));

/** iOS-style dock. Each of up to six items has its own icon, label, badge and
 * its own event (Item 1 … Item 6), so each can Navigate or run a Flow without
 * a formula. Every tap also fires On Click with {item,label} for one shared action. */
export default function SmartDock({p,fire,resolve}){
 // Active item may be a formula, e.g. IF($state.Screen = "Orders", 3, 1).
 const activeSource=p.dockActiveItem;
 const settings=dockSettings({...p,__dockActiveItem:activeSource!==undefined&&activeSource!==""&&activeSource!==null
  ?resolve("dockActiveItem",activeSource):undefined});
 const items=dockItems(p,resolve);
 const [localActive,setLocalActive]=React.useState(null);
 // A formula-driven active item (e.g. from $state) wins over the last tap.
 const active=settings.activeItem??localActive??(items[0]?.index??null);
 const tap=item=>{
  if(p.builderPreview||p.previewOnly)return;
  setLocalActive(item.index);
  const value={item:item.index,label:item.label};
  if(p.actionFlows?.["dockItem"+item.index])fire("dockItem"+item.index,value);
  if(p.actionFlows?.click)fire("click",value);
 };
 const iconSize=size(p.dockIconSize,28,14,96);
 const tile=size(p.numpadKeyHeight,iconSize+16,iconSize,200);
 const accent=p.numpadFocusedTextColor||p.accentColor||"#007aff";
 const vertical=settings.direction==="vertical";
 const body={
  background:p.backgroundColor||undefined,
  border:p.borderColor?"1px solid "+p.borderColor:undefined,
  borderRadius:size(p.radius,22,0,64),boxShadow:shadow(p.shadow),
  flexDirection:vertical?"column":"row",
  gap:size(p.numpadGap,6,0,48),padding:size(p.numpadPadding,8,0,48)
 };
 return <nav className={"smart-dock"+(vertical?" is-vertical":"")+(settings.magnify?" is-magnify":"")
   +(p.backgroundColor?"":" is-glass")} aria-label={settings.label||"Dock"} style={body}>
  {items.map(item=>{
   const isActive=item.index===active;
   const glyph=knownIcons.has(item.icon)?item.icon:null;
   const color=isActive?accent:(p.numpadKeyTextColor||p.labelColor||"#3c3c43");
   return <button key={item.index} type="button" className={"smart-dock-item"+(isActive?" is-active":"")}
    aria-label={item.label||("Item "+item.index)} aria-current={isActive?"page":undefined}
    title={item.label||undefined}
    data-dock-item={item.index}
    data-design-area={p.builderPreview?(isActive?"Focused":"Button"):undefined}
    data-md-bind={p.builderPreview?"dockItem"+item.index+"Label":undefined}
    data-md-bind-titles={p.builderPreview?"Item "+item.index+" label":undefined}
    style={{color,minWidth:tile,
     background:isActive?(p.numpadFocusedFill||undefined):(p.numpadKeyFill||undefined),
     border:p.numpadKeyBorderColor?"1px solid "+p.numpadKeyBorderColor:undefined,
     borderRadius:size(p.numpadKeyRadius,14,0,64),
     fontSize:size(p.numpadKeyTextSize,11,8,32),
     fontWeight:p.numpadKeyBold===true||isActive?600:500}}
    onClick={()=>tap(item)}>
     <span className="smart-dock-icon-wrap" style={{width:iconSize,height:iconSize}}>
      {glyph?<span className="smart-dock-icon" aria-hidden="true" style={{
        backgroundColor:color,
        WebkitMaskImage:"url(/smart-icons/"+glyph+".svg)",maskImage:"url(/smart-icons/"+glyph+".svg)"}}/>
       :<span className="smart-dock-icon-empty" aria-hidden="true">{(item.label||String(item.index)).slice(0,1)}</span>}
      {item.badge&&<span className="smart-dock-badge" aria-label={item.badge+" new"}>{item.badge}</span>}
     </span>
     {settings.showLabels&&item.label&&<span className="smart-dock-label">{item.label}</span>}
     {settings.showIndicator&&<span className="smart-dock-indicator" aria-hidden="true"
       style={{background:isActive?accent:"transparent"}}/>}
   </button>;
  })}
 </nav>;
}
