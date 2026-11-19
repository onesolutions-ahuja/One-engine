/** Smart ID Card — the ten metadata-driven fields shown on every repeated card.
 *
 * Field N is configured entirely through shared SQL properties, never per record:
 *  - fieldNLabel  : caption (literal text or formula), blank = no caption
 *  - fieldNSource : value (record field such as @Product.Price, or any formula)
 *  - fieldNTextColor / fieldNTextSize / fieldNBold / fieldNAlignment /
 *    fieldNBackgroundColor / fieldNBorderColor / fieldNWrapText : its Design area
 *  - fieldNOffsetX / fieldNOffsetY : free X/Y position, saved by dragging the
 *    field on the Page Builder canvas (same contract as every Smart part).
 * Because the properties belong to the component, one drag or one style change
 * applies to every repeated card. Pure helpers only: no React, no DOM. */
export const ID_CARD_MAX_FIELDS=10;
export const ID_CARD_DEFAULT_FIELDS=4;

const blank=value=>value===undefined||value===null||value==="";
const clamp=(value,fallback,min,max)=>{
 const number=Number(value);
 return blank(value)||!Number.isFinite(number)?fallback:Math.max(min,Math.min(max,Math.trunc(number)));
};

/** Property keys of field n (1–10). */
export function idCardFieldKeys(n){
 const base="field"+n;
 return {
  source:base+"Source",label:base+"Label",offset:base,area:"Field "+n,
  textColor:base+"TextColor",textSize:base+"TextSize",bold:base+"Bold",
  alignment:base+"Alignment",fill:base+"BackgroundColor",border:base+"BorderColor",
  wrap:base+"WrapText"
 };
}

/** Every per-row formula property (labels and values), for the shared row-formula engine. */
export const ID_CARD_ROW_PROPERTIES=Object.freeze(
 Array.from({length:ID_CARD_MAX_FIELDS},(_,i)=>idCardFieldKeys(i+1))
  .flatMap(keys=>[keys.label,keys.source]));

/** How many field slots the card shows (0–10). Blank keeps the default of 4. */
export function idCardFieldCount(p){
 return clamp(p?.idCardFieldCount,ID_CARD_DEFAULT_FIELDS,0,ID_CARD_MAX_FIELDS);
}

/** Field columns inside the card body (1–3). */
export function idCardFieldColumns(p){
 return clamp(p?.idCardFieldColumns,1,1,3);
}

/** "inline" = caption and value on one line; "stacked" = caption above value. */
export function idCardFieldLayout(p){
 return p?.idCardFieldLayout==="stacked"?"stacked":"inline";
}

/** The fields to draw. At runtime a slot with neither caption nor value is
 * skipped; in the Page Builder every slot up to the count stays visible so it
 * can be clicked, bound and dragged. */
export function idCardFieldSlots(p,builder=false){
 const slots=[];
 for(let n=1;n<=idCardFieldCount(p);n++){
  const keys=idCardFieldKeys(n);
  const configured=!blank(p?.[keys.source])||!blank(p?.[keys.label]);
  if(configured||builder)slots.push({n,keys,configured});
 }
 return slots;
}

/** Inline style of field n's value box (its Design area). Unset = inherit. */
export function idCardFieldStyle(p,n){
 const keys=idCardFieldKeys(n);
 const style={};
 if(!blank(p?.[keys.textColor]))style.color=String(p[keys.textColor]);
 if(!blank(p?.[keys.textSize]))style.fontSize=clamp(p[keys.textSize],14,8,96);
 if(typeof p?.[keys.bold]==="boolean")style.fontWeight=p[keys.bold]?700:400;
 if(["left","center","right"].includes(p?.[keys.alignment]))style.textAlign=p[keys.alignment];
 if(!blank(p?.[keys.fill]))style.backgroundColor=String(p[keys.fill]);
 if(!blank(p?.[keys.border]))style.border="1px solid "+String(p[keys.border]);
 if(p?.[keys.wrap]===false){style.whiteSpace="nowrap";style.overflow="hidden";style.textOverflow="ellipsis";}
 return style;
}

/** Caption style shared by all fields (Others: Label colour / Label size). */
export function idCardLabelStyle(p){
 const style={};
 if(!blank(p?.idCardLabelColor))style.color=String(p.idCardLabelColor);
 if(!blank(p?.idCardLabelSize))style.fontSize=clamp(p.idCardLabelSize,12,8,96);
 return style;
}
