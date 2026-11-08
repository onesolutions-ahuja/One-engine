import { pageTemplates } from '../../pageEditorMetadata';
import * as React from 'react';
import { useRef } from 'react';
import { isCanvasLocked } from '../../canvasInteractions';
import { assignTabOnReparent } from '../../pageComponentTree';
import { canNest, reparentComponent } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { canvasBoundPosition } from '../../../../pages/PageRuntime/pageCanvas';
import { type LightningPageTemplate, type PageComponentMetadata } from '../../../../metadata/Definitions/metadata';

import type { usePageEditorState } from '../usePageEditorState';
import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageComponentActions } from '../usePageComponentActions';
import type { TemplateResizeEdge } from '../PageBuilderTypes';

export function usePagePlacement(
  editorState: ReturnType<typeof usePageEditorState>,
  props: PageBuilderProps,
  componentActions: ReturnType<typeof usePageComponentActions>,
) {
  const {
    applyPage, canvasSnap, previewMode, updateComponent, setDragOverId, openBuilderTabs,
    setSelectedId, setSelectedRegion,
  } = editorState;
  const { page, onNotify } = props;
  const { addComponent, addFieldToSection, addField } = componentActions;

  const setPageTemplate = (nextTemplate: LightningPageTemplate) => {
    const definition = pageTemplates.find((item) => item.id === nextTemplate);
    if (!definition) return;
    const availableRegions = new Set(definition.regions);
    applyPage({
      ...page,
      template: nextTemplate,
      components: page.components.map((component) => ({
        ...component,
        region: availableRegions.has(component.region ?? 'main') ? component.region ?? 'main' : 'main'
      }))
    });
  };
  const canvasPositionFromEvent = (event: React.DragEvent<HTMLElement>, width = 320, height = 180) => {
    const canvas = event.currentTarget.closest('.page-stage')?.querySelector<HTMLElement>('.free-canvas-stage');
    if (!canvas) return undefined;
    const bounds = canvas.getBoundingClientRect();
    const scaleX = page.canvasWidth / bounds.width;
    const scaleY = page.canvasHeight / bounds.height;
    const bound = canvasBoundPosition({
      x: (event.clientX - bounds.left) * scaleX,
      y: (event.clientY - bounds.top) * scaleY,
      width, height
    }, { width: page.canvasWidth, height: page.canvasHeight }, canvasSnap);
    return { ...bound, width, height };
  };
  const moveCanvasComponent = (event: React.DragEvent<HTMLElement>, component: PageComponentMetadata) => {
    if (page.layoutMode !== 'free-canvas' || previewMode) return;
    const nextPosition = canvasPositionFromEvent(event, component.position?.width ?? 320, component.position?.height ?? 180);
    if (!nextPosition || !component.position) return;
    updateComponent(component.id, {
      position: {
        ...component.position,
        x: Math.min(nextPosition.x, page.canvasWidth - component.position.width),
        y: Math.min(nextPosition.y, page.canvasHeight - component.position.height)
      }
    });
  };
  const handleDrop = (event: React.DragEvent<HTMLElement>, targetIndex = page.components.length, region: 'header' | 'main' | 'sidebar' = 'main', parentId: string | null = null) => {
    event.preventDefault();
    event.stopPropagation();
    const data = event.dataTransfer.getData('text/plain');
    setDragOverId('');
    if (data.startsWith('component:')) {
      const draggedId = event.dataTransfer.getData('application/x-metadrive-component-id');
      if (!draggedId) {
        addComponent(data.slice('component:'.length), targetIndex, region,
          page.layoutMode === 'free-canvas' ? canvasPositionFromEvent(event) : undefined, parentId);
        return;
      }

      if (!canNest(page.components, draggedId, parentId)) {
        onNotify('Cannot nest a component inside itself or one of its descendants.');
        return;
      }
      if (page.layoutMode === 'free-canvas') {
        const draggedComponent = page.components.find((component) => component.id === draggedId);
        if (!draggedComponent || isCanvasLocked(draggedComponent)) return;
        const reparented = reparentComponent(page.components, draggedId, parentId);
        const position = !parentId ? canvasPositionFromEvent(event,
          draggedComponent.position?.width ?? 320, draggedComponent.position?.height ?? 180) : undefined;
        applyPage({ ...page, components: assignTabOnReparent(reparented.map((item) =>
          item.id === draggedId && position && item.position
            ? { ...item, position: {
                ...item.position,
                x: position.x,
                y: position.y
              } } : item),draggedId,parentId,
          parentId ? openBuilderTabs[parentId] : undefined) });
        setSelectedId(draggedId);
        return;
      }
      const sourceIndex = page.components.findIndex((component) => component.id === draggedId);
      if (sourceIndex < 0) return;
      const components = [...page.components];
      if (isCanvasLocked(components[sourceIndex])) return;
      const [draggedComponent] = components.splice(sourceIndex, 1);
      if (!draggedComponent) return;
      const targetElement = event.currentTarget;
      const isComponentTarget = targetElement.classList.contains('record-component');
      const insertAfterTarget = isComponentTarget
        && event.clientY > targetElement.getBoundingClientRect().top + targetElement.getBoundingClientRect().height / 2;
      const dropIndex = targetIndex + (insertAfterTarget ? 1 : 0);
      const insertionIndex = sourceIndex < dropIndex ? dropIndex - 1 : dropIndex;
      components.splice(Math.max(0, Math.min(insertionIndex, components.length)), 0, { ...draggedComponent, parentId: undefined, region });
      applyPage({ ...page, components: assignTabOnReparent(reparentComponent(components, draggedId, parentId),draggedId,parentId,parentId ? openBuilderTabs[parentId] : undefined) });
      setSelectedId(draggedId);
    } else if (data.startsWith('field:')) {
      const sectionId = event.currentTarget.getAttribute('data-component-id');
      if (sectionId && page.components.some((component) => component.id === sectionId && component.type === 'Field Section')) {
        addFieldToSection(sectionId, data.slice('field:'.length));
      } else {
        addField(data.slice('field:'.length));
      }
    }
  };
  // Template components use responsive CSS dimensions rather than absolute canvas coordinates.
  // Pointer moves preview dimensions directly; only the finished size becomes draft metadata.
  const templatePlacementRef = useRef<{ id: string; pointerId: number; mode: 'move' | 'rotate'; node: HTMLElement; startX: number; startY: number; x: number; y: number; rotation: number; nextX: number; nextY: number; nextRotation: number; centreX: number; centreY: number; startAngle: number } | null>(null);
  const templatePlacement = (component: PageComponentMetadata) => {
    const entry = component.properties.templatePlacement;
    const values = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return { x: number(values.x), y: number(values.y), rotation: number(values.rotation) };
  };
  const beginTemplatePlacement = (event: React.PointerEvent<HTMLButtonElement>, component: PageComponentMetadata, mode: 'move' | 'rotate') => {
    if (previewMode || isCanvasLocked(component) || event.button !== 0) return;
    const node = event.currentTarget.closest<HTMLElement>('.record-component');
    if (!node) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = node.getBoundingClientRect();
    const current = templatePlacement(component);
    const centreX = rect.left + rect.width / 2, centreY = rect.top + rect.height / 2;
    templatePlacementRef.current = { id: component.id, pointerId: event.pointerId, mode, node,
      startX: event.clientX, startY: event.clientY, ...current,
      nextX: current.x, nextY: current.y, nextRotation: current.rotation,
      centreX, centreY, startAngle: Math.atan2(event.clientY - centreY, event.clientX - centreX) };
    setSelectedId(component.id); setSelectedRegion(null);
  };
  const previewTemplatePlacement = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = templatePlacementRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (start.mode === 'move') {
      start.nextX = Math.round(start.x + event.clientX - start.startX);
      start.nextY = Math.round(start.y + event.clientY - start.startY);
    } else {
      const angle = Math.atan2(event.clientY - start.centreY, event.clientX - start.centreX);
      start.nextRotation = Math.round(start.rotation + (angle - start.startAngle) * 180 / Math.PI);
      if (event.shiftKey) start.nextRotation = Math.round(start.nextRotation / 15) * 15;
    }
    start.node.style.transform = `translate(${start.nextX}px, ${start.nextY}px) rotate(${start.nextRotation}deg)`;
    start.node.style.transformOrigin = 'center center';
  };
  const finishTemplatePlacement = (event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const start = templatePlacementRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    templatePlacementRef.current = null;
    start.node.style.transform = '';
    start.node.style.transformOrigin = '';
    const component = page.components.find(item => item.id === start.id);
    if (!cancelled && component && (start.x !== start.nextX || start.y !== start.nextY || start.rotation !== start.nextRotation))
      updateComponent(component.id, { properties: { ...component.properties,
        templatePlacement: { x: start.nextX, y: start.nextY, rotation: start.nextRotation } } });
  };
  const templateResizeRef = useRef<{ id: string; pointerId: number; edge: TemplateResizeEdge; width: number; height: number; x: number; y: number; node: HTMLElement; nextWidth: number; nextHeight: number; initialX: number; initialY: number; rotation: number; nextX: number; nextY: number } | null>(null);
  const beginTemplateResize = (event: React.PointerEvent<HTMLButtonElement>, component: PageComponentMetadata, edge: TemplateResizeEdge) => {
    if (previewMode || isCanvasLocked(component) || event.button !== 0) return;
    const node = event.currentTarget.closest<HTMLElement>('.record-component');
    if (!node) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = node.getBoundingClientRect();
    const placement = templatePlacement(component);
    templateResizeRef.current = { id: component.id, pointerId: event.pointerId, edge, width: bounds.width,
      height: bounds.height, x: event.clientX, y: event.clientY, node,
      initialX: placement.x, initialY: placement.y, rotation: placement.rotation,
      nextX: placement.x, nextY: placement.y,
      nextWidth: Math.round(bounds.width), nextHeight: Math.round(bounds.height) };
    setSelectedId(component.id); setSelectedRegion(null);
  };
  const previewTemplateResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = templateResizeRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const region = start.node.closest<HTMLElement>('.page-region');
    const component = page.components.find(item => item.id === start.id);
    const minimumWidth = component?.type === 'Custom:smart_button' ? 32 : 80;
    const maximumWidth = Math.max(minimumWidth, region?.clientWidth ?? start.width);
    const horizontal = start.edge.includes('e') ? 1 : start.edge.includes('w') ? -1 : 0;
    const vertical = start.edge.includes('s') ? 1 : start.edge.includes('n') ? -1 : 0;
    start.nextWidth = Math.round(Math.max(minimumWidth, Math.min(maximumWidth, start.width + horizontal * (event.clientX - start.x))));
    start.nextHeight = Math.round(Math.max(40, start.height + vertical * (event.clientY - start.y)));
    // Keep the opposite edge stationary when resizing from north or west.
    // Use the existing published transform contract instead of a new geometry store.
    start.nextX = start.initialX + (horizontal < 0 ? Math.round(start.width) - start.nextWidth : 0);
    start.nextY = start.initialY + (vertical < 0 ? Math.round(start.height) - start.nextHeight : 0);
    if (horizontal) start.node.style.width = start.nextWidth + 'px';
    if (vertical) start.node.style.height = start.nextHeight + 'px';
    start.node.style.transform = `translate(${start.nextX}px, ${start.nextY}px) rotate(${start.rotation}deg)`;
    start.node.style.transformOrigin = 'center center';
  };
  const finishTemplateResize = (event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const start = templateResizeRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    templateResizeRef.current = null;
    start.node.style.width = '';
    start.node.style.height = '';
    start.node.style.transform = '';
    start.node.style.transformOrigin = '';
    const component = page.components.find(item => item.id === start.id);
    if (!cancelled && component && (start.nextWidth !== Math.round(start.width) || start.nextHeight !== Math.round(start.height))) {
      updateComponent(component.id, { properties: { ...component.properties,
        templatePlacement: { x: start.nextX, y: start.nextY, rotation: start.rotation },
        visualStyle: {
          ...(typeof component.properties.visualStyle === 'object' && component.properties.visualStyle ? component.properties.visualStyle : {}),
          ...(start.edge.includes('e') || start.edge.includes('w') ? { width: start.nextWidth + 'px' } : {}),
          ...(start.edge.includes('n') || start.edge.includes('s') ? { height: start.nextHeight + 'px' } : {})
        } } });
    }
  };

  return {
    setPageTemplate, handleDrop, beginTemplatePlacement, previewTemplatePlacement,
    finishTemplatePlacement, beginTemplateResize, previewTemplateResize, finishTemplateResize,
  };
}
