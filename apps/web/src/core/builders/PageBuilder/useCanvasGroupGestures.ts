import {useRef,type PointerEvent} from 'react';
import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';
import {canvasUnitsFromScreenDelta} from '../../pages/PageRuntime/pageCanvas';
import {scaleCanvasGroup} from './canvasLayerGroups';

type Position=NonNullable<PageComponentMetadata['position']>;
type Edge='n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw';
type Gesture={
  pointerId:number;clientX:number;clientY:number;mode:'move'|'resize';edge:Edge;
  bounds:Position;members:PageComponentMetadata[];
  nodes:Map<string,HTMLElement>;outline:HTMLElement;current:Map<string,Position>;
};
type Options={
  members:PageComponentMetadata[];bounds:Position|null;
  width:number;height:number;scale:number;enabled:boolean;
  onCommit:(positions:Map<string,Position>)=>void;
};

/** Builder-only pointer interactions; published runtime never loads this module. */
export function useCanvasGroupGestures({members,bounds,width,height,scale,enabled,onCommit}:Options){
  const gesture=useRef<Gesture|null>(null);
  const start=(event:PointerEvent<HTMLElement>,mode:'move'|'resize',edge:Edge='se')=>{
    if(!enabled||!bounds||members.length<2||event.button!==0||gesture.current
      ||members.some(item=>item.properties.editorLocked===true))return;
    const stage=event.currentTarget.closest<HTMLElement>('.free-canvas-stage');
    const outline=event.currentTarget.closest<HTMLElement>('.canvas-group-outline');
    if(!stage||!outline)return;
    const nodes=new Map<string,HTMLElement>();
    const candidates=Array.from(stage.querySelectorAll<HTMLElement>('.free-canvas-component[data-component-id]'));
    for(const member of members){
      const node=candidates.find(item=>item.dataset.componentId===member.id);
      if(!node||!member.position)return;
      nodes.set(member.id,node);
    }
    event.preventDefault();event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current={pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,
      mode,edge,bounds:{...bounds},members,nodes,outline,
      current:new Map(members.map(item=>[item.id,{...item.position!}]))};
  };
  const move=(event:PointerEvent<HTMLElement>)=>{
    const active=gesture.current;
    if(!active||active.pointerId!==event.pointerId)return;
    const dx=Math.round(canvasUnitsFromScreenDelta(event.clientX-active.clientX,scale));
    const dy=Math.round(canvasUnitsFromScreenDelta(event.clientY-active.clientY,scale));
    const {x,y,width:w,height:h}=active.bounds;
    const next={...active.bounds};
    if(active.mode==='move'){
      next.x=Math.max(0,Math.min(width-w,x+dx));
      next.y=Math.max(0,Math.min(height-h,y+dy));
    }else{
      const west=active.edge.includes('w'),east=active.edge.includes('e');
      const north=active.edge.includes('n'),south=active.edge.includes('s');
      const minW=Math.min(w,24),minH=Math.min(h,24);
      if(east)next.width=Math.max(minW,Math.min(width-x,w+dx));
      if(south)next.height=Math.max(minH,Math.min(height-y,h+dy));
      if(west){next.x=Math.max(0,Math.min(x+w-minW,x+dx));next.width=x+w-next.x;}
      if(north){next.y=Math.max(0,Math.min(y+h-minH,y+dy));next.height=y+h-next.y;}
    }
    active.current=scaleCanvasGroup(active.members,next);
    for(const [id,position] of active.current){
      const node=active.nodes.get(id);
      if(node)Object.assign(node.style,{left:position.x+'px',top:position.y+'px',
        width:position.width+'px',height:position.height+'px'});
    }
    Object.assign(active.outline.style,{left:next.x+'px',top:next.y+'px',
      width:next.width+'px',height:next.height+'px'});
  };
  const end=(event:PointerEvent<HTMLElement>,cancelled=false)=>{
    const active=gesture.current;
    if(!active||active.pointerId!==event.pointerId)return;
    gesture.current=null;
    for(const member of active.members){
      const node=active.nodes.get(member.id),position=member.position;
      if(node&&position)Object.assign(node.style,{left:position.x+'px',top:position.y+'px',
        width:position.width+'px',height:position.height+'px'});
    }
    if(!cancelled&&[...active.current].some(([id,pos])=>{
      const original=active.members.find(item=>item.id===id)?.position;
      return original&&(pos.x!==original.x||pos.y!==original.y
        ||pos.width!==original.width||pos.height!==original.height);
    }))onCommit(active.current);
  };
  return {start,move,end};
}
