import { completeFlowEndPaths } from '../../flowInsertElement.mjs';
import { canBypassFlowElement } from '../../flowGraphOperations.mjs';
import { displayValue } from '../../flowEditorData';
import { moveFlowPosition } from '../../flowCanvasLayout.mjs';
import { Fragment } from 'react';
import { Activity, Check, Copy, MoreHorizontal, MoveRight, Plus } from 'lucide-react';

import type { useFlowGraphActions } from './useFlowGraphActions';
import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowEditorState } from '../useFlowEditorState';

export default function FlowCanvas({ graphActions, props, editorState }: {
  graphActions: ReturnType<typeof useFlowGraphActions>;
  props: FlowBuilderProps;
  editorState: ReturnType<typeof useFlowEditorState>;
}) {
  const {
    freeformLayout, switchCanvasMode, resetFreeformLayout, graphProblems, duplicateSelected,
    graphPositions, graphPadding, graphNodeWidth, dropElement, insertionPaths, graphWidth,
    graphHeight, selectGraphPath, setCanvasPosition, selectedPlatformEvent, fitGraphToCanvas,
  } = graphActions;
  const {
    flow, onNotify, onFlowChange, onValidate, onSelect, validation, selectedId, onToolTab,
    onRemove,
  } = props;
  const {
    zoom, showGraphReview, setShowGraphReview, selected, phoneFlow, setPhoneInspectorOpen,
    dropActive, canvasRef, setDropActive, insertionConnectorId, activeGraphPath,
    setToolboxExpanded, dragRef, setDragPreview, flowElementMetadata, setInsertionConnectorId,
    setZoom,
  } = editorState;
  return <>
<section className="flow-canvas-region">
        <div className="flow-canvas-top">
          <div><span className="flow-status-dot" />{freeformLayout ? 'Freeform Layout' : 'Auto-Layout'} · {flow.elements.length} elements · {Math.round(zoom * 100)}%</div>
          <div className="flow-toolbar-actions">
            <button type="button" className="btn btn-small" onClick={switchCanvasMode}
              aria-pressed={freeformLayout}>{freeformLayout ? 'Switch to Auto-Layout' : 'Switch to Freeform'}</button>
            {freeformLayout && <button type="button" className="btn btn-small" onClick={resetFreeformLayout}>Reset Positions</button>}
            <button type="button" className="btn btn-small" aria-expanded={showGraphReview}
              onClick={()=>setShowGraphReview(value=>!value)}>
              Review graph{graphProblems.length?' ('+graphProblems.length+')':''}
            </button>
            {selected?.type!=='Start'&&selected?.type!=='End'&&<button type="button"
              className="btn btn-small" aria-label="Duplicate selected element" onClick={duplicateSelected}>
              <Copy size={13}/>Duplicate
            </button>}
            {flow.status === 'Draft' && <button type="button" className="btn btn-small" onClick={() => {
              const repaired = completeFlowEndPaths(flow, `connector-${crypto.randomUUID()}`);
              if (JSON.stringify(repaired) === JSON.stringify(flow)) {
                onNotify('All current paths already have an End.');
              } else {
                onFlowChange(repaired);
                onNotify('End paths added to the draft. Review, Check and Save the Flow.');
              }
            }}><Check size={13} />Complete End Paths</button>}
            <button className="btn btn-small" onClick={onValidate}><Activity size={13} />Errors and Warnings</button>
          </div>
        </div>
        {showGraphReview&&<div className="flow-graph-review" role="region"
          aria-label="Flow graph review">
          <strong>{graphProblems.length?graphProblems.length+' graph issue(s)':'No disconnected or unfinished paths found'}</strong>
          {graphProblems.map((problem,index)=><button type="button" className="text-action"
            key={index} onClick={()=>{if(problem.nodeId!==undefined)onSelect(problem.nodeId);}}>
            {problem.description}
          </button>)}
          <small>This is a draft graph check. Use Check for server-side validation before activation.</small>
        </div>}
        {validation && <div className={`flow-validation ${validation.valid ? 'valid' : 'invalid'}`} role="status"><strong>{validation.valid ? 'Flow check passed' : `${validation.errors.length} error(s) found`}</strong>{validation.errors.map((error) => <div key={error}>{error}</div>)}{validation.warnings.map((warning) => <div key={warning}>Warning: {warning}</div>)}</div>}
        {phoneFlow && <div className="flow-mobile-steps" role="list" aria-label="Flow steps">
          {flow.elements.map((element,index)=>{
            const pos=graphPositions.get(element.id);
            const indent=pos?Math.min(3,Math.max(0,Math.round((pos.x-graphPadding)/graphNodeWidth))):0;
            const incoming=flow.connectors.filter(edge=>edge.to===element.id);
            return <button type="button" key={element.id} role="listitem"
              aria-current={selectedId===element.id?'step':undefined}
              className={selectedId===element.id?'flow-mobile-step selected':'flow-mobile-step'}
              style={{marginLeft:indent*15}} onClick={()=>{onSelect(element.id);setPhoneInspectorOpen(true);}}>
              <span className="flow-mobile-step-number">{index+1}</span>
              <span className="flow-mobile-step-main"><strong>{element.label}</strong>
                <small>{element.type}</small>
                {incoming.some(edge=>edge.kind!=='normal')&&<em>{incoming.map(edge=>edge.label||edge.kind).join(' · ')}</em>}
              </span><span aria-hidden="true">›</span>
            </button>;
          })}
        </div>}
        <div className={`flow-canvas ${dropActive?'flow-drop-active':''}`}
          ref={canvasRef}
          onDragOver={(event)=>{
            if(event.dataTransfer.types.includes('application/x-metadrive-flow-type')){
              event.preventDefault();event.dataTransfer.dropEffect='copy';setDropActive(true);
            }
          }}
          onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node))
            setDropActive(false);}}
          onDrop={(event)=>dropElement(event,selectedId,
            insertionPaths.find(edge=>edge.id===insertionConnectorId)?.id)}>
          <div className="flow-graph" style={{ width: graphWidth, height: graphHeight, transform: `scale(${zoom})` }}>
          <svg className="flow-graph-connectors" width={graphWidth} height={graphHeight} aria-hidden="true">
            <defs><marker id="flow-graph-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8e8e8e" /></marker></defs>
            {flow.connectors.map((connector) => {
              const from = graphPositions.get(connector.from);
              const to = graphPositions.get(connector.to);
              if (!from || !to) return null;
              const startX = from.x + graphNodeWidth / 2;
              const startY = from.y + 74;
              const endX = to.x + graphNodeWidth / 2;
              const endY = to.y;
              const bend = Math.max(35, Math.abs(endY - startY) / 2);
              const labelX = (startX + endX) / 2;
              const labelY = (startY + endY) / 2 - 6;
              return <g key={connector.id} className={`flow-graph-edge ${connector.kind} ${activeGraphPath===connector.id?'is-selected':selectedId === connector.from ? 'is-selected' : ''}`}>
                <path d={`M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`} markerEnd="url(#flow-graph-arrow)" />
                {(connector.label || connector.kind !== 'normal') && <text x={labelX} y={labelY}>{connector.label || connector.kind}</text>}
              </g>;
            })}
          </svg>
          {flow.connectors.map(connector=>{
            const from=graphPositions.get(connector.from),to=graphPositions.get(connector.to);
            if(!from||!to)return null;
            const x=(from.x+to.x)/2+graphNodeWidth/2;
            const y=(from.y+74+to.y)/2-7;
            return <button type="button" key={connector.id}
              className={`flow-edge-insert ${activeGraphPath===connector.id?'active':''}`}
              style={{left:x,top:y}}
              aria-label={`Choose insertion path ${connector.label||connector.kind} from ${flow.elements.find(item=>item.id===connector.from)?.label??connector.from}`}
              title="Choose this branch path; drag an element here or select one in the toolbox"
              onClick={()=>{selectGraphPath(connector);setToolboxExpanded(true);}}
              onDragOver={event=>event.preventDefault()}
              onDrop={event=>dropElement(event,connector.from,connector.id)}>
              <Plus size={13}/>
            </button>;
          })}
          {flow.elements.map((element) => {
            const position = graphPositions.get(element.id) ?? { x: graphPadding, y: graphPadding };
            return <Fragment key={element.id}><button className={`flow-step flow-graph-node ${element.type === 'Start' ? 'start-step' : ''} ${selectedId === element.id ? 'selected' : ''}`}
              style={{ left: position.x, top: position.y, width: graphNodeWidth,
                cursor: freeformLayout ? 'grab' : undefined, touchAction: freeformLayout ? 'none' : undefined }}
              title={freeformLayout ? 'Drag to reposition. Use arrow keys to adjust; Shift + arrow moves 20px.' : undefined}
              onClick={() => onSelect(element.id)}
              onDragOver={(event)=>event.preventDefault()}
              onDrop={(event)=>dropElement(event,element.id)}
              onPointerDown={(event) => {
                if (phoneFlow || !freeformLayout || event.button !== 0) return;
                dragRef.current = {
                  id: element.id, startClientX: event.clientX, startClientY: event.clientY,
                  x: position.x, y: position.y, moved: false
                };
                onSelect(element.id);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (phoneFlow || !freeformLayout || !drag || drag.id !== element.id) return;
                const deltaX = event.clientX - drag.startClientX;
                const deltaY = event.clientY - drag.startClientY;
                if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) < 3) return;
                drag.moved = true;
                const next = moveFlowPosition({ x: drag.x, y: drag.y }, deltaX, deltaY, zoom);
                setDragPreview({ id: element.id, ...next });
              }}
              onPointerUp={(event) => {
                const drag = dragRef.current;
                if (!freeformLayout || !drag || drag.id !== element.id) return;
                dragRef.current = null;
                setDragPreview(null);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                if (drag.moved) setCanvasPosition(element.id,
                  moveFlowPosition({ x: drag.x, y: drag.y }, event.clientX - drag.startClientX, event.clientY - drag.startClientY, zoom));
              }}
              onPointerCancel={() => { dragRef.current = null; setDragPreview(null); }}
              onKeyDown={(event) => {
                if (phoneFlow || !freeformLayout || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault();
                const step = event.shiftKey ? 20 : 10;
                const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
                const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
                setCanvasPosition(element.id, moveFlowPosition(position, dx, dy));
              }}>
              <span className="flow-step-icon">{flowElementMetadata.find((item) => item.type === element.type)?.icon ?? '◉'}</span><span className="flow-step-content"><small>{element.type === 'Start' ? flow.flowType.toUpperCase() : element.type.toUpperCase()}</small><strong>{element.label}</strong>{element.type === 'Start' && <em>{flow.flowType === 'Platform Event-Triggered Flow' ? `Event: ${selectedPlatformEvent?.label ?? flow.triggerObject ?? 'Select event'}` : flow.triggerObject ? `Object: ${flow.triggerObject}` : 'No record object'} · {displayValue(flow.startConfig.trigger) || displayValue(flow.startConfig.frequency) || 'Manual'}</em>}</span><MoreHorizontal size={16} className="step-menu" />
            </button>
              {selectedId === element.id && <div className="flow-node-inline-actions"
                style={{ left: position.x + graphNodeWidth + 8, top: position.y + 8 }}>
                <button type="button" className="icon-button" aria-label={`Add element after ${element.label}`}
                  title="Choose an element from the toolbox to insert on this path"
                  onClick={() => { setInsertionConnectorId(''); onToolTab('Elements'); setToolboxExpanded(true); }}>
                  <Plus size={16} />
                </button>
                <button type="button" className="icon-button" aria-label={`Remove ${element.label}`}
                  title={canBypassFlowElement(flow,element.id)
                    ? 'Remove and reconnect the continuation path' : 'Cannot safely remove branching or terminal elements'}
                  disabled={!canBypassFlowElement(flow,element.id)}
                  onClick={() => onRemove(element.id)}><span aria-hidden="true">−</span></button>
              </div>}
            </Fragment>;
          })}
        </div></div>
        <div className="flow-zoom"><button onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))} aria-label="Zoom in"><Plus size={15} /></button><button onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))} aria-label="Zoom out"><span>−</span></button><button onClick={fitGraphToCanvas} aria-label="Fit to view"><MoveRight size={14} /></button></div>
      </section>
  </>;
}
