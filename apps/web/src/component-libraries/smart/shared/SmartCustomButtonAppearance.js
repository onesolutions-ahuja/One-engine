import {smartShapeAppearance} from './SmartShapeAppearance.js';
const px=(value,min,max)=>{
 if(value===undefined||value===null||value===''||!Number.isFinite(Number(value)))return undefined;
 return Math.min(max,Math.max(min,Number(value)))+'px';
};
/** Shared appearance for Cart and Card Grid custom actions and Cart quantity buttons;
 * absent values keep CSS defaults. */
export function smartCustomButtonAppearance(properties,key){
 const p=properties||{},style={};
 const fill=p[key+'Fill'],border=p[key+'BorderColor'],shape=p[key+'Shape'];
 const color=p[key+'TextColor'],alignment=p[key+'Alignment'];
 if(fill!==undefined&&fill!==null&&fill!=='')style.backgroundColor=fill;
 if(border!==undefined&&border!==null&&border!=='')style.borderColor=border;
 // Optional per-button radius (Design 2 Button dropdowns); absent keeps the 8px default.
 const radius=p[key+'Radius'];
 const hasRadius=radius!==undefined&&radius!==null&&radius!==''&&Number.isFinite(Number(radius));
 if(shape)Object.assign(style,smartShapeAppearance(shape,hasRadius?Math.max(0,Math.min(600,Number(radius))):8));
 else if(hasRadius)style.borderRadius=Math.max(0,Math.min(600,Number(radius)));
 if(color!==undefined&&color!==null&&color!=='')style.color=color;
 const shadow=p[key+'Shadow'];
 if(shadow!==undefined&&shadow!==null&&shadow!=='')style.boxShadow=
  shadow==='large'?'0 8px 20px #0003':shadow==='medium'?'0 3px 9px #0003':
   shadow==='small'?'0 1px 4px #0002':'none';
 // Bold is optional: absent keeps the button's CSS weight.
 const bold=p[key+'Bold'];
 if(bold===true)style.fontWeight=700;
 else if(bold===false)style.fontWeight=400;
 // Optional wrap: false keeps the label on one line; absent keeps the CSS default.
 const wrap=p[key+'WrapText'];
 if(wrap===false)style.whiteSpace='nowrap';
 else if(wrap===true)style.whiteSpace='pre-line';
 const size=px(p[key+'TextSize'],8,96);
 if(size)style.fontSize=size;
 const width=px(p[key+'Width'],0,1200);
 if(width)style.width=width;
 const height=px(p[key+'Height'],24,1200);
 if(height)style.height=height;
 if(['left','center','right'].includes(alignment)){
  style.display='inline-flex';
  style.alignItems='center';
  style.justifyContent=alignment==='left'?'flex-start':alignment==='right'?'flex-end':'center';
 }
 return style;
}
