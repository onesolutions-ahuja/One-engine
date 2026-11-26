import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';
import {canvasGroupMembers} from './canvasLayerGroups';

type Component = PageComponentMetadata;
type Rect = {x:number;y:number;width:number;height:number};
type PageSize = {width:number;height:number};
export type CanvasSelectMode = 'replace'|'toggle'|'range'|'member';

const parentOf=(item:Component)=>typeof item.properties.layoutParentId==='string'
  && item.properties.layoutParentId?item.properties.layoutParentId:item.parentId??null;
const unique=(ids:readonly string[])=>[...new Set(ids)];

/** One shared selection rule for canvas clicks and the component navigator. */
export function selectCanvasIds(
  components:readonly Component[],current:readonly string[],id:string,
  mode:CanvasSelectMode='replace',anchorId?:string
):string[]{
  const item=components.find(component=>component.id===id);
  if(!item)return [...current];
  if(mode==='member')return [id];
  if(mode==='range'&&anchorId){
    const anchor=components.find(component=>component.id===anchorId);
    if(anchor&&parentOf(anchor)===parentOf(item)){
      const siblings=components.filter(component=>parentOf(component)===parentOf(item));
      const a=siblings.findIndex(component=>component.id===anchor.id);
      const b=siblings.findIndex(component=>component.id===id);
      const range=siblings.slice(Math.min(a,b),Math.max(a,b)+1)
        .flatMap(component=>canvasGroupMembers(components,component).map(member=>member.id));
      return unique([...current,...range]);
    }
  }
  const members=canvasGroupMembers(components,item).map(member=>member.id);
  if(mode==='toggle'){
    const removing=members.every(memberId=>current.includes(memberId));
    return removing?current.filter(selectedId=>!members.includes(selectedId))
      :unique([...current,...members]);
  }
  return members;
}

/** Hit testing uses page coordinates, not the current browser zoom or stage scale. */
export function marqueeCanvasIds(
  components:readonly Component[],box:Rect,existing:readonly string[]=[]
):string[]{
  const hits=components.filter(item=>item.visible!==false&&item.position
    &&!parentOf(item)&&item.properties.editorLocked!==true
    &&item.position.x<box.x+box.width&&item.position.x+item.position.width>box.x
    &&item.position.y<box.y+box.height&&item.position.y+item.position.height>box.y);
  const expanded=hits.flatMap(item=>canvasGroupMembers(components,item)
    .filter(member=>member.properties.editorLocked!==true).map(member=>member.id));
  return unique([...existing,...expanded]);
}

/** Move all unlocked top-level shapes as one rigid selection, bounded as a unit. */
export function translateCanvasSelection(
  components:readonly Component[],ids:readonly string[],dx:number,dy:number,page:PageSize
):Component[]{
  const selected=new Set(ids);
  // Moves happen at one level: the page, or inside one container (positions count from it).
  const first=components.find(item=>selected.has(item.id)&&item.position);
  const level=first?parentOf(first):null;
  const targets=components.filter(item=>selected.has(item.id)&&item.position
    &&parentOf(item)===level&&item.properties.editorLocked!==true
    );
  if(!targets.length||(!dx&&!dy))return [...components];
  const minX=Math.min(...targets.map(item=>item.position!.x));
  const minY=Math.min(...targets.map(item=>item.position!.y));
  const maxX=Math.max(...targets.map(item=>item.position!.x+item.position!.width));
  const maxY=Math.max(...targets.map(item=>item.position!.y+item.position!.height));
  const shiftX=Math.max(-minX,Math.min(page.width-maxX,dx));
  const shiftY=Math.max(-minY,Math.min(page.height-maxY,dy));
  if(!shiftX&&!shiftY)return [...components];
  const moving=new Set(targets.map(item=>item.id));
  return components.map(item=>moving.has(item.id)
    ? {...item,position:{...item.position!,x:item.position!.x+shiftX,y:item.position!.y+shiftY}}
    :item);
}

/** Area a moved shape may use: its container (or the page), widened to take in where the
 * shape already is. A shape that sits partly outside a smaller container (older inserts used
 * page coordinates) then moves smoothly from where it is instead of jumping on the first move. */
export function reachableMoveArea(
  limits:PageSize,original:{x:number;y:number;width:number;height:number}
):PageSize{
  return {
    width:Math.max(limits.width,original.x+original.width),
    height:Math.max(limits.height,original.y+original.height)
  };
}
