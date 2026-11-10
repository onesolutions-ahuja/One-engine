/** Left/right side of a button inside a flex row (card footer, cart +/-, cart row actions).
 * A blank value, or the side the renderer has always used, adds no style at all,
 * so existing pages render exactly as before. Moving a button to the other side
 * puts it before (order -1) or after (order 1) the row's other content (order 0). */
export function smartPartSide(value,fallback){
 return value==="left"||value==="right"?value:fallback;
}
export function smartPartOrderStyle(value,fallback){
 const side=smartPartSide(value,fallback);
 return side===fallback?{}:{order:side==="left"?-1:1};
}

/** Free position of a part dragged in the Page Builder: <prefix>OffsetX/Y in px,
 * measured from where the part normally sits. Uses the CSS translate property,
 * so the part's layout, size and any existing transform are unchanged.
 * No offset saved → no style added. */
export function smartPartOffsetStyle(p,prefix){
 const read=key=>{
  const value=Number(p?.[prefix+key]);
  return Number.isFinite(value)?Math.max(-2000,Math.min(2000,Math.round(value))):0;
 };
 const x=read("OffsetX"),y=read("OffsetY");
 return x||y?{translate:x+"px "+y+"px"}:{};
}
