import {useEffect,useState} from 'react';
import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';

/**
 * Page layers: one page (one API name) holds several screens, like the slides of a deck.
 * Every component sits on a numbered layer (property `pageLayer`, none = 0), and each
 * layer is its own blank canvas: exactly one layer shows at a time, never stacked on
 * another. The page opens on layer 0 unless asked for another, e.g. SCREEN(page, 3), the
 * address ?layer=3, or SCREEN(page, 3) run on the page that is already open.
 * A nested component sits on its parent's layer.
 */
export const MAX_PAGE_LAYER=9;
export const LAYER_EVENT='metadrive:set-page-layer';
type Item=Pick<PageComponentMetadata,'id'|'properties'>&{parentId?:string|null};

export function layerNumber(value:unknown):number|null{
 const number=typeof value==='string'&&value.trim()!==''?Number(value):value;
 return typeof number==='number'&&Number.isInteger(number)&&number>=0&&number<=MAX_PAGE_LAYER?number:null;
}
const parentOf=(item:Item)=>{
 const own=item.properties?.layoutParentId;
 return typeof own==='string'&&own?own:item.parentId||null;
};
/** The layer a component shows on: its own, else its parent's, else 0. */
export function componentLayer(component:Item,components:readonly Item[]):number{
 const byId=new Map(components.map(item=>[item.id,item]));
 const seen=new Set<string>();
 for(let item:Item|undefined=component;item&&!seen.has(item.id);item=byId.get(parentOf(item)??'')){
  seen.add(item.id);
  const own=layerNumber(item.properties?.pageLayer);
  if(own!==null)return own;
 }
 return 0;
}
/** Only the page's current layer shows: layers are separate screens, not overlays. */
export function layerShows(layer:number,current:number):boolean{return layer===current;}
/** The layers a page uses, in order, always with 0. */
export function pageLayerNumbers(components:readonly Item[]):number[]{
 const used=new Set([0]);
 for(const item of components)used.add(componentLayer(item,components));
 return [...used].sort((a,b)=>a-b);
}
/** What a layer tab says besides its number: "Default" for 0, else "Screen". */
export function layerCaption(layer:number):string{return layer===0?'Default':'Screen';}
const PENDING='md.page.layer:';
/** SCREEN(page, n) that opens page here: the page starts on layer n. */
export function rememberRequestedLayer(page:string,layer:number){
 try{window.sessionStorage.setItem(PENDING+page.toLowerCase(),String(layer));}catch{/* private window */}
}
/** The layer a page opens on: ?layer=, else the one SCREEN(page, n) asked for, else 0. */
export function requestedLayer(page=''):number{
 try{
  const key=PENDING+page.toLowerCase();
  const pending=layerNumber(window.sessionStorage.getItem(key));
  if(pending!==null){window.sessionStorage.removeItem(key);return pending;}
  return layerNumber(new URLSearchParams(window.location.search).get('layer'))??0;
 }catch{return 0;}
}
/** Show layer `layer` of `page` if that page is open in this window. True when it was. */
export function showPageLayer(page:string,layer:number):boolean{
 return !window.dispatchEvent(new CustomEvent(LAYER_EVENT,{cancelable:true,detail:{page,layer}}));
}
/** The current layer of a running page: starts at ?layer= and follows showPageLayer. */
export function usePageLayer(pageApiName:string|undefined):number{
 const [layer,setLayer]=useState(0);
 useEffect(()=>{
  if(!pageApiName)return;
  setLayer(requestedLayer(pageApiName));
  const name=pageApiName.toLowerCase();
  const onLayer=(event:Event)=>{
   const detail=(event as CustomEvent<{page:string;layer:number}>).detail;
   if(String(detail?.page??'').toLowerCase()!==name||layerNumber(detail.layer)===null)return;
   event.preventDefault();
   setLayer(detail.layer);
  };
  // A window that opened this one (a till and its customer display) can switch it too.
  const onMessage=(event:MessageEvent)=>{
   if(event.origin!==window.location.origin)return;
   const data=event.data as {type?:string;page?:string;layer?:unknown}|null;
   if(data?.type!==LAYER_EVENT||String(data.page??'').toLowerCase()!==name)return;
   const next=layerNumber(data.layer);
   if(next!==null)setLayer(next);
  };
  window.addEventListener(LAYER_EVENT,onLayer);
  window.addEventListener('message',onMessage);
  return ()=>{window.removeEventListener(LAYER_EVENT,onLayer);window.removeEventListener('message',onMessage);};
 },[pageApiName]);
 return layer;
}
