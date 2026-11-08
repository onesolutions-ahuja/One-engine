import * as React from 'react';
import { isCanvasLocked, snapCanvasPosition } from '../../canvasInteractions';
import { canvasGroupKey, canvasGroupMembers, canvasGroupBounds } from '../../canvasLayerGroups';
import { constrainCanvasRect } from '../../canvasPointerInteractions';
import { marqueeCanvasIds, translateCanvasSelection } from '../../canvasSelectionInteractions';
import { useCanvasGroupGestures } from '../../useCanvasGroupGestures';
import { rawLayoutParentId } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { findRegisteredComponent } from '../../../../components/Registry/componentRegistryLookup';
import { canvasBoundPosition, canvasUnitsFromScreenDelta } from '../../../../pages/PageRuntime/pageCanvas';
import { type PageComponentMetadata } from '../../../../metadata/Definitions/metadata';

import type { usePageEditorState } from '../usePageEditorState';
import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageComponentProperties } from '../inspector/usePageComponentProperties';
import type { ResizeEdge } from '../PageBuilderTypes';

export function useCanvasGestures(
  editorState: ReturnType<typeof usePageEditorState>,
  props: PageBuilderProps,
  componentProperties: ReturnType<typeof usePageComponentProperties>,
) {
  const {
    previewMode, canvasMoveStart, canvasResizeStart, pagePreviewAreaRef, selectionIds, groupEditId,
    setSelectedRegion, setSelectedId, setSelectionIds, setPageSettingsOpen, fitCanvas, fitScale,
    canvasZoom, canvasSnap, canvasGuideXRef, canvasGuideYRef, suppressCanvasClickRef, applyPage,
    marqueeStartRef, marqueeOverlayRef, setGroupEditId,
  } = editorState;
  const { page, libraryComponents } = props;
  const { selectedGroupMembers, selectedGroupBounds } = componentProperties;

  // Move selected shapes as one block; style updates stay off React's hot path.
  const startCanvasMove = (event: React.PointerEvent<HTMLElement>, component: PageComponentMetadata) => {
    if(previewMode||!component.position||isCanvasLocked(component)||event.button!==0
      ||event.shiftKey||event.ctrlKey||event.metaKey||event.altKey||canvasMoveStart.current||canvasResizeStart.current)return;
    const hit=event.target as Element;
    const floating=event.currentTarget.closest<HTMLElement>('.canvas-floating-actions-host');
    const portalGrip=floating?.dataset.canvasActionsFor===component.id
      &&Boolean(hit.closest('.canvas-move-grip'));
    const element=event.currentTarget.closest<HTMLElement>('.free-canvas-component')
      ??(portalGrip?Array.from(pagePreviewAreaRef.current?.querySelectorAll<HTMLElement>(
        '.free-canvas-component[data-component-id]')??[])
        .find(node=>node.dataset.componentId===component.id)??null:null);
    if(!element||(!portalGrip&&hit.closest('[data-component-id]')!==element))return;
    if(!hit.closest('.free-canvas-move-edge,.canvas-move-grip')&&
      hit.closest('input,select,textarea,[contenteditable="true"],.free-canvas-resize-handle,.canvas-element-actions'))return;
    const memberIds=selectionIds.includes(component.id)?selectionIds:
      groupEditId===component.id?[component.id]:
      canvasGroupMembers(page.components,component).map(item=>item.id);
    const moving=page.components.filter(item=>memberIds.includes(item.id)
      &&item.position&&!rawLayoutParentId(item)&&!isCanvasLocked(item));
    if(!moving.length||moving.some(item=>canvasGroupKey(item)&&groupEditId!==item.id
      &&canvasGroupMembers(page.components,item).some(member=>
        !memberIds.includes(member.id)||isCanvasLocked(member))))return;
    const nodes=Array.from(pagePreviewAreaRef.current?.querySelectorAll<HTMLElement>(
      '.free-canvas-stage .free-canvas-component[data-component-id]')??[]);
    const members=moving.map(item=>({
      id:item.id,original:{...item.position!},
      element:nodes.find(node=>node.dataset.componentId===item.id)??(item.id===component.id?element:null)
    }));
    if(members.some(item=>!item.element))return;
    const bounds=canvasGroupBounds(moving)??{...component.position};
    event.preventDefault();event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    canvasMoveStart.current={
      id:component.id,pointerId:event.pointerId,pointerX:event.clientX,pointerY:event.clientY,
      original:{...bounds},element,x:bounds.x,y:bounds.y,
      members:members.map(member=>({...member,element:member.element!}))
    };
    setSelectedRegion(null);setSelectedId(component.id);setSelectionIds(memberIds);
    setPageSettingsOpen(false);
    members.forEach(member=>{if(member.element)member.element.style.willChange='translate';});
  };
  const moveCanvasPointer=(event:React.PointerEvent<HTMLElement>)=>{
    const start=canvasMoveStart.current;
    if(!start||start.pointerId!==event.pointerId)return;
    const scale=fitCanvas?fitScale:canvasZoom/100;
    const x=start.original.x+canvasUnitsFromScreenDelta(event.clientX-start.pointerX,scale);
    const y=start.original.y+canvasUnitsFromScreenDelta(event.clientY-start.pointerY,scale);
    const movingIds=new Set(start.members.map(member=>member.id));
    const bounds={width:page.canvasWidth,height:page.canvasHeight};
    const next=canvasSnap?snapCanvasPosition({...start.original,x,y},bounds,
      page.components.filter(item=>!movingIds.has(item.id)&&!rawLayoutParentId(item)&&item.position)
        .map(item=>item.position!),true):
      {position:canvasBoundPosition({...start.original,x,y},bounds,false),guides:{x:false,y:false}};
    start.x=next.position.x;start.y=next.position.y;
    const dx=start.x-start.original.x,dy=start.y-start.original.y;
    start.members.forEach(member=>{member.element.style.translate=`${dx}px ${dy}px`;});
    if(canvasGuideXRef.current){
      canvasGuideXRef.current.style.display=next.guides.x?'block':'none';
      canvasGuideXRef.current.style.left=`${start.x}px`;
    }
    if(canvasGuideYRef.current){
      canvasGuideYRef.current.style.display=next.guides.y?'block':'none';
      canvasGuideYRef.current.style.top=`${start.y}px`;
    }
  };
  const endCanvasMove=(event:React.PointerEvent<HTMLElement>,cancelled=false)=>{
    const start=canvasMoveStart.current;
    if(!start||start.pointerId!==event.pointerId)return;
    canvasMoveStart.current=null;
    const dx=cancelled?0:start.x-start.original.x;
    const dy=cancelled?0:start.y-start.original.y;
    const changed=dx!==0||dy!==0;
    start.members.forEach(member=>{
      if(changed){
        member.element.style.left=`${member.original.x+dx}px`;
        member.element.style.top=`${member.original.y+dy}px`;
      }
      member.element.style.translate='';member.element.style.willChange='';
    });
    if(canvasGuideXRef.current)canvasGuideXRef.current.style.display='none';
    if(canvasGuideYRef.current)canvasGuideYRef.current.style.display='none';
    if(changed){
      suppressCanvasClickRef.current=true;
      window.requestAnimationFrame(()=>{suppressCanvasClickRef.current=false;});
      const next=translateCanvasSelection(page.components,start.members.map(item=>item.id),dx,dy,
        {width:page.canvasWidth,height:page.canvasHeight});
      applyPage({...page,components:next});
    }
  };
  // Empty-stage marquee: the transient box is DOM-only and never enters page metadata.
  const marqueePoint=(event:React.PointerEvent<HTMLDivElement>)=>{
    const bounds=event.currentTarget.getBoundingClientRect();
    return {
      x:Math.max(0,Math.min(page.canvasWidth,
        (event.clientX-bounds.left)*page.canvasWidth/Math.max(1,bounds.width))),
      y:Math.max(0,Math.min(page.canvasHeight,
        (event.clientY-bounds.top)*page.canvasHeight/Math.max(1,bounds.height)))
    };
  };
  const startCanvasMarquee=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(previewMode||event.button!==0||event.target!==event.currentTarget
      ||canvasMoveStart.current||canvasResizeStart.current)return;
    const point=marqueePoint(event);
    marqueeStartRef.current={pointerId:event.pointerId,x:point.x,y:point.y,
      clientX:event.clientX,clientY:event.clientY,
      additive:event.ctrlKey||event.metaKey||event.shiftKey,moved:false};
    event.currentTarget.setPointerCapture(event.pointerId);
    if(marqueeOverlayRef.current){
      Object.assign(marqueeOverlayRef.current.style,{
        display:'none',left:point.x+'px',top:point.y+'px',width:'0px',height:'0px'
      });
    }
  };
  const moveCanvasMarquee=(event:React.PointerEvent<HTMLDivElement>)=>{
    const start=marqueeStartRef.current;
    if(!start||start.pointerId!==event.pointerId)return;
    if(Math.hypot(event.clientX-start.clientX,event.clientY-start.clientY)>4)start.moved=true;
    if(!start.moved||!marqueeOverlayRef.current)return;
    const point=marqueePoint(event);
    Object.assign(marqueeOverlayRef.current.style,{
      display:'block',left:Math.min(point.x,start.x)+'px',top:Math.min(point.y,start.y)+'px',
      width:Math.abs(point.x-start.x)+'px',height:Math.abs(point.y-start.y)+'px'
    });
  };
  const endCanvasMarquee=(event:React.PointerEvent<HTMLDivElement>,cancelled=false)=>{
    const start=marqueeStartRef.current;
    if(!start||start.pointerId!==event.pointerId)return;
    marqueeStartRef.current=null;
    if(marqueeOverlayRef.current)marqueeOverlayRef.current.style.display='none';
    if(cancelled||!start.moved)return;
    const point=marqueePoint(event);
    const box={x:Math.min(point.x,start.x),y:Math.min(point.y,start.y),
      width:Math.abs(point.x-start.x),height:Math.abs(point.y-start.y)};
    const next=marqueeCanvasIds(page.components,box,start.additive?selectionIds:[]);
    setSelectionIds(next);setSelectedId(next[next.length-1]??'');
    setGroupEditId('');setSelectedRegion(null);setPageSettingsOpen(false);
    suppressCanvasClickRef.current=true;
    window.requestAnimationFrame(()=>{suppressCanvasClickRef.current=false;});
  };
  const reorderLayer = (id: string, direction: -1 | 1) => {
    const items = [...page.components];
    const index = items.findIndex(item => item.id === id);
    if (index < 0) return;
    const parent = rawLayoutParentId(items[index]);
    const siblings = items.map((item, position) => rawLayoutParentId(item) === parent ? position : -1).filter(position => position >= 0);
    const indexAmongSiblings = siblings.indexOf(index);
    const target = siblings[indexAmongSiblings + direction];
    if (target === undefined) return;
    [items[index], items[target]] = [items[target], items[index]];
    applyPage({ ...page, components: items });
  };
  const {start:startCanvasGroupGesture,move:moveCanvasGroupGesture,end:endCanvasGroupGesture}
    = useCanvasGroupGestures({
      members:selectedGroupMembers,bounds:selectedGroupBounds,width:page.canvasWidth,height:page.canvasHeight,
      scale:fitCanvas?fitScale:1,enabled:!previewMode,
      onCommit:positions=>applyPage({...page,components:page.components.map(item=>{
        const position=positions.get(item.id);
        return position?{...item,position}:item;
      })})
    });
  const startCanvasResize = (event: React.PointerEvent<HTMLButtonElement>, component: PageComponentMetadata, edge: ResizeEdge) => {
    if (!component.position || isCanvasLocked(component) || event.button !== 0
      || canvasMoveStart.current || canvasResizeStart.current) return;
    const overlay=event.currentTarget.closest<HTMLElement>('.canvas-floating-resize-overlay');
    const element=event.currentTarget.closest<HTMLElement>('.free-canvas-component')
      ?? (overlay?.dataset.canvasResizeFor===component.id
        ?Array.from(pagePreviewAreaRef.current?.querySelectorAll<HTMLElement>(
          '.free-canvas-component[data-component-id]')??[])
          .find(candidate=>candidate.dataset.componentId===component.id)??null:null);
    if (!element) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const viewport=pagePreviewAreaRef.current;
    canvasResizeStart.current = { id: component.id, pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY,
      x: component.position.x, y: component.position.y, width: component.position.width, height: component.position.height, edge,
      element, current: { ...component.position }, viewport,
      scrollStart:viewport?.scrollTop??0,lastX:event.clientX,lastY:event.clientY,
      dragged:false,autoScrollFrame:0 };
    setSelectedId(component.id);
    setSelectionIds([component.id]);
    setSelectedRegion(null);
  };
  // Drive resize from the pointer AND the editor scroll displacement.
  // An offscreen bottom can be gripped from inside the viewport; auto-scroll
  // extends the usable canvas instead of leaving the bottom handle inaccessible.
  const updateCanvasResizePreview = (start: NonNullable<typeof canvasResizeStart.current>, pointerX:number, pointerY:number) => {
    const component = page.components.find(item => item.id === start.id);
    if (!component?.position) return;
    const definition = component.type.startsWith('Custom:') ? findRegisteredComponent(libraryComponents, component.type.slice('Custom:'.length), 'page') : undefined;
    const minWidth = Math.min(start.width, component.type === 'Custom:smart_button' ? 32 : (definition?.resize?.minWidth ?? 20));
    const minHeight = Math.min(start.height, definition?.resize?.minHeight ?? 20);
    const scale=fitCanvas ? fitScale : canvasZoom/100;
    const dx = canvasUnitsFromScreenDelta(pointerX - start.pointerX, scale);
    const scrollDelta=start.viewport ? start.viewport.scrollTop-start.scrollStart : 0;
    const dy = canvasUnitsFromScreenDelta(pointerY - start.pointerY + scrollDelta, scale);
    const west = start.edge.includes('w'), east = start.edge.includes('e'), north = start.edge.includes('n'), south = start.edge.includes('s');
    let x = start.x, y = start.y, width = start.width, height = start.height;
    if (east) width = Math.max(Math.min(minWidth,page.canvasWidth-start.x), Math.min(page.canvasWidth - start.x, start.width + dx));
    if (south) height = Math.max(Math.min(minHeight,page.canvasHeight-start.y), Math.min(page.canvasHeight - start.y, start.height + dy));
    if (west) { x = Math.max(0, Math.min(start.x + start.width - minWidth, start.x + dx)); width = start.width + start.x - x; }
    if (north) { y = Math.max(0, Math.min(start.y + start.height - minHeight, start.y + dy)); height = start.height + start.y - y; }
    start.current = { x, y, width, height };
    Object.assign(start.element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  };
  const autoScrollCanvasResize = () => {
    const start=canvasResizeStart.current;
    if(!start || !start.viewport || !start.dragged || !start.edge.includes('s'))return;
    const view=start.viewport.getBoundingClientRect();
    const distance=view.bottom-start.lastY;
    if(start.lastY<view.top || distance>52 || start.lastX<view.left || start.lastX>view.right){
      start.autoScrollFrame=0;return;
    }
    const step=Math.min(22,Math.max(2,Math.round((52-distance)/3)));
    const before=start.viewport.scrollTop;
    start.viewport.scrollTop+=step;
    if(start.viewport.scrollTop!==before)
      updateCanvasResizePreview(start,start.lastX,start.lastY);
    if(start.viewport.scrollTop===before){start.autoScrollFrame=0;return;}
    start.autoScrollFrame=window.requestAnimationFrame(autoScrollCanvasResize);
  };
  const moveCanvasResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = canvasResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    start.lastX=event.clientX;start.lastY=event.clientY;
    if(Math.abs(start.lastX-start.pointerX)+Math.abs(start.lastY-start.pointerY)>2)start.dragged=true;
    updateCanvasResizePreview(start,event.clientX,event.clientY);
    if(start.dragged && !start.autoScrollFrame && start.edge.includes('s'))
      start.autoScrollFrame=window.requestAnimationFrame(autoScrollCanvasResize);
  };
  const endCanvasResize = (event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const start = canvasResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    canvasResizeStart.current = null;
    if(start.autoScrollFrame)window.cancelAnimationFrame(start.autoScrollFrame);
    const size = start.current;
    const changed = !cancelled && (size.x !== start.x || size.y !== start.y || size.width !== start.width || size.height !== start.height);
    if (changed) {
      // Commit integer dimensions without flashing the original box on release.
      const position = constrainCanvasRect(size,{width:page.canvasWidth,height:page.canvasHeight});
      Object.assign(start.element.style, { left: `${position.x}px`, top: `${position.y}px`,
        width: `${position.width}px`, height: `${position.height}px` });
      applyPage({...page,
        components:page.components.map(item=>item.id===start.id?{...item,position}:item)});
    } else {
      Object.assign(start.element.style, { left: `${start.x}px`, top: `${start.y}px`,
        width: `${start.width}px`, height: `${start.height}px` });
    }
  };

  return {
    startCanvasMove, moveCanvasPointer, endCanvasMove, startCanvasMarquee, moveCanvasMarquee,
    endCanvasMarquee, startCanvasGroupGesture, moveCanvasGroupGesture, endCanvasGroupGesture,
    startCanvasResize, moveCanvasResize, endCanvasResize,
  };
}
