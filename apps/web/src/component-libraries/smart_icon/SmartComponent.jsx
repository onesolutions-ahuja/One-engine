import icons from "./iconCatalog.json";
import {SmartShapeGlyph,smartShapes} from "./SmartShapes";
const fallbackIcon=icons.find(icon=>icon.id==="house");
export default function SmartComponent(p){
 const selected=icons.find(icon=>icon.id===p.iconId)??smartShapes.find(shape=>shape.id===p.iconId)??fallbackIcon;
 const url="/smart-icons/"+selected.id+".svg";
 const radius=Number.isFinite(Number(p.radius))?Math.max(0,Math.min(1000,Number(p.radius))):12;
 const shadow=p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":"none";
 const style={width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",
  boxSizing:"border-box",minWidth:0,minHeight:0,
  backgroundColor:typeof p.backgroundColor==="string"&&p.backgroundColor?p.backgroundColor:"transparent",
  border:p.borderColor?"1px solid "+p.borderColor:"1px solid transparent",
  borderRadius:radius,boxShadow:shadow,overflow:"hidden"};
 const glyphStyle={display:"block",width:"70%",height:"70%",minWidth:0,minHeight:0,
  backgroundColor:typeof p.iconFillColor==="string"&&p.iconFillColor?p.iconFillColor:"#000000",
  WebkitMaskImage:"url("+url+")",maskImage:"url("+url+")",
  WebkitMaskSize:"contain",maskSize:"contain",WebkitMaskRepeat:"no-repeat",maskRepeat:"no-repeat",
  WebkitMaskPosition:"center",maskPosition:"center"};
 return <div className="smart-runtime smart_icon smart-icon-surface" style={style}
   data-smart-icon={selected.id} role="img" aria-label={selected.label+" icon"}>
   {selected.id.startsWith('shape:')
     ?<span className="smart-icon-glyph" aria-hidden="true" style={{
       width:'70%',height:'70%',display:'flex',alignItems:'center',justifyContent:'center',
       color:typeof p.iconFillColor==='string'&&p.iconFillColor?p.iconFillColor:'#000000'}}>
       <SmartShapeGlyph id={selected.id}/>
     </span>
     :<span className="smart-icon-glyph" aria-hidden="true" style={glyphStyle}/>}
 </div>;
}
