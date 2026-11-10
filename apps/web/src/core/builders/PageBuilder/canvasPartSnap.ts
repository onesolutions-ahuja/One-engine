/** Dragging parts inside a Smart component (badge, image, buttons, text).
 * Plain drag moves the part freely: its X/Y offset (px, from where the part
 * normally sits) is saved as <offset>OffsetX / <offset>OffsetY. Shift+drag
 * snaps it to the nearest place its dropdown offers and clears the offset.
 * Pure rules and maths only; no DOM. */

export type PartSnapMode='badge'|'edges'|'sides'|'align';
export type PartSnapRule={property:string;mode:PartSnapMode;offset:string};
type Box={left:number;top:number;width:number;height:number};

const rule=(property:string,mode:PartSnapMode,offset:string):PartSnapRule=>({property,mode,offset});

/** Component API → Design area (data-design-area) → property it moves. */
export const PART_SNAP_RULES:Readonly<Record<string,Readonly<Record<string,PartSnapRule>>>>={
 smart_card_grid:{
  Badge:rule('badgeAlignment','badge','badge'),
  Image:rule('imagePlacement','edges','image'),
  Header:rule('headerAlignment','align','header'),
  'Header Supporting':rule('supportingAlignment','align','supporting'),
  Footer:rule('footerAlignment','align','footer'),
  Button:rule('customButton1Placement','sides','customButton1'),
  'Button 2':rule('customButton2Placement','sides','customButton2'),
  'Button 3':rule('cardButtonPlacement','sides','cardButton')
 },
 smart_image:{
  Badge:rule('badgeAlignment','badge','badge'),
  Image:rule('imagePlacement','edges','image'),
  // The standalone Image caption reads labelAlignment first.
  Header:rule('labelAlignment','align','header')
 },
 smart_cart:{
  Image:rule('imagePlacement','sides','image'),
  Header:rule('headerAlignment','align','header'),
  Summary:rule('summaryAlignment','align','summary'),
  Footer:rule('footerAlignment','align','footer'),
  Button:rule('customButton1Placement','sides','customButton1'),
  'Button 2':rule('customButton2Placement','sides','customButton2'),
  'Button 4':rule('qtyIncreasePlacement','sides','qtyIncrease'),
  'Button 5':rule('qtyDecreasePlacement','sides','qtyDecrease')
 },
 smart_textbox:{
  Header:rule('headerAlignment','align','header')
 }
};

export function partSnapRule(componentType:string,area:string|undefined|null):PartSnapRule|undefined{
 if(!area)return undefined;
 const api=componentType.startsWith('Custom:')?componentType.slice('Custom:'.length):componentType;
 return Object.prototype.hasOwnProperty.call(PART_SNAP_RULES,api)
  &&Object.prototype.hasOwnProperty.call(PART_SNAP_RULES[api],area)?PART_SNAP_RULES[api][area]:undefined;
}

const unit=(value:number)=>Number.isFinite(value)?Math.min(1,Math.max(0,value)):0.5;

/** The allowed value nearest to the drop point inside the box the part moves in. */
export function snapPartValue(mode:PartSnapMode,point:{x:number;y:number},box:Box):string{
 const fx=unit((point.x-box.left)/Math.max(1,box.width));
 const fy=unit((point.y-box.top)/Math.max(1,box.height));
 const column=fx<1/3?'left':fx>2/3?'right':'center';
 if(mode==='align')return column;
 if(mode==='sides')return fx<0.5?'left':'right';
 if(mode==='edges'){
  const distances:[string,number][]=[['left',fx],['right',1-fx],['top',fy],['bottom',1-fy]];
  return distances.reduce((best,next)=>next[1]<best[1]?next:best)[0];
 }
 // Badge: the seven image-* positions the badge dropdown already offers.
 const middle=fy>=1/3&&fy<=2/3;
 if(middle&&column==='center')return 'image-center';
 const row=middle?(fy<0.5?'top':'bottom'):fy<1/3?'top':'bottom';
 return 'image-'+row+'-'+column;
}

/** Readable name of a snapped value, shown next to the part while dragging. */
export function partSnapLabel(value:string):string{
 return value.replace(/^image-/,'').split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join(' ');
}

/** Saved offset keys of a part, e.g. badgeOffsetX / badgeOffsetY. */
export function partOffsetKeys(rule:PartSnapRule):{x:string;y:string}{
 return {x:rule.offset+'OffsetX',y:rule.offset+'OffsetY'};
}

const offsetNumber=(value:unknown)=>{
 const number=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):0;
 return Number.isFinite(number)?Math.max(-2000,Math.min(2000,Math.round(number))):0;
};

/** New offset after a free drag of (dx,dy) page pixels. Ending within 3px of
 * where the part normally sits clears the offset (drag it back to reset). */
export function nextPartOffset(current:{x:unknown;y:unknown},dx:number,dy:number):{x:number;y:number}{
 const x=offsetNumber(offsetNumber(current.x)+dx),y=offsetNumber(offsetNumber(current.y)+dy);
 return Math.abs(x)<=3&&Math.abs(y)<=3?{x:0,y:0}:{x,y};
}

/** Component properties after a drop: offsets of 0 are removed, not stored. */
export function withPartOffset(properties:Readonly<Record<string,unknown>>,rule:PartSnapRule,
 offset:{x:number;y:number}):Record<string,unknown>{
 const keys=partOffsetKeys(rule);
 const next:Record<string,unknown>={...properties};
 if(offset.x)next[keys.x]=offset.x;else delete next[keys.x];
 if(offset.y)next[keys.y]=offset.y;else delete next[keys.y];
 return next;
}
