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
