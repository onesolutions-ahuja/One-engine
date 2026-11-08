import { layoutFlowGraph } from '../../flowGraphLayout';
import { canBypassFlowElement, duplicateFlowGraphElement, flowGraphDiagnostics } from '../../flowGraphOperations.mjs';
import { storedFlowPosition } from '../../flowCanvasLayout.mjs';
import { useMemo, useEffect } from 'react';
import { type FlowDefinitionMetadata } from '../../../../metadata/Definitions/metadata';

import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowEditorState } from '../useFlowEditorState';

export function useFlowGraphActions(
  props: FlowBuilderProps,
  editorState: ReturnType<typeof useFlowEditorState>,
) {
  const {
    flow, selectedId, onSelect, onToolTab, onNotify, onFlowChange, onAdd, objects, platformEvents,
    landing, onSave, canRedo, onRedo, canUndo, onUndo, onRemove,
  } = props;
  const {
    activeGraphPath, setInsertionConnectorId, setActiveGraphPath, selected, insertionConnectorId,
    setDropActive, isElementAvailable, flowElementMetadata, dragPreview, setDragPreview, dragRef,
    canvasRef, setZoom,
  } = editorState;

  const insertionPaths = flow.connectors.filter((connector) => connector.from === selectedId);
  const graphProblems = useMemo(() => flowGraphDiagnostics(flow), [flow]);
  const selectedConnector=flow.connectors.find(connector=>connector.id===activeGraphPath);
  const selectGraphPath=(connector:FlowDefinitionMetadata['connectors'][number])=>{
    onSelect(connector.from);
    setInsertionConnectorId(connector.id);
    setActiveGraphPath(connector.id);
    onToolTab('Elements');
  };
  const duplicateSelected=()=>{
    if(!selected||selected.type==='Start'||selected.type==='End')return;
    const branch=flow.connectors.filter(connector=>connector.from===selected.id);
    const connectorId=branch.find(connector=>connector.id===insertionConnectorId)?.id;
    try{
      if(branch.length>1&&!connectorId){
        onToolTab('Elements');
        onNotify('Select a connector path before duplicating a branching element.');
        return;
      }
      const nextId=Math.max(0,...flow.elements.map(element=>element.id))+1;
      const next=duplicateFlowGraphElement(flow,selected.id,connectorId,nextId,
        'connector-'+crypto.randomUUID());
      onFlowChange(next);
      onSelect(nextId);
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to duplicate element');}
  };
  const dropElement=(event:React.DragEvent,fromId:number,connectorId?:string)=>{
    event.preventDefault();event.stopPropagation();setDropActive(false);
    const type=event.dataTransfer.getData('application/x-metadrive-flow-type');
    if(!type||!isElementAvailable(type)||!flowElementMetadata.some(item=>item.type===type)){
      onNotify('Select an available Flow element from the toolbox.');return;
    }
    const outgoing=flow.connectors.filter(edge=>edge.from===fromId);
    if(outgoing.length>1&&!connectorId){
      onSelect(fromId);onToolTab('Elements');
      onNotify('Select the specific outcome, fault or scheduled path first.');return;
    }
    onAdd(type,fromId,connectorId);
  };

  const selectedObject = objects.find((object) => object.apiName === flow.triggerObject);
  const selectedPlatformEvent = platformEvents.find((event) => event.apiName === flow.triggerObject);
  const toolboxGroups = [...new Set(flowElementMetadata.map((item) => item.group))];
  const freeformLayout = flow.startConfig?.canvasLayoutMode === 'Freeform';
  const { graphNodeWidth, graphPadding, graphWidth, graphHeight, graphPositions, autoGraphPositions } = useMemo(
    () => layoutFlowGraph(flow, freeformLayout, dragPreview), [flow, freeformLayout, dragPreview]
  );
  const setCanvasPosition = (id: number, position: { x: number; y: number }) => {
    onFlowChange({
      ...flow,
      elements: flow.elements.map((element) => element.id === id
        ? { ...element, config: { ...element.config, canvasPosition: position } }
        : element)
    });
  };
  const switchCanvasMode = () => {
    setDragPreview(null);
    dragRef.current = null;
    onFlowChange({
      ...flow,
      startConfig: { ...flow.startConfig, canvasLayoutMode: freeformLayout ? 'Automatic' : 'Freeform' },
      elements: freeformLayout ? flow.elements : flow.elements.map((element) => ({
        ...element,
        config: {
          ...element.config,
          canvasPosition: storedFlowPosition(element,
            autoGraphPositions.get(element.id) ?? { x: graphPadding, y: graphPadding })
        }
      }))
    });
  };
  const resetFreeformLayout = () => onFlowChange({
    ...flow,
    elements: flow.elements.map((element) => ({
      ...element,
      config: { ...element.config, canvasPosition: autoGraphPositions.get(element.id) ?? { x: graphPadding, y: graphPadding } }
    }))
  });
  const fitGraphToCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const horizontalFit = (canvas.clientWidth - 48) / graphWidth;
    const verticalFit = (canvas.clientHeight - 48) / graphHeight;
    setZoom(Math.max(0.35, Math.min(1.5, horizontalFit, verticalFit)));
  };
  useEffect(()=>{
    if(landing)return;
    const handle=(event:KeyboardEvent)=>{
      const el=event.target as HTMLElement|null;
      const editing=el?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(el?.tagName??'');
      const shortcut=(event.ctrlKey||event.metaKey)&&!event.altKey;
      if(shortcut&&event.key.toLowerCase()==='s'){
        event.preventDefault();onSave();return;
      }
      if(editing)return;
      if(shortcut&&event.key.toLowerCase()==='z'){
        event.preventDefault();
        if(event.shiftKey){if(canRedo)onRedo();}else if(canUndo)onUndo();
      }else if(shortcut&&event.key.toLowerCase()==='y'){
        event.preventDefault();if(canRedo)onRedo();
      }else if(shortcut&&event.key.toLowerCase()==='d'){
        event.preventDefault();duplicateSelected();
      }else if(event.key==='Delete'||event.key==='Backspace'){
        if(selected&&canBypassFlowElement(flow,selected.id)){
          event.preventDefault();onRemove(selected.id);
        }
      }
    };
    window.addEventListener('keydown',handle);
    return ()=>window.removeEventListener('keydown',handle);
  },[landing,canUndo,canRedo,onUndo,onRedo,onSave,flow,selected,insertionConnectorId,onRemove]);

  return {
    insertionPaths, graphProblems, selectGraphPath, duplicateSelected, dropElement, selectedObject,
    selectedPlatformEvent, toolboxGroups, freeformLayout, graphNodeWidth, graphPadding, graphWidth,
    graphHeight, graphPositions, setCanvasPosition, switchCanvasMode, resetFreeformLayout,
    fitGraphToCanvas,
  };
}
