import { loadCanvasAsset } from './canvasAssetCache';
import CanvasFloatingActions from '../../CanvasFloatingActions';
import CanvasFloatingResizeHandles from '../../CanvasFloatingResizeHandles';
import { compactLayoutForRecord } from '../../../../records/RecordWorkspace/recordMetadataUtils';
import { appRoutePath, type AppRoute } from '../../../../workspace/Navigation/appRouting';
import * as React from 'react';
import { Copy, MousePointer2, Maximize2, Move, MoreHorizontal, Pencil, Plus, RefreshCw } from 'lucide-react';
import RegisteredComponent from '../../../../components/RegisteredComponent/RegisteredComponent';
import CanvasDataBindingIcons from '../../CanvasDataBindingIcons';
import {
canNestComponent, pageAppearanceTarget, pageAppearanceStyleKeys, directChildren, isLayoutType,
isDescendantOf,
} from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { isCanvasLocked } from '../../canvasInteractions';
import { canvasGroupKey, canMoveCanvasLayer, canvasSiblingLayerIndex } from '../../canvasLayerGroups';
import { canvasScrollbarHit } from '../../canvasPointerInteractions';
import { selectCanvasIds } from '../../canvasSelectionInteractions';
import { startCanvasPartDrag } from './canvasPartDrag';
import { needsMetadataComponentRuntime } from '../../../../pages/PageRuntime/pageComponentBindings';
import { CompiledPreviewSlot, MemoizedCompiledComponentNode } from '../../../../pages/PageCompiler/CompiledPageRuntime';
import {
childrenOf, componentLayoutProps, isLayoutContainer, rawLayoutParentId, resolvePageComponentStyle,
} from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { findRegisteredComponent } from '../../../../components/Registry/componentRegistryLookup';
import { createComponentPreviewProps } from '../../pageBuilderPalette';
import { type FieldMetadata, type LightningPageMetadata } from '../../../../metadata/Definitions/metadata';

import type { usePageEditorState } from '../usePageEditorState';
import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageComponentProperties } from '../inspector/usePageComponentProperties';
import type { useCanvasGestures } from './useCanvasGestures';
import type { usePagePlacement } from './usePagePlacement';
import type { usePageComponentActions } from '../usePageComponentActions';
import type { usePageLayoutActions } from '../management/usePageLayoutActions';
import type { PageBuilderComponents } from '../PageBuilderTypes';

export function createPageCanvasRenderer(
  editorState: ReturnType<typeof usePageEditorState>,
  props: PageBuilderProps,
  componentProperties: ReturnType<typeof usePageComponentProperties>,
  canvasGestures: ReturnType<typeof useCanvasGestures>,
  placement: ReturnType<typeof usePagePlacement>,
  componentActions: ReturnType<typeof usePageComponentActions>,
  layoutActions: ReturnType<typeof usePageLayoutActions>,
  components: PageBuilderComponents,
) {
  const {
    ribbonTab, previewMode, selectedId, device, targetObject, builderAppApiName, stringList,
    openBuilderTabs, suppressCanvasClickRef, selectionIds, setGroupEditId, setSelectionIds,
    setSelectedRegion, setSelectedId, setFocusedCardMapping, setPageSettingsOpen,
    setComponentMenuId, setRibbonTab, openComponentInspector, componentNeedsData, dragOverId,
    selectRibbonTab, isPhoneBuilder, setDragOverId, canvasMoveStart, pagePreviewAreaRef,
    componentMenuId, componentClipboard, applyPage, fields, previewFieldValue, defaultRelatedLists,
    relatedListOptions, setOpenBuilderTabs, externalPreviewWindowRef, ribbonCatalog, canvasBinding,
    selectCanvasDataBinding, selectedRegion, setActivePanel, openAddBlocks, chooseCanvasDesignArea,
    updateComponent,
  } = editorState;
  const {
    page, libraryComponents, apps, request, dashboards, reports, objects, flows, pages,
    onLaunchFlow,
  } = props;
  const { selectedComponentDescription } = componentProperties;
  const {
    startCanvasMove, moveCanvasPointer, endCanvasMove, startCanvasResize, moveCanvasResize,
    endCanvasResize,
  } = canvasGestures;
  const {
    handleDrop, beginTemplatePlacement, previewTemplatePlacement, finishTemplatePlacement,
    beginTemplateResize, previewTemplateResize, finishTemplateResize,
  } = placement;
  const {
    duplicateSelected, copySelected, pasteComponent, moveSelected, removeSelected, addComponent,
  } = componentActions;
  const { placeSelectedLayer } = layoutActions;
  const { MetadataBoundPageComponent } = components;

  const renderPageComponent = (component: LightningPageMetadata['components'][number], index: number, libraryPreview = false, interactivePreview = false) => {
    const showHiddenSelection = ribbonTab === 'Preview' && !previewMode && !libraryPreview && Boolean(selectedId) && (selectedId === component.id || isDescendantOf(page.components,selectedId,component.id));
    if (!component.visible && !showHiddenSelection) return null;
    const customDefinition = component.type.startsWith('Custom:')
      ? findRegisteredComponent(libraryComponents, component.type.slice('Custom:'.length), 'page')
      : undefined;
    const inPage = page.components.some((item) => item.id === component.id);
    const nested = inPage && !childrenOf(page.components, null).some((item) => item.id === component.id);
    const nestedChildren = isLayoutContainer(component) && (!libraryPreview || interactivePreview)
      ? childrenOf(page.components, component.id).map((child) =>
          renderPageComponent(child, page.components.findIndex((item) => item.id === child.id), libraryPreview, interactivePreview))
      : undefined;
    const visualStyle = resolvePageComponentStyle(component.properties, component.type, device);
    // Unconfigured registered components remain discoverable without authoring
    // any placeholder text, border, or data in SQL.
    const editorGenericHint=!previewMode&&!libraryPreview&&customDefinition
      &&!customDefinition.apiName.startsWith('smart_')&&!nestedChildren?.length
      &&!Object.entries(component.properties).some(([key,value])=>
        /^(?:content|items|records|src|imageSource|textSource|objectApiName|fieldApiName|titleFieldApiName|label|tabs|value|flowApiName)$/i.test(key)
        &&value!==null&&value!==undefined&&value!==''&&(!Array.isArray(value)||value.length>0))
      ? component.label:'';

    const previewProperties = createComponentPreviewProps(
      customDefinition?.apiName ?? component.type,
      component.label,
      customDefinition?.description ?? selectedComponentDescription
    );
    const customPreviewProps = {
      ...previewProperties,
      ...component.properties,
      ...componentLayoutProps(component.properties, device),
      ...(customDefinition?.apiName?.startsWith('smart_') && component.position && page.layoutMode==='free-canvas'
        ? {canvasFrameSized:true}:{}),
      label: customDefinition?.apiName?.startsWith('smart_') && typeof component.properties.label==='string'
        ? component.properties.label : component.label,
      properties: component.properties,
      object: page.pageType === 'Record Page' ? targetObject : undefined,
      device,
      preview: true, previewOnly: true, builderPreview: !previewMode, pageSessionKey: (builderAppApiName || apps[0]?.apiName || 'Records') + ':' + page.apiName,
       loadAsset:(id:string)=>loadCanvasAsset<{contentType:string;contentBase64:string}>(request,id),
      disabled: !interactivePreview,
      onAction: previewProperties.onAction,
      onChange: previewProperties.onChange,
      onNavigate: previewProperties.onNavigate,
      children: nestedChildren
    };
    const accordionContent=typeof component.properties.content==='string'?component.properties.content:'';
    const tabs=stringList(component.properties.tabs,['Related','Details','News']);
    const chosenTab=tabs.includes(openBuilderTabs[component.id])?openBuilderTabs[component.id]:tabs[0];
    const tabChildren=childrenOf(page.components,component.id).filter(child=>
      (typeof child.properties.tabLabel==='string'&&tabs.includes(child.properties.tabLabel)
        ?child.properties.tabLabel:tabs[0])===chosenTab);
    // Canvas selection is a builder operation, never a component's runtime action.
    // The same selection path is used for pointer hits and intercepted live controls.
    const selectCanvasComponent=(event:React.MouseEvent<HTMLDivElement>)=>{
      event.stopPropagation();
      if(suppressCanvasClickRef.current){
        event.preventDefault();suppressCanvasClickRef.current=false;return;
      }
      const mode=event.altKey?'member'
        :event.ctrlKey||event.metaKey||event.shiftKey?'toggle':'replace';
      const next=selectCanvasIds(page.components,selectionIds,component.id,mode);
      setGroupEditId(mode==='member'?component.id:'');
      setSelectionIds(next);setSelectedRegion(null);
      setSelectedId(next.includes(component.id)?component.id:(next[0]??''));
      // The selection shield covers the component, so look underneath it for
      // the Design area the component declared (data-design-area). None → Body.
      if(mode==='replace'){
        const host=event.currentTarget;
        const under=typeof document.elementsFromPoint==='function'
          ?document.elementsFromPoint(event.clientX,event.clientY):[];
        const areaNode=under.find(node=>node instanceof HTMLElement&&node.dataset.designArea
          &&host.contains(node)&&node.closest('[data-component-id]')===host) as HTMLElement|undefined;
        chooseCanvasDesignArea(areaNode?.dataset.designArea??'Body');
      }
      if(component.type==='Custom:ui_item_grid'){
        const target=event.target as HTMLElement;
        const mapping=target.closest('.md-product-image')?'imageFieldApiName'
          :target.closest('.md-product-name')?'titleFieldApiName'
          :target.closest('.md-product-description')?'descriptionFieldApiName'
          :target.closest('.md-product-price')?'priceFieldApiName'
          :target.closest('.md-product-badge')?'badgeFieldApiName':'';
        setFocusedCardMapping(mapping);
      }else setFocusedCardMapping('');
      setPageSettingsOpen(false);setComponentMenuId('');
      if(mode==='replace'&&ribbonTab==='Add Block'){
        setRibbonTab('Component Design 2');
        openComponentInspector(componentNeedsData(component.type)?'Data & Actions':'Design');
      }
    };
    const selectOnlyInDesigner = !previewMode && !libraryPreview;
    // The canvas frame owns the resize handles; its content owns clipping/scrolling.
    // In template/nested layouts use a Fragment to preserve native direct-child styling.
    const ContentHost = page.layoutMode === 'free-canvas' && !nested && !libraryPreview ? 'div' : React.Fragment;
    const contentHostProps = ContentHost === 'div' ? {className:'free-canvas-content-viewport'} : {};
    return <div
      key={component.id}
      data-builder-editor={!previewMode&&!libraryPreview?'true':undefined}
      data-page-appearance={isLayoutType(component.type) ? 'layout' : pageAppearanceTarget(component.type)}
      data-page-style={pageAppearanceStyleKeys(visualStyle)}
      ref={libraryPreview && !interactivePreview ? (element) => { if (element) element.inert = true; } : undefined}
      className={`record-component ${(!libraryPreview || interactivePreview) && page.layoutMode === 'free-canvas' ? 'free-canvas-component' : ''} ${isCanvasLocked(component) ? 'canvas-component-locked' : ''} ${nested ? 'nested-page-component' : ''} ${isLayoutContainer(component) ? 'layout-container-component' : ''} ${libraryPreview ? 'component-rendered-preview' : ''} ${selectedId === component.id && !previewMode && !libraryPreview ? 'selected' : ''} ${selectionIds.includes(component.id) && !previewMode && !libraryPreview ? 'multi-selected' : ''} ${showHiddenSelection ? 'canvas-hidden-selection' : ''} ${dragOverId === component.id && !libraryPreview ? 'drop-target' : ''}`}
      style={{
        ...((!libraryPreview || interactivePreview) && page.layoutMode === 'free-canvas'
          ? nested
            ? { position: 'relative', left: 'auto', top: 'auto', width: '100%', height: 'auto', minHeight: 40 }
            : {
                left: component.position?.x ?? 0,
                top: component.position?.y ?? 0,
                width: component.position?.width ?? customDefinition?.resize?.defaultWidth ?? 320,
                height: component.position?.height ?? customDefinition?.resize?.defaultHeight ?? 180
              }
          : {}),
        ...(isLayoutType(component.type) ? {} : visualStyle),
        // The rendered and hit-tested stack follows the saved sibling order,
        // never the temporary .selected state or an authored visual override.
        ...(page.layoutMode==='free-canvas' ? {
          '--canvas-layer-order':canvasSiblingLayerIndex(page.components,component.id),
          zIndex:canvasSiblingLayerIndex(page.components,component.id)
        } : {}),
        ...(component.properties?.fillRegion===true && page.layoutMode==='template' ? {height:'100%',minHeight:0}: {}),
        // Editor-only frame colour: reuse an authored border, never persist a selection property.
        ...(!previewMode && !libraryPreview &&
          typeof (typeof component.properties.borderColor==='string'
            ? component.properties.borderColor:visualStyle.borderColor)==='string' &&
          Number(component.properties.borderWidth??visualStyle.borderWidth??1)>0
          ? {'--canvas-selection-outline':component.properties.borderColor || visualStyle.borderColor} : {})
      } as React.CSSProperties}
      onClick={selectOnlyInDesigner ? selectCanvasComponent : undefined}
      onClickCapture={libraryPreview && !interactivePreview
        ? event => { event.preventDefault(); event.stopPropagation(); }
        : selectOnlyInDesigner ? event => {
            const hit=event.target as HTMLElement;
            // Nested components select themselves. The builder's own toolbar,
            // resize handles and drop zones must retain their editing controls.
            if(hit.closest('.canvas-data-bindings'))return;
            if(hit.closest('[data-component-id]')!==event.currentTarget
              ||hit===event.currentTarget
              ||hit.closest('.canvas-element-actions,.canvas-drop-zone,.free-canvas-resize-handle,.template-component-resize-handle,.template-placement-handle'))return;
            // Stop links, forms, tabs, delegated clicks and configured actions
            // before React or browser handlers in the component can run.
            event.preventDefault();
            event.stopPropagation();
            selectCanvasComponent(event);
          } : undefined}
      onDoubleClick={!libraryPreview ? event => { event.stopPropagation(); if(!previewMode){
        if(canvasGroupKey(component)){setGroupEditId(component.id);setSelectionIds([component.id]);}
        setSelectedRegion(null);setSelectedId(component.id);selectRibbonTab('Component Design 2');
      }} : undefined}
      onContextMenu={!libraryPreview && !previewMode ? event => { event.preventDefault(); event.stopPropagation(); setSelectedRegion(null); setSelectedId(component.id); setComponentMenuId(component.id); } : undefined}
      onPointerDownCapture={!previewMode && !libraryPreview && selectedId === component.id && !isCanvasLocked(component)
        ? event => {
          // On the selected component, pressing a part (badge, image, buttons,
          // text) drags that part instead of the component; it snaps to the
          // nearest allowed place and updates the part's existing property.
          startCanvasPartDrag(event, component.type, {
            chooseArea: chooseCanvasDesignArea,
            suppressClick: () => { suppressCanvasClickRef.current = true; },
            onDrop: (property, value) => {
              if (component.properties[property] !== value)
                updateComponent(component.id, { properties: { ...component.properties, [property]: value } });
            }
          }); } : undefined}
      onPointerDown={!previewMode && !libraryPreview && page.layoutMode === 'free-canvas' && !nested ? event => {
        // A scrollable component is still a movable shape. Only native scrollbar
        // rails and touch panning are excluded; never exclude all Cart/Grid content.
        const target=event.target as Element;
        if(event.pointerType==='touch' || canvasScrollbarHit(target,event.clientX,event.clientY,event.currentTarget))return;
        startCanvasMove(event, component);
      } : undefined}
      onPointerMove={!previewMode && !libraryPreview && page.layoutMode === 'free-canvas' && !nested ? moveCanvasPointer : undefined}
      onPointerUp={!previewMode && !libraryPreview && page.layoutMode === 'free-canvas' && !nested ? event => endCanvasMove(event) : undefined}
      onPointerCancel={!previewMode && !libraryPreview && page.layoutMode === 'free-canvas' && !nested ? event => endCanvasMove(event, true) : undefined}
      onLostPointerCapture={!previewMode && !libraryPreview && page.layoutMode === 'free-canvas' && !nested ? event => endCanvasMove(event, true) : undefined}
      onKeyDown={!libraryPreview ? (event) => {
         if (event.currentTarget !== event.target || previewMode) return;
         if (event.key === 'Enter' || event.key === ' ') {
           event.preventDefault(); setSelectedId(component.id); setPageSettingsOpen(false);
         }
       } : undefined}
      onDragOver={!previewMode && !libraryPreview && !isPhoneBuilder ? (event) => { event.preventDefault(); event.stopPropagation(); setDragOverId(isLayoutContainer(component) ? component.id : rawLayoutParentId(component) ?? component.id); } : undefined}
      onDragLeave={!previewMode && !libraryPreview ? () => setDragOverId('') : undefined}
      onDrop={!previewMode && !libraryPreview && !isPhoneBuilder ? (event) => handleDrop(event, index, component.region ?? 'main', isLayoutContainer(component) ? component.id : rawLayoutParentId(component)) : undefined}
      draggable={!isPhoneBuilder && !previewMode && !libraryPreview && page.layoutMode !== 'free-canvas' && !isCanvasLocked(component)}
      data-component-id={libraryPreview ? undefined : component.id}
      onDragStartCapture={selectOnlyInDesigner && page.layoutMode === 'free-canvas'
        ? event => { event.preventDefault(); event.stopPropagation(); }
        : undefined}
      onDragStart={!previewMode && !libraryPreview && !isPhoneBuilder ? (event) => { if (page.layoutMode === 'free-canvas' || canvasMoveStart.current?.id === component.id) { event.preventDefault(); return; } event.stopPropagation(); event.dataTransfer.setData('text/plain', `component:${component.type}`); event.dataTransfer.setData('application/x-metadrive-component-id', component.id); } : undefined}
      role={libraryPreview ? undefined : page.layoutMode === 'free-canvas' ? 'group' : 'button'} tabIndex={previewMode || libraryPreview ? -1 : 0} aria-label={libraryPreview ? undefined : `${component.label} component`}
      aria-hidden={libraryPreview && !interactivePreview || undefined}
    >
      {!previewMode && !libraryPreview && selectedId === component.id && <CanvasFloatingActions componentId={component.id} viewportRef={pagePreviewAreaRef} enabled={page.layoutMode === 'free-canvas'}><div
        className="canvas-element-actions" role="toolbar" aria-label={`Actions for ${component.label}`}
        onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        {page.layoutMode === 'free-canvas' && !nested && !isCanvasLocked(component) && <button type="button"
          className="canvas-move-grip" aria-label={`Drag to move ${component.label}`}
          title="Drag to move only this component" draggable={false}
          onPointerDown={event => startCanvasMove(event, component)}
          onPointerMove={moveCanvasPointer}
          onPointerUp={event => endCanvasMove(event)}
          onPointerCancel={event => endCanvasMove(event, true)}
          onLostPointerCapture={event => endCanvasMove(event, true)}
          onClick={event => event.stopPropagation()}><Move size={15}/></button>}
        <button type="button" onClick={() => selectRibbonTab('Component Design 2')} title="Edit block"><Pencil size={15}/> Edit</button>
        {page.layoutMode === 'free-canvas' && <button type="button" onClick={() => selectRibbonTab('Component Layout')} title="Position and size"><Maximize2 size={15}/> Position</button>}
        <button type="button" onClick={duplicateSelected} disabled={isCanvasLocked(component)} title="Duplicate"><Copy size={16}/></button>
        <button type="button" onClick={() => setComponentMenuId(current => current === component.id ? '' : component.id)}
          aria-expanded={componentMenuId === component.id} aria-label="More component actions"><MoreHorizontal size={18}/></button>
        {componentMenuId === component.id && <div className="canvas-action-menu" role="menu" aria-label="More component actions">
          <button type="button" role="menuitem" onClick={() => {copySelected();setComponentMenuId('');}}>Copy <kbd>Ctrl+C</kbd></button>
          <button type="button" role="menuitem" disabled={!componentClipboard} onClick={() => {pasteComponent();setComponentMenuId('');}}>Paste <kbd>Ctrl+V</kbd></button>
          <button type="button" role="menuitem" disabled={isCanvasLocked(component)} onClick={duplicateSelected}>Duplicate <kbd>Ctrl+D</kbd></button>
          <button type="button" role="menuitem" onClick={() => selectRibbonTab('Component Layout')}>Align and position</button>
          <button type="button" role="menuitem"
            disabled={!canMoveCanvasLayer(page.components,component.id,'front')}
            onClick={() => {placeSelectedLayer('front');setComponentMenuId('');}}>Bring to front</button>
          <button type="button" role="menuitem"
            disabled={!canMoveCanvasLayer(page.components,component.id,'forward')}
            onClick={() => {moveSelected(1);setComponentMenuId('');}}>Bring forward</button>
          <button type="button" role="menuitem"
            disabled={!canMoveCanvasLayer(page.components,component.id,'back')}
            onClick={() => {placeSelectedLayer('back');setComponentMenuId('');}}>Send to back</button>
          <button type="button" role="menuitem"
            disabled={!canMoveCanvasLayer(page.components,component.id,'backward')}
            onClick={() => {moveSelected(-1);setComponentMenuId('');}}>Send backward</button>
          <button type="button" role="menuitem" onClick={() => selectRibbonTab('Component Data')}>Data, links and actions</button>

          <button type="button" role="menuitem" disabled={isCanvasLocked(component)} onClick={() => {removeSelected();setComponentMenuId('');}}>Delete <kbd>Delete</kbd></button>
        </div>}
      </div></CanvasFloatingActions>}
      <ContentHost {...contentHostProps}>
      {editorGenericHint&&<span className="page-editor-generic-hint" aria-hidden="true">{editorGenericHint}</span>}
      {showHiddenSelection && !component.visible
        ? <span className="canvas-hidden-marker">Hidden: {component.label}</span>
        : isLayoutType(component.type)
        ? <div className="page-nested-layout" style={visualStyle}>
          {directChildren(page.components, component.id).map((child) => renderPageComponent(child, page.components.indexOf(child), libraryPreview, interactivePreview))}
          {!libraryPreview && !previewMode && <div className="canvas-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); const draggedId = event.dataTransfer.getData('application/x-metadrive-component-id'); if (draggedId && canNestComponent(page.components, draggedId, component.id)) { applyPage({ ...page, components: page.components.map((item) => item.id === draggedId ? { ...item, parentId: component.id } : item) }); } else if (!draggedId) { const type = event.dataTransfer.getData('text/plain').replace(/^component:/, ''); if (type) addComponent(type, page.components.length, component.region ?? 'main', undefined, component.id); } }}>Drop components inside {component.label}</div>}
        </div>
        : component.type === 'Record Detail'
        ? <div className="record-detail-grid">{(Array.isArray(component.properties.fields) ? component.properties.fields : fields.slice(0, 6).map((field) => field.apiName)).map((apiName) => { const field = fields.find((item) => item.apiName === apiName); return field ? <div className="record-detail-field" key={apiName}><small>{field.label}</small><span>{previewFieldValue(field.apiName)}</span></div> : null; })}
          {!previewMode&&!(Array.isArray(component.properties.fields)?component.properties.fields:fields.slice(0,6)).length&&<div className="record-detail-field"><small>Field Name</small><span>Field value</span></div>}</div>
        : component.type === 'Field Section'
          ? <div className={`record-detail-grid columns-${component.properties.columns === 1 ? 1 : 2}`}>{stringList(component.properties.fieldApiNames, []).map((apiName) => fields.find((field) => field.apiName === apiName)).filter((field): field is FieldMetadata => Boolean(field)).map((field) => <div className="record-detail-field" key={field.apiName}><small>{field.label}</small><span>{previewFieldValue(field.apiName)}</span></div>)}
            {!previewMode&&!stringList(component.properties.fieldApiNames, []).length&&<div className="record-detail-field"><small>Field Name</small><span>Field value</span></div>}</div>
          : component.type === 'Record Field'
            ? (() => {
              const field = fields.find((item) => item.apiName === component.properties.fieldApiName);
              return <div className="record-detail-field"><small>{field?.label ?? component.label}</small><span>{previewFieldValue(field?.apiName??'')}</span></div>;
            })()
          : component.type === 'Related List'
          ? <div className="record-fields-card surface">
              {stringList(component.properties.relatedLists,defaultRelatedLists).map(name=>
                <div className="record-fields-heading" key={name}>
                  <strong>{relatedListOptions.find(option=>option.apiName===name)?.label??name}</strong>
                  <small>Rows load for the selected record when published</small>
                </div>)}
              {!stringList(component.properties.relatedLists,defaultRelatedLists).length&&<p>Select related lists in block settings.</p>}
            </div>
          : component.type === 'Tabs'
            ? <div className="record-fields-card surface">
                <div className="record-tabs" role="tablist" aria-label={component.label}>
                  {tabs.map(tab=><button type="button" role="tab" key={tab} aria-selected={chosenTab===tab}
                    className={chosenTab===tab?'active':''} onClick={event=>{
                      event.stopPropagation();setOpenBuilderTabs(old=>({...old,[component.id]:tab}));
                    }}>{tab}</button>)}
                </div>
                <div className="record-runtime-tab-panel" role="tabpanel">
                  {tabChildren.map(child=>renderPageComponent(child,page.components.indexOf(child),libraryPreview,interactivePreview))}
                  {!tabChildren.length&&<p>No blocks in this tab.</p>}
                  {!previewMode&&!libraryPreview&&<div className="canvas-drop-zone" onDragOver={event=>event.preventDefault()}
                    onDrop={event=>handleDrop(event,page.components.length,component.region??'main',component.id)}>Drop blocks into {chosenTab}</div>}
                </div>
              </div>
          : component.type === 'Highlights Panel'
            ? <div className="record-highlights surface">
                {(targetObject?(compactLayoutForRecord(targetObject,'master','')?.fieldApiNames??fields.slice(0,5).map(field=>field.apiName)):[])
                  .map(name=>fields.find(field=>field.apiName===name))
                  .filter((field):field is FieldMetadata=>Boolean(field))
                  .map(field=><div key={field.apiName}><span>{field.label}</span><strong>{previewFieldValue(field.apiName)}</strong></div>)}
                {!previewMode&&(!targetObject||!fields.length)&&<div><span>Field Name</span><strong>Field value</strong></div>}
              </div>
          : component.type === 'Dashboard'
            ? <div className="record-fields-card surface">
                <strong>{dashboards.find(d=>d.apiName===component.properties.dashboardApiName)?.label??'Select a published dashboard'}</strong>
                <p>Dashboard charts load from authorised published data.</p>
              </div>
          : component.type === 'Report Chart'
            ? <div className="record-fields-card surface">
                <strong>{reports.find(report=>report.apiName===component.properties.reportApiName)?.label??'Select a report'}</strong>
                <p>Report results load when the page runs.</p>
              </div>
          : component.type === 'Accordion'
            ? <details className="record-fields-card surface app-page-accordion" open>
                <summary>{component.label}</summary>
                {childrenOf(page.components,component.id).map(child=>
                  renderPageComponent(child,page.components.indexOf(child),libraryPreview,interactivePreview))}
                {!childrenOf(page.components,component.id).length&&
                  (accordionContent?<p>{accordionContent}</p>:<p>Drop a block inside this accordion.</p>)}
                {!previewMode&&!libraryPreview&&<div className="canvas-drop-zone"
                  onDragOver={event=>event.preventDefault()}
                  onDrop={event=>handleDrop(event,page.components.length,component.region??'main',component.id)}>
                  Drop blocks inside this accordion
                </div>}
              </details>
          : component.type === 'Items to Approve'
            ? <div className="record-fields-card surface"><strong>{component.label}</strong><p>Pending approvals assigned to the signed-in user load at runtime.</p></div>
          : component.type === 'Related List Quick Links'
            ? <nav className="record-fields-card surface" aria-label={component.label}>
                {stringList(component.properties.relatedLists,defaultRelatedLists).map(name=>
                  <a key={name} href={'#related-'+name}>{name}</a>)}
                {!previewMode&&!stringList(component.properties.relatedLists,defaultRelatedLists).length&&<span>Related List</span>}
              </nav>
          : component.type === 'Rich Text'
            ? <div className="record-fields-card surface" style={{whiteSpace:'pre-wrap'}}>{(String(component.properties.content??'').trim()?String(component.properties.content):(!previewMode?'Text Here':''))}</div>
          : component.type === 'List View'
            ? <div className="record-fields-card surface"><strong>{objects.find(item=>item.apiName===component.properties.listObjectApiName)?.pluralLabel??'Select an Object'}</strong>
                <p>Authorised records, sorting, search and pagination load when this page runs.</p></div>
          : component.type === 'Path'
            ? <div className="record-fields-card surface"><strong>{component.label}</strong>
                <ol className="record-path">{((fields.find(field=>field.apiName===component.properties.stageFieldApiName)?.picklistValues?.length
                  ?fields.find(field=>field.apiName===component.properties.stageFieldApiName)?.picklistValues
                  :(!previewMode?['Stage 1','Stage 2','Stage 3']:[]))??[]).map(value=>
                  <li key={value}>{value}</li>)}</ol></div>
          : component.type === 'Screen Flow'
            ? <div className="record-fields-card surface"><strong>{component.label}</strong>
                <p>{flows.find(flow=>flow.apiName===component.properties.flowApiName)?.label??'Select an active Screen Flow'}</p></div>
          : component.type === 'Activities'
            ? <div className="record-fields-card surface"><strong>{component.label}</strong>
                <p>Activities for the current record load when this page is opened.</p></div>
          : component.type === 'Chatter'
            ? <div className="record-fields-card surface"><strong>{component.label}</strong>
                <p>Posts and comments for the current record load when this page is opened.</p></div>
                  : customDefinition?.apiName === 'ui_item_grid' && !previewMode && !libraryPreview && !component.properties.titleFieldApiName
                    ? <div className="une-card-grid-editor-preview" aria-label="Card Grid example layout" style={{padding:12,display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10,height:'100%',alignContent:'start',pointerEvents:'none'}}>
                        {[1,2,3].map(n=><div key={n} style={{border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',overflow:'hidden',minWidth:0}}><div style={{height:72,background:'#e2e8f0',display:'grid',placeItems:'center',color:'#475569'}}>Image</div><div style={{padding:8,color:'#273449',fontWeight:600}}>Card {n}</div><div style={{padding:'0 8px 10px',fontSize:12,color:'#64748b'}}>Choose fields to show records</div></div>)}
                      </div>
                  : customDefinition && !isLayoutContainer(component) && (!libraryPreview || interactivePreview) &&
                    needsMetadataComponentRuntime(component.properties)
                    ? <CompiledPreviewSlot componentId={component.id} enabled={previewMode}
                        compiled={runtime=><MemoizedCompiledComponentNode definition={customDefinition} component={component}
                          objectApiName={runtime.byId.get(component.id)!.objectApiName}
                          formFactor={device === 'Phone' ? 'Phone' : device === 'Tablet' ? 'Tablet' : 'Desktop'}
                          apps={apps} pages={pages} currentAppId={builderAppApiName || apps[0]?.apiName || 'Records'}
                          availableFlows={flows.filter((flow) => ['Screen Flow', 'Autolaunched Flow'].includes(flow.flowType))}
                          reports={reports} children={nestedChildren}
                          onNavigate={((route:AppRoute)=>{window.open(appRoutePath(route),'_blank','noopener,noreferrer');}) as never}
                          onLaunchFlow={(flowApiName: string, inputs?: Record<string, unknown>) => { onLaunchFlow(flowApiName, inputs); }}/>}
                        fallback={<MetadataBoundPageComponent apiRequest={request} definition={customDefinition} component={component}
                        objects={objects} apps={apps} pages={pages} currentAppId={builderAppApiName || apps[0]?.apiName || 'Records'}
                        pageSessionKey={(builderAppApiName || apps[0]?.apiName || 'Records') + ':' + page.apiName}
                        pageComponents={page.components} reports={reports} formFactor={device === 'Phone' ? 'Phone' : 'Desktop'}
                        availableFlows={flows.filter((flow) => ['Screen Flow', 'Autolaunched Flow'].includes(flow.flowType))}
                        onNavigate={(route:AppRoute)=>{if(previewMode)window.open(appRoutePath(route),'_blank','noopener,noreferrer');}}
                         onLaunchFlow={(flowApiName: string, inputs: Record<string, unknown>) => { onLaunchFlow(flowApiName, inputs); externalPreviewWindowRef.current?.opener?.focus?.(); }} disableActions={!previewMode} builderPreview={!previewMode} />}/>
                  : customDefinition
                    ? <RegisteredComponent formulaInstanceId={component.id} definition={customDefinition} layoutTransparent props={libraryPreview ? customPreviewProps : {
                      ...component.properties,
                      ...componentLayoutProps(component.properties, device),
                      ...(customDefinition.apiName.startsWith('smart_') && component.position && page.layoutMode==='free-canvas'
                        ? {canvasFrameSized:true}:{}),
                      label: component.type.startsWith('Custom:smart_') && typeof component.properties.label === 'string'
                        ? component.properties.label : component.label,
                      properties: component.properties,
                      object: page.pageType === 'Record Page' ? targetObject : undefined,
                      device, previewOnly: true, builderPreview: !previewMode, pageSessionKey: (builderAppApiName || apps[0]?.apiName || 'Records') + ':' + page.apiName,
                       loadAsset:(id:string)=>loadCanvasAsset<{contentType:string;contentBase64:string}>(request,id),
                      children: nestedChildren
                    }} editorPreview={!previewMode} />
                    : libraryPreview
                      ? <div className="component-demo-fallback"><strong>{component.label}</strong><span>{selectedComponentDescription || 'Preview of a reusable page component.'}</span><div><i /><i /><i /></div></div>
                      : <div className="component-demo-fallback"><strong>{component.label}</strong><span>This component is no longer registered. Re-register it to restore its live preview.</span><div><i /><i /><i /></div></div>}
      {!libraryPreview && customDefinition && customDefinition.trustedBundled !== true && isLayoutContainer(component)
        && <div className="metadata-nested-host">{nestedChildren}</div>}
      {!libraryPreview && !previewMode && isLayoutContainer(component) && !nestedChildren?.length
        && <div className="page-nested-empty">Drop components into this {component.label} or choose a child from the palette</div>}
      {/* Editing is selection-only. A transparent hit target sits above the actual
          control (including disabled buttons, iframes and action handlers) while
          keeping its rendered appearance and free-canvas move gestures intact. */}
      {selectOnlyInDesigner && !isLayoutContainer(component) && !isLayoutType(component.type)
        && !['Tabs','Accordion'].includes(component.type)
        && <div className="canvas-design-interaction-shield" aria-hidden="true" data-canvas-select-only="true"/>}
      </ContentHost>
      {/* Grouping is a canvas move/arrange context, not a reason to hide
          the selected component's independent Data Source icons. */}
      {!previewMode&&!libraryPreview&&selectedId===component.id&&
        ribbonCatalog&&customDefinition?.apiName&&
        ribbonCatalog.components.includes(customDefinition.apiName)&&
        <CanvasDataBindingIcons componentId={component.id} api={customDefinition.apiName}
          definitions={ribbonCatalog.properties} properties={component.properties} active={canvasBinding}
          onChoose={target=>selectCanvasDataBinding(component.id,target)}/>}
      {!libraryPreview && page.layoutMode === 'template' && selectedId === component.id && !previewMode && !isCanvasLocked(component)
        && (['move', 'rotate'] as const).map(mode => <button key={mode} type="button"
          className={`template-placement-handle template-placement-${mode}`}
          aria-label={mode === 'move' ? `Move ${component.label}` : `Rotate ${component.label}`}
          title={mode === 'move' ? 'Drag to position block (responsive space reserved)' : 'Drag to rotate; hold Shift for 15 degree steps'}
          draggable={false}
          onPointerDown={event => beginTemplatePlacement(event, component, mode)}
          onPointerMove={previewTemplatePlacement}
          onPointerUp={event => finishTemplatePlacement(event)}
          onPointerCancel={event => finishTemplatePlacement(event, true)}
          onClick={event => event.stopPropagation()}>
          {mode === 'move' ? <MousePointer2 size={13}/> : <RefreshCw size={13}/>}
        </button>)}
      {!libraryPreview && page.layoutMode === 'template' && selectedId === component.id && !previewMode && !isCanvasLocked(component)
        && (['n','ne','e','se','s','sw','w','nw'] as const).map(edge =>
          <button key={edge} type="button" className={`template-component-resize-handle resize-${edge}`}
            aria-label={`Resize ${component.label} ${edge}`} title="Drag edge or corner to resize"
            draggable={false}
            onPointerDown={event => beginTemplateResize(event, component, edge)}
            onPointerMove={previewTemplateResize}
            onPointerUp={event => finishTemplateResize(event)}
            onPointerCancel={event => finishTemplateResize(event, true)}
            onClick={event => event.stopPropagation()} />)}
      {!libraryPreview && page.layoutMode === 'free-canvas' && !nested && selectedId === component.id && !previewMode && !isCanvasLocked(component)
        && (['n','e','s','w'] as const).map(edge=><span key={edge}
          className={`free-canvas-move-edge move-edge-${edge}`}
          role="button" tabIndex={0} aria-label={`Move ${component.label} from ${edge} edge`}
          title="Drag border to move (four-direction cursor)"
          onPointerDown={event=>startCanvasMove(event,component)}
          onPointerMove={moveCanvasPointer}
          onPointerUp={event=>endCanvasMove(event)}
          onPointerCancel={event=>endCanvasMove(event,true)}
          onLostPointerCapture={event=>endCanvasMove(event,true)}
          onClick={event=>event.stopPropagation()}/>)}
      {!libraryPreview && page.layoutMode === 'free-canvas' && !nested && selectedId === component.id && !previewMode && !isCanvasLocked(component) && !canvasGroupKey(component)
        && <CanvasFloatingResizeHandles componentId={component.id} componentLabel={component.label} viewportRef={pagePreviewAreaRef}
          onStart={(event,edge)=>startCanvasResize(event,component,edge)}
          onMove={moveCanvasResize} onEnd={endCanvasResize}
          onCancel={event=>endCanvasResize(event,true)}/>}
    </div>;
  };
  const renderRegion = (region: 'header' | 'main' | 'sidebar') => {
    const regionComponents = page.components
      .map((component, index) => ({ component, index }))
      .filter(({ component }) => childrenOf(page.components, null).some((root) => root.id === component.id) && (component.region ?? 'main') === region);
    return <section
      className={`page-region page-region-${region} ${selectedRegion === region && !previewMode ? 'selected' : ''}`}
      aria-label={`${region[0].toUpperCase()}${region.slice(1)} region`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => handleDrop(event, page.components.length, region)}
      onClick={(event) => { if (previewMode || (event.target as HTMLElement).closest('.record-component,.canvas-drop-zone')) return; setSelectedRegion(region); setSelectedId(''); setPageSettingsOpen(false); setActivePanel('properties'); }}
    >
      <div className="page-region-label">{region}{!previewMode && <button type="button" className="icon-button subtle" aria-label={`Edit ${region} section`} onClick={(event) => { event.stopPropagation(); setSelectedRegion(region); setSelectedId(''); setPageSettingsOpen(false); setActivePanel('properties'); }}><Pencil size={13}/></button>}</div>
      {regionComponents.map(({ component, index }) => renderPageComponent(component, index))}
      {!regionComponents.length && <div className="canvas-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event, page.components.length, region)}><Plus size={15}/>{previewMode ? <span>Empty section</span> : <button type="button" onClick={() => openAddBlocks(region)}>Add a block here</button>}</div>}
      {regionComponents.length > 0 && !previewMode && <div className="canvas-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event, page.components.length, region)}><Plus size={15} /><span>Drop here to add to {region}</span></div>}
    </section>;
  };

  return {
    renderPageComponent, renderRegion,
  };
}
