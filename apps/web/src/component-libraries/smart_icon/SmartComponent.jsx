import icons from "./iconCatalog.json";
import {SmartShapeGlyph,smartShapes} from "./SmartShapes";
import {hiddenByShowWhen} from "../shared/showWhen.js";
import {smartIconPaint} from "./iconPaint.js";
const fallbackIcon=icons.find(icon=>icon.id==="house");
export default function SmartComponent(p){
 if(hiddenByShowWhen(p))return <span data-smart-hidden="true" hidden/>;
 const selected=icons.find(icon=>icon.id===p.iconId)??smartShapes.find(shape=>shape.id===p.iconId)??fallbackIcon;
 // Style = iOS (new inserts): soft blue glyph and press effect. Older icons stay Classic.
 // iOS is the only Smart style (the Classic/iOS switch was removed).
 const ios=true;
 const radius=Number.isFinite(Number(p.radius))?Math.max(0,Math.min(1000,Number(p.radius))):12;
 const shadow=p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":"none";
 const style={width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",
  boxSizing:"border-box",minWidth:0,minHeight:0,
  backgroundColor:typeof p.backgroundColor==="string"&&p.backgroundColor?p.backgroundColor:"transparent",
  border:p.borderColor?"1px solid "+p.borderColor:"1px solid transparent",
  borderRadius:radius,boxShadow:shadow,overflow:"hidden"};
 const glyphStyle={display:"block",width:"70%",height:"70%",minWidth:0,minHeight:0,
  backgroundColor:typeof p.iconFillColor==="string"&&p.iconFillColor?p.iconFillColor:ios?"#007aff":"#000000",
  // Brand icons (PayPal) keep their own colours until a glyph colour is picked.
  ...smartIconPaint(selected.id,ios?"#007aff":"#000000",typeof p.iconFillColor==="string"&&p.iconFillColor?p.iconFillColor:"")};
 return <div className={"smart-runtime smart_icon smart-icon-surface"+(ios?" smart-ios":"")} style={style}
   data-builder-preview={p.builderPreview?"true":undefined}
   data-smart-icon={selected.id} role="img" aria-label={selected.label+" icon"}>
   {selected.id.startsWith('shape:')
     ?<span className="smart-icon-glyph" aria-hidden="true" style={{
       width:'70%',height:'70%',display:'flex',alignItems:'center',justifyContent:'center',
       color:typeof p.iconFillColor==='string'&&p.iconFillColor?p.iconFillColor:ios?'#007aff':'#000000'}}>
       <SmartShapeGlyph id={selected.id}/>
     </span>
     :<span className="smart-icon-glyph" aria-hidden="true" style={glyphStyle}/>}
 </div>;
}
