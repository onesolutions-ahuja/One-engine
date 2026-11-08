import { useEffect } from 'react';
import { canvasScaleToFitWidth } from '../../../../pages/PageRuntime/pageCanvas';
import { standaloneTemplateCanvasStyle } from '../../standaloneTemplateCanvasStyle';
import BuilderTemplatePreviewLayout from '../../../TemplatePreview/BuilderTemplatePreviewLayout';
import { formatRecordValue } from '../../../../records/RecordWorkspace/recordCsvUtils';
import { appRoutePath, type AppRoute } from '../../../../workspace/Navigation/appRouting';
import { Grid2X2, Move, Plus } from 'lucide-react';
import { childrenOf } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';

import type { createPageRibbon } from '../ribbon/createPageRibbon';
import type { usePageEditorState } from '../usePageEditorState';
import type { usePagePlacement } from './usePagePlacement';
import type { PageBuilderProps } from '../PageBuilderTypes';
import type { PageBuilderComponents } from '../PageBuilderTypes';
import type { useCanvasGestures } from './useCanvasGestures';
import type { createPageCanvasRenderer } from './createPageCanvasRenderer';
import type { usePageComponentProperties } from '../inspector/usePageComponentProperties';

export default function PageCanvasStage({ ribbon, editorState, placement, props, components, canvasGestures, canvasRenderer, componentProperties }: {
  ribbon: ReturnType<typeof createPageRibbon>;
  editorState: ReturnType<typeof usePageEditorState>;
  placement: ReturnType<typeof usePagePlacement>;
  props: PageBuilderProps;
  components: PageBuilderComponents;
  canvasGestures: ReturnType<typeof useCanvasGestures>;
  canvasRenderer: ReturnType<typeof createPageCanvasRenderer>;
  componentProperties: ReturnType<typeof usePageComponentProperties>;
}) {
  const { designInPanel, ribbonNavigation, renderRibbonPanel } = ribbon;
  const {
    fitFullPage, setFitScale, pagePreviewAreaRef, canvasRefreshKey, previewMode,
    suppressCanvasClickRef, setSelectedId, setSelectionIds, setGroupEditId, setSelectedRegion,
    setRibbonTab, setPageSettingsOpen, setActivePanel, builderAppApiName,
    previewPageDefinitionCache, device, fitCanvas, fitScale, canvasZoom, canvasSnap,
    marqueeOverlayRef, selected, openAddBlocks, canvasGuideXRef, canvasGuideYRef, targetObject,
    previewRecordId, previewRecord, setPreviewRecordId, previewRecords, fields, previewFieldValue,
    stringList, template,
  } = editorState;
  const { handleDrop } = placement;
  const { page, apps, objects, pages, reports, libraryComponents, flows, onLaunchFlow } = props;
  const { LightningAppRuntime } = components;
  const {
    startCanvasMarquee, moveCanvasMarquee, endCanvasMarquee, moveCanvasGroupGesture,
    endCanvasGroupGesture, startCanvasGroupGesture,
  } = canvasGestures;
  const { renderPageComponent, renderRegion } = canvasRenderer;
  const { selectedGroupBounds, selectedGroupMembers } = componentProperties;
  useEffect(() => {
    const previewArea = pagePreviewAreaRef.current;
    if (!fitCanvas || page.layoutMode !== 'free-canvas' || !previewArea) {
      setFitScale(1);
      return;
    }
    const updateScale = () => {
      // clientWidth includes padding but excludes a vertical scrollbar.
      // The viewport has 6px padding on each side: subtract the real insets,
      // not the old 8px constant, or Fit Width creates a horizontal scrollbar.
      // That scrollbar changes available height/width and makes the canvas jump.
      const style=window.getComputedStyle(previewArea);
      const horizontalInset=(Number.parseFloat(style.paddingLeft)||0)+
        (Number.parseFloat(style.paddingRight)||0);
      const verticalInset=(Number.parseFloat(style.paddingTop)||0)+
        (Number.parseFloat(style.paddingBottom)||0);
      const availableWidth=Math.max(1,previewArea.clientWidth-horizontalInset-2);
      const availableHeight=Math.max(1,previewArea.clientHeight-verticalInset-2);
      const widthScale=canvasScaleToFitWidth(page.canvasWidth,availableWidth);
      const heightScale=Math.min(1,Math.max(0.01,availableHeight/page.canvasHeight));
      const nextScale=fitFullPage?Math.min(widthScale,heightScale):widthScale;
      setFitScale(previous=>Math.abs(previous-nextScale)<0.0005?previous:nextScale);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(previewArea);
    return () => observer.disconnect();
  }, [fitCanvas, fitFullPage, page.layoutMode, page.canvasWidth, page.canvasHeight]);

  return <>
{designInPanel && <aside className="page-builder-design-dock" aria-label="Page Builder panel">
          <div className="page-builder-design-dock-header">
            {ribbonNavigation}
          </div>
          {/* Reuse the shared ribbon editor and SQL-backed Design 2 slot matrix in the left dock. */}
          <section className="office-builder-ribbon page-builder-design-dock-ribbon" aria-label="Page Builder panel controls">
            {renderRibbonPanel()}
          </section>
        </aside>}
        <div className="page-preview-area" ref={pagePreviewAreaRef}>
          <div className="page-stage" key={canvasRefreshKey}
            onPointerDownCapture={() => {
              if (previewMode) return;
              // Canvas drag/select calls preventDefault, which otherwise leaves the
              // previous ribbon input focused with a visible editing caret.
              // Blur only ribbon editors, never controls inside the canvas.
              const active = document.activeElement;
              if (active instanceof HTMLElement &&
                  active.closest('.office-builder-ribbon') &&
                  active.matches('input,textarea,select,[contenteditable="true"]')) {
                active.blur();
              }
            }}
            onClick={(event) => {
            if(suppressCanvasClickRef.current){suppressCanvasClickRef.current=false;return;}
            if(previewMode||event.ctrlKey||event.metaKey||event.shiftKey
              ||(event.target as HTMLElement).closest('.record-component,.canvas-drop-zone,button,input,select,textarea'))return;
            setSelectedId('');setSelectionIds([]);setGroupEditId('');
            setSelectedRegion(null);setRibbonTab('Add Block');setPageSettingsOpen(false);setActivePanel(null);
          }} onDragOver={previewMode ? undefined : (event) => event.preventDefault()}
             onDrop={previewMode ? undefined : (event) => handleDrop(event)}>
            {previewMode && page.pageType !== 'Record Page' ? <div className="page-builder-live-runtime" aria-label="Published runtime preview of current draft">
              <LightningAppRuntime
                appId={builderAppApiName || apps[0]?.apiName || 'Records'}
                pageApiName={page.apiName} previewPage={page}
                inScreenPage={page.pageType === 'In-Screen Page'}
                pageDefinitionCache={previewPageDefinitionCache.current}
                objects={objects} apps={apps} pages={pages} reports={reports}
                libraryComponents={libraryComponents} availableFlows={flows}
                formFactor={device} previewLayoutDevice={device}
                onNavigate={(route:AppRoute) => { window.open(appRoutePath(route),'_blank','noopener,noreferrer'); }}
                onLaunchFlow={onLaunchFlow} onStandaloneModeChange={() => {}} />
            </div> : <div
              className={`record-preview ${page.layoutMode === 'free-canvas' ? 'free-canvas-preview' : page.pageType === 'Record Page' ? 'record-page-preview' : page.pageType === 'App Page' ? 'app-page-preview' : 'home-page-preview'} ${device === 'Phone' ? 'phone-preview' : device === 'Tablet' ? 'tablet-preview' : ''}`}
              style={{...(page.layoutMode === 'free-canvas' ? {
                width: page.canvasWidth * (fitCanvas ? fitScale : canvasZoom/100),
                height: page.canvasHeight * (fitCanvas ? fitScale : canvasZoom/100),
                minHeight: 0,
                overflow: 'hidden'
              } : page.layoutMode === 'template' && page.components.some(c => c.visible && c.properties?.standalonePresentation === true) ? standaloneTemplateCanvasStyle(page.canvasWidth, page.canvasHeight) : {}),backgroundColor:page.canvasFillColor??'#ffffff'}}
            >
              {page.layoutMode === 'free-canvas' ? <div
                className={`free-canvas-stage ${canvasSnap && !previewMode ? 'canvas-grid-on' : ''} ${!previewMode ? 'canvas-editing' : ''}`}
                style={{
                  width: page.canvasWidth,
                  height: page.canvasHeight,
                   backgroundColor:page.canvasFillColor??'#ffffff',
                   transform: (fitCanvas || canvasZoom!==100) ? `scale(${fitCanvas?fitScale:canvasZoom/100})` : undefined,
                  transformOrigin: 'top left'
                }}
                onPointerDown={!previewMode?startCanvasMarquee:undefined}
                onPointerMove={!previewMode?moveCanvasMarquee:undefined}
                onPointerUp={!previewMode?event=>endCanvasMarquee(event):undefined}
                onPointerCancel={!previewMode?event=>endCanvasMarquee(event,true):undefined}
              >
                {childrenOf(page.components, null).map((component) => renderPageComponent(component, page.components.findIndex((item) => item.id === component.id)))}
                {!previewMode&&<div ref={marqueeOverlayRef} className="canvas-selection-marquee" aria-hidden="true"/>}
                {!previewMode && selectedGroupBounds && selected && <div className="canvas-group-outline"
                  role="group" aria-label="Move or resize selected group" style={{
                    left:selectedGroupBounds.x,top:selectedGroupBounds.y,
                    width:selectedGroupBounds.width,height:selectedGroupBounds.height
                  }}
                  onPointerMove={moveCanvasGroupGesture}
                  onPointerUp={endCanvasGroupGesture}
                  onPointerCancel={event=>endCanvasGroupGesture(event,true)}
                  onClick={event=>event.stopPropagation()}>
                  <span className="canvas-group-selection-count" aria-hidden="true">{selectedGroupMembers.length} selected</span>
                  <button type="button" className="canvas-group-move-handle"
                    aria-label="Move grouped components" title="Drag to move grouped components"
                    onPointerDown={event=>startCanvasGroupGesture(event,'move')}
                    onClick={event=>event.stopPropagation()}><Move size={16}/></button>
                  {(['n','ne','e','se','s','sw','w','nw'] as const).map(edge=><button key={edge}
                    type="button" aria-label={`Resize grouped components ${edge}`}
                    className={`canvas-group-handle resize-${edge}`}
                    onPointerDown={event=>startCanvasGroupGesture(event,'resize',edge)}
                    onPointerMove={moveCanvasGroupGesture}
                    onPointerUp={endCanvasGroupGesture}
                    onPointerCancel={event=>endCanvasGroupGesture(event,true)}
                    onClick={event=>event.stopPropagation()}/>)}
                </div>}
                {!page.components.length && <div className="free-canvas-empty builder-empty-start"><strong>Your page is ready to design</strong><span>Choose a block or drag one from the library.</span><button type="button" className="btn btn-brand" onClick={() => openAddBlocks()}><Plus size={15}/> Add a block</button></div>}
                {!previewMode && <><div ref={canvasGuideXRef} className="canvas-magnet-guide canvas-magnet-guide-x" aria-hidden="true" />
                  <div ref={canvasGuideYRef} className="canvas-magnet-guide canvas-magnet-guide-y" aria-hidden="true" /></>}
              </div> : <>
              {page.pageType === 'Record Page' ? <>
                <div className="record-preview-nav">
                  <div className="record-object-icon">{(targetObject?.label ?? page.targetObject).charAt(0)}</div>
                  <div><strong>{targetObject?.label ?? page.targetObject} preview</strong><small>{page.targetObject} · Recently Viewed</small></div>
                  <label>Preview record <select aria-label="Preview record" value={previewRecordId||String(previewRecord?.Id??'')}
                     onChange={event=>setPreviewRecordId(event.target.value)}>
                     {!previewRecords.length&&<option value="">No accessible records</option>}
                     {previewRecords.map(item=><option key={String(item.Id)} value={String(item.Id)}>
                       {formatRecordValue(item.Name??item.Id)}</option>)}
                   </select></label>
                </div>
                {page.components.some((component) => component.type === 'Highlights Panel' && component.visible) && <div className="record-highlight">{fields.slice(0, 5).map((field) => <div key={field.apiName}><small>{field.label}</small><strong>{previewFieldValue(field.apiName)}</strong></div>)}</div>}
                {page.components.some((component) => component.type === 'Tabs' && component.visible) && <div className="record-tabs">{stringList(page.components.find((component) => component.type === 'Tabs')?.properties.tabs, ['Related', 'Details', 'News']).map((tab, index) => <span className={index === 0 ? 'active' : ''} key={`${tab}-${index}`}>{tab}</span>)}</div>}
              </> : page.pageType === 'App Page' ? (!page.components.some(item=>item.properties?.standalonePresentation===true) && <div className="app-page-shell-header"><div className="record-object-icon"><Grid2X2 size={17} /></div><div><small>Lightning App</small><strong>{page.label}</strong></div></div>) : <div className="home-page-shell-header"><small>HOME</small><strong>{page.label}</strong><span>Your workspace overview</span></div>}
              {page.components.some(item=>item.properties?.standalonePresentation===true)
                ? <BuilderTemplatePreviewLayout page={page} phone={device==='Phone'}
                    header={renderRegion('header')} main={renderRegion('main')} sidebar={renderRegion('sidebar')}/>
                : <div className={`page-template-regions template-${template.id}`}>
                    {template.regions.includes('header') && renderRegion('header')}
                    <div className="page-template-content">
                      {renderRegion('main')}
                      {template.regions.includes('sidebar') && renderRegion('sidebar')}
                    </div>
                  </div>}
              </>}
            </div>}
          </div>
        </div>
  </>;
}
