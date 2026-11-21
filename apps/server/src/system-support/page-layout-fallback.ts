/** A narrow window asks for the Mobile layout; many pages are built for Desktop only.
 * The page request answers the best layout the page does have, in the same request,
 * instead of "Page not found": the nearest wider layout first, Desktop last. */
export function appPageLayoutFallbacks(factor:string):string[]{
  if(factor==='Mobile'||factor==='Phone')return ['Tablet','Desktop'];
  if(factor==='Tablet'||factor==='Custom')return ['Desktop'];
  return [];
}
