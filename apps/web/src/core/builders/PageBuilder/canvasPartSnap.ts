/** Drag-and-snap for parts inside a Smart component (badge, image, buttons, text).
 * Pure rules: which part can be dragged, which existing property it writes, and
 * which allowed value the drop point snaps to. No new position data is stored. */

export type PartSnapMode='badge'|'edges'|'sides'|'align';
export type PartSnapRule={property:string;mode:PartSnapMode};
type Box={left:number;top:number;width:number;height:number};

const rule=(property:string,mode:PartSnapMode):PartSnapRule=>({property,mode});

/** Component API → Design area (data-design-area) → property it moves. */
export const PART_SNAP_RULES:Readonly<Record<string,Readonly<Record<string,PartSnapRule>>>>={
 smart_card_grid:{
  Badge:rule('badgeAlignment','badge'),
  Image:rule('imagePlacement','edges'),
  Header:rule('headerAlignment','align'),
  'Header Supporting':rule('supportingAlignment','align'),
  Footer:rule('footerAlignment','align'),
  Button:rule('customButton1Placement','sides'),
  'Button 2':rule('customButton2Placement','sides'),
  'Button 3':rule('cardButtonPlacement','sides')
 },
 smart_image:{
  Badge:rule('badgeAlignment','badge'),
  Image:rule('imagePlacement','edges'),
  // The standalone Image caption reads labelAlignment first.
  Header:rule('labelAlignment','align')
 },
 smart_cart:{
  Image:rule('imagePlacement','sides'),
  Header:rule('headerAlignment','align'),
  Summary:rule('summaryAlignment','align'),
  Footer:rule('footerAlignment','align'),
  Button:rule('customButton1Placement','sides'),
  'Button 2':rule('customButton2Placement','sides'),
  'Button 4':rule('qtyIncreasePlacement','sides'),
  'Button 5':rule('qtyDecreasePlacement','sides')
 },
 smart_textbox:{
  Header:rule('headerAlignment','align')
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
