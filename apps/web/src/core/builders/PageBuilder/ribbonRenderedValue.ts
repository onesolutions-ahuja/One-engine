/** What a part looks like on the canvas right now, for a ribbon number box that has no saved
 * value (it would otherwise look blank). Generic for every component and part: the part is
 * found by the same data-design-area name the ribbon group uses ("Footer", "Header
 * Supporting", "Badge"...); "Body" or no area means the component itself. Shown as a grey
 * placeholder only, so nothing is saved until the builder types a value. */
// Every number box of the ribbon asks on every builder render; one answer per frame
// is enough (it is only a grey placeholder) and avoids repeated forced layouts.
const frameCache=new Map<string,number|undefined>();
let clearScheduled=false;
export function renderedPartNumber(componentId:string,area:string,propertyId:string):number|undefined{
 if(typeof document==='undefined'||!componentId)return undefined;
 const key=componentId+'\u0000'+area+'\u0000'+propertyId;
 if(frameCache.has(key))return frameCache.get(key);
 const value=measurePartNumber(componentId,area,propertyId);
 frameCache.set(key,value);
 if(!clearScheduled){
  clearScheduled=true;
  const clear=()=>{frameCache.clear();clearScheduled=false;};
  if(typeof requestAnimationFrame==='function')requestAnimationFrame(clear);else setTimeout(clear,16);
 }
 return value;
}
function measurePartNumber(componentId:string,area:string,propertyId:string):number|undefined{
 const host=Array.from(document.querySelectorAll<HTMLElement>('[data-component-id]'))
  .find(node=>node.dataset.componentId===componentId);
 if(!host)return undefined;
 const part=!area||area==='Body'?host:
  Array.from(host.querySelectorAll<HTMLElement>('[data-design-area]'))
   .find(node=>node.dataset.designArea===area);
 if(!part)return undefined;
 const id=propertyId.toLowerCase();
 let raw:number;
 if(/textsize$|^placeholdersize$/.test(id)){
  // The part's own text, not its box (a footer price is a child of the footer box).
  const text=Array.from(part.querySelectorAll<HTMLElement>('*'))
   .find(node=>Array.from(node.childNodes).some(child=>child.nodeType===3&&child.textContent?.trim()))??part;
  raw=Number.parseFloat(getComputedStyle(text).fontSize);
 }else if(id.includes('radius'))raw=Number.parseFloat(getComputedStyle(part).borderTopLeftRadius);
 else if(/(width)$/.test(id))raw=part.offsetWidth;
 else if(/(height)$/.test(id))raw=part.offsetHeight;
 else return undefined;
 return Number.isFinite(raw)?Math.round(raw):undefined;
}
