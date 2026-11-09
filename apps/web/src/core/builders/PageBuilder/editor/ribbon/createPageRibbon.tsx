import { componentInstanceNames } from '../../../../../../../server/src/system-support/page-component-names';
import * as React from 'react';
import {
ArrowLeft, Check, ClipboardPaste, Copy, Database, Eye, EyeOff, Filter, Type, MoveHorizontal,
MoveVertical, Puzzle, Smartphone, RefreshCw, Save, Scissors, SlidersHorizontal, Undo2, Redo2, Trash2,
Workflow, Layers3, ChevronDown
} from 'lucide-react';
import RibbonColorPalette from '../../RibbonColorPalette';
import PageComponentNavigator from '../../PageComponentNavigator';
import PageBuilderActionRibbon from '../../PageBuilderActionRibbon';
import { pageStateChoices } from '../../pageStateChoices';
import SmartRibbon from '../../SmartRibbon';
import BuilderNumberInput from '../../BuilderNumberInput';
import SmartInsertRibbon from '../../SmartInsertRibbon';
import type { ArrangeRibbonProps } from '../../ArrangeRibbon';
import type { AdvancedFeature } from '../../PageBuilderAdvancedRibbon';
import PageBuilderAdvancedSections from '../../PageBuilderAdvancedSections';
import SmartIconGallery from '../../SmartIconGallery';
import { isBuilderApi, builderDefaults, type BuilderApi } from '../../builderPropertyInventory';
import { isCanvasLocked } from '../../canvasInteractions';
import { canvasGroupKey, canMoveCanvasLayer, fitCanvasComponentToPage } from '../../canvasLayerGroups';
import { updateSharedCanvasProperties, updateSharedCanvasPositions } from '../../canvasSharedRibbonProperties';
import { selectCanvasIds } from '../../canvasSelectionInteractions';
import { childrenOf, isLayoutContainer, rawLayoutParentId } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { type PageLayoutVariant } from '../../../../metadata/Definitions/metadata';
import { pageLayoutOptionLabel, PAGE_LAYOUT_ORDER } from '../../pageLayoutSummary';

import type { usePageEditorState } from '../usePageEditorState';
import type { usePageLayoutActions } from '../management/usePageLayoutActions';
import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageComponentProperties } from '../inspector/usePageComponentProperties';
import type { usePageComponentActions } from '../usePageComponentActions';
import type { usePageManagement } from '../management/usePageManagement';
import type { usePagePalette } from './usePagePalette';

export function createPageRibbon(
  editorState: ReturnType<typeof usePageEditorState>,
  layoutActions: ReturnType<typeof usePageLayoutActions>,
  props: PageBuilderProps,
  componentProperties: ReturnType<typeof usePageComponentProperties>,
  componentActions: ReturnType<typeof usePageComponentActions>,
  management: ReturnType<typeof usePageManagement>,
  palette: ReturnType<typeof usePagePalette>,
) {
  const {
    selected, stringList, defaultRelatedLists, relatedListOptions, previewMode, setAdvancedEditor,
    setRibbonTab, setPreviewMode, applyPage, saving, selectedHistoryVersion, layoutVersions,
    showLayoutHistory, setSelectedHistoryVersion, ribbonCatalog, updateComponent,
    componentClipboard, undoStack, redoStack, switchingLayout, setInspectorTab, setActivePanel,
    selectionIds, ribbonTab, selectedId, paletteInsertRegion, setPaletteInsertRegion,
    inspectorSection, setInspectorSection, openDesignSection, toggleDesignSection,
    canvasBinding, selectRibbonTab, ribbonStripRef,
    setGroupEditId, setSelectionIds, setSelectedId, setSelectedRegion, setPageSettingsOpen,
    pagePreviewAreaRef, setFitCanvas, setFitFullPage, fitCanvas, fitFullPage, setCanvasZoom,
    canvasZoom, fitScale, advancedEditor, setRibbonPropertyHost, layoutSummaries, layoutCopySource,
    setLayoutCopySource, setPageDetailsApi, setInlineActionEvent,
  } = editorState;
  const {
    safeBackToPages, restoreLayoutVersion, loadLayoutHistory, placeSelectedLayer,
    wrapSelectedInContainer, ungroupSelected, switchLayoutVariant,
  } = layoutActions;
  const { page, objects, libraryComponents, onNotify, pages, request, flows } = props;
  const {
    selectedBuilderComponent, ribbonSelectedMembers, canGroupSelected, selectedGroupMembers,
    dataSharedPropertyIds, dataMixedPropertyIds, dataSelectedMembers, sharedRibbonDefinitions,
    ribbonSharedPropertyIds, ribbonMixedPropertyIds, validateInstanceName, openVisibilityEditor,
    selectedCustomDefinition, actionMembers, selectedActions, actionOptions, activeActionEvent,
    actionSelectionDisabled, mixedActionEventIds, mixedActionButtonVisibilityKeys, applyActionFlows, applyCartButtonVisibility,
  } = componentProperties;
  const {
    cutSelected, copySelected, pasteComponent, deleteTargets, deleteBlockedByLock, removeSelected,
    undo, redo, alignSelected, distributeSelected, moveSelected, addComponent,
  } = componentActions;
  const { savePage, publishCurrentLayout, copyLayoutFrom } = management;
  const { paletteComponents, renderPaletteIcon } = palette;

  const selectedRelatedLists = selected
    ? stringList(selected.properties.relatedLists, defaultRelatedLists)
    : defaultRelatedLists;
  const componentRelatedListOptions = [
    ...relatedListOptions,
    ...selectedRelatedLists
      .filter((name) => !relatedListOptions.some((option) => option.apiName === name))
      .map((apiName) => ({ apiName, label: apiName }))
  ];
  const enterInteractivePreview=()=>{
    if(previewMode)return;
    if(!window.confirm('Interactive preview can execute configured Flows and update records. Continue?'))return;
    setAdvancedEditor(null);setRibbonTab('Preview');setPreviewMode(true);
  };
  const exitInteractivePreview=()=>{setPreviewMode(false);setRibbonTab('Component Design 2');};
  // Page-level controls remain SQL-owned; present them on the top bar or Layout,
  // without changing their saved values, action callbacks or the global Smart inventory.
  const homeValue=(key:string):React.ReactNode=>{
    switch(key){
      case 'backIcon':return <button type="button" title="Back to pages" aria-label="Back to pages"
        onClick={safeBackToPages}><ArrowLeft size={21}/></button>;

      case 'canvasWidth':return <BuilderNumberInput key={page.apiName+':'+page.layoutVariant+':width'}
        aria-label="Page width" min={320} max={10000} step={1} integer
        disabled={page.layoutVariant!=='Custom'} value={page.canvasWidth}
        onValueChange={n=>applyPage({...page,canvasWidth:n})}/>;
      case 'canvasFillColor':return <input aria-label="Canvas Fill Color" type="color"
         value={/^#[0-9a-fA-F]{6}$/.test(page.canvasFillColor??'')?page.canvasFillColor:'#ffffff'}
         onChange={e=>applyPage({...page,canvasFillColor:e.target.value})}/>;
       case 'canvasHeight':return <BuilderNumberInput key={page.apiName+':'+page.layoutVariant+':height'}
        aria-label="Page height" min={320} max={10000} step={1} integer
        disabled={page.layoutVariant!=='Custom'} value={page.canvasHeight}
        onValueChange={n=>applyPage({...page,canvasHeight:n})}/>;
      case 'restoreVersion':return <button type="button" aria-label="Restore version" title="Restore selected version"
        disabled={saving||selectedHistoryVersion===null||
         layoutVersions.find(v=>v.version===selectedHistoryVersion)?.draft===true}
        onClick={()=>{if(selectedHistoryVersion!==null)void restoreLayoutVersion(selectedHistoryVersion);}}>
        Restore</button>;
      case 'selectVersion':return <div className="office-ribbon-stack office-ribbon-version-controls">
        <button type="button" aria-label={showLayoutHistory?'Refresh versions':'Load versions'}
          title={showLayoutHistory?'Refresh versions':'Load versions'}
          onClick={()=>void loadLayoutHistory()}>
          <Undo2 size={15}/></button>
        <select aria-label="Select Version" disabled={!showLayoutHistory||!layoutVersions.length}
          value={selectedHistoryVersion??''} onChange={e=>setSelectedHistoryVersion(Number(e.target.value))}>
          <option value="">Choose version…</option>
          {layoutVersions.map(item=><option key={item.version} value={item.version}>
            v{item.version}{item.published?' · Published':''}{item.draft?' · Draft':''}
          </option>)}
        </select>
      </div>;
      case 'preview':return <button type="button" className="office-ribbon-icon-button"
        aria-label="Preview page" title="Preview page" disabled={previewMode}
        onClick={enterInteractivePreview}><Eye size={17}/></button>;
      case 'exitPreview':return <button type="button" className="office-ribbon-icon-button"
        aria-label="Exit preview" title="Exit preview" disabled={!previewMode}
        onClick={exitInteractivePreview}><EyeOff size={17}/></button>;
      case 'resetIcon':return <button type="button" aria-label="Reset component" title="Reset component"
        disabled={!selectedBuilderComponent||!selected} onClick={()=>{
          if(!selected||!ribbonCatalog||!isBuilderApi(selected.type.slice(7),ribbonCatalog.components))return;
          const keys=new Set(ribbonCatalog.properties.flatMap(row=>
            [row.id,...Object.values(row.valueKeys??{})]));
          const retained=Object.fromEntries(Object.entries(selected.properties).filter(([k])=>!keys.has(k)));
          updateComponent(selected.id,{properties:{...retained,
            ...builderDefaults(selected.type.slice(7),ribbonCatalog.properties)}});
        }}><RefreshCw size={18}/></button>;
      case 'cut':return <button className="office-ribbon-icon-button" aria-label="Cut" title="Cut"
        disabled={!selected||isCanvasLocked(selected)} onClick={cutSelected}><Scissors size={17}/></button>;
      case 'copy':return <button className="office-ribbon-icon-button" aria-label="Copy" title="Copy"
        disabled={!selected} onClick={copySelected}><Copy size={17}/></button>;
      case 'paste':return <button className="office-ribbon-icon-button" aria-label="Paste" title="Paste"
        disabled={!componentClipboard} onClick={pasteComponent}><ClipboardPaste size={17}/></button>;
      case 'delete':return <button type="button" className="office-ribbon-icon-button"
        aria-label="Delete selected component"
        title={deleteTargets.length>1?'Delete '+deleteTargets.length+' selected components':'Delete selected component'}
        disabled={!selected||previewMode||deleteBlockedByLock}
        onClick={removeSelected}><Trash2 size={17}/></button>;
      case 'undo':return <button className="office-ribbon-icon-button" aria-label="Undo" title="Undo"
        disabled={!undoStack.length} onClick={undo}><Undo2 size={17}/></button>;
      case 'redo':return <button className="office-ribbon-icon-button" aria-label="Redo" title="Redo"
        disabled={!redoStack.length} onClick={redo}><Redo2 size={17}/></button>;
      case 'save':return <button className="office-ribbon-icon-button" aria-label="Save" title="Save page"
        disabled={saving} onClick={()=>void savePage()}><Save size={17}/></button>;
      case 'activate':return page.status==='Active'?null:<button className="office-ribbon-icon-button" aria-label="Activate" title="Activate page"
        disabled={saving||switchingLayout}
        onClick={()=>void publishCurrentLayout()}><Check size={17}/></button>;
      default:return null;
    }
  };
  const openAdvanced=(feature:AdvancedFeature)=>{
    if(['responsive','nesting','properties'].includes(feature)&&!selected)return;
    if(feature==='recordPage'&&page.pageType!=='Record Page')return;
    if(feature==='properties'){setInspectorTab('Data & Actions');setActivePanel('properties');}
    // Arrange → Nesting and other deep links must activate the inline Advanced tab.
    setRibbonTab('Component Action');
    setAdvancedEditor(feature);
  };
  // One callback/availability contract serves Arrange and the Design 2 fixed
  // R0 C7-C20 command row. Both edit the same page and Undo history.
  const canvasArrangeProps:ArrangeRibbonProps={
    freeCanvas:page.layoutMode==='free-canvas',
    hasSelection:!!selected,
    locked:ribbonSelectedMembers.some(isCanvasLocked),
    selectedCount:selectionIds.length,
    canGroup:canGroupSelected,
    canBringToFront:!!selected&&canMoveCanvasLayer(page.components,selected.id,'front'),
    canSendBackward:!!selected&&canMoveCanvasLayer(page.components,selected.id,'backward'),
    canFitToCanvas:!!selected&&selectionIds.length<=1&&!!selected.position&&
      !rawLayoutParentId(selected)&&!canvasGroupKey(selected)&&!isCanvasLocked(selected),
    canUngroup:!!selected&&!isCanvasLocked(selected)&&
      (canvasGroupKey(selected)
        ?selectedGroupMembers.every(item=>!isCanvasLocked(item))
        :selected.type==='Container'&&childrenOf(page.components,selected.id).length>0
          &&childrenOf(page.components,selected.id).every(item=>!isCanvasLocked(item))),
    onAlign:alignSelected,
    onDistribute:distributeSelected,
    onMove:moveSelected,
    onPlace:placeSelectedLayer,
    onGroup:wrapSelectedInContainer,
    onUngroup:ungroupSelected,
    onLock:()=>{
      if(!selected)return;
      const members=ribbonSelectedMembers.length?ribbonSelectedMembers:[selected];
      const nextLocked=!members.some(isCanvasLocked);
      const ids=new Set(members.map(item=>item.id));
      applyPage({...page,components:page.components.map(item=>ids.has(item.id)
        ?{...item,properties:{...item.properties,editorLocked:nextLocked}}:item)});
    },
    onNesting:()=>openAdvanced('nesting'),
    onFitToCanvas:()=>{
      if(!selected)return;
      applyPage({...page,components:fitCanvasComponentToPage(page.components,selected.id,
        {width:page.canvasWidth,height:page.canvasHeight})});
    }
  };
  const quickAccessOrder=['save','activate','preview','exitPreview','resetIcon','undo','redo','cut','copy','paste','delete'] as const;
  const journeyTabs: Array<typeof ribbonTab> = // Advanced and View controls live in Actions and Design.
  ['Add Block','Component Design 2','Component Action'];
  const ribbonTabsVisible: Array<typeof ribbonTab> = [...journeyTabs];

  const addPaletteComponent = (type: string) => {
    const selectedIndex = page.components.findIndex((component) => component.id === selectedId);
    const selectedRegion = paletteInsertRegion ?? page.components[selectedIndex]?.region ?? 'main';
    const parentId = paletteInsertRegion ? null : selected && isLayoutContainer(selected) ? selected.id : selected ? rawLayoutParentId(selected) : null;
    addComponent(type, paletteInsertRegion ? page.components.length : selectedIndex >= 0 ? selectedIndex + 1 : page.components.length, selectedRegion, undefined, parentId);
    setPaletteInsertRegion(null);
  };
  // The existing SmartRibbon is hosted only by the left editor dock.
  const selectedRibbonApi = selected ? (selected.type.startsWith('Custom:')?selected.type.slice(7):selected.type) : '';
  const selectedHasDataRibbon = Boolean(selected && ribbonCatalog && selectedBuilderComponent &&
    ribbonCatalog.properties.some(property=>property.tab==='Data'&&
      property.components.includes(selectedRibbonApi as BuilderApi)));
  // Keep Object Source available for every Design-selected component. Existing SQL
  // property grants still decide whether an Object selector and the + action are
  // enabled; unsupported components show the same collapsed, disabled controls.
  // The Formula Bar remains conditional on real data-binding capabilities.
  const dataRibbon = (part:'formulaBar'|'source') => selected && ribbonCatalog &&
    (part==='source'||selectedHasDataRibbon) ? (
    <SmartRibbon key={'smart-data-'+part} tab="Data" part={part} api={selectedRibbonApi}
      inspectorSection={inspectorSection} onInspectorSectionChange={setInspectorSection}
      openDesignSection={openDesignSection} onToggleDesignSection={toggleDesignSection}
      definitions={ribbonCatalog.properties}
      properties={selected.properties} objects={objects} pageObjectApiName={page.targetObject}
      componentId={selected.id} pageComponents={page.components}
      canvasBinding={canvasBinding}
      sharedPropertyIds={dataSharedPropertyIds} mixedPropertyIds={dataMixedPropertyIds}
      selectedApis={dataSelectedMembers.map(item=>item.type.startsWith('Custom:')?item.type.slice(7):item.type)}
      onChange={(properties:Record<string,unknown>,editedKeys?:readonly string[])=>{
        if(dataSelectedMembers.length>1)
          applyPage({...page,components:updateSharedCanvasProperties(
            page.components,selected.id,dataSelectedMembers,sharedRibbonDefinitions,'Data',properties,editedKeys)});
        else updateComponent(selected.id,{properties});
      }}
      position={selected.position} layoutMode={page.layoutMode}/>
  ) : null;
  const smartRibbonElement = (selected && ribbonCatalog && ((selectedBuilderComponent && (ribbonTab==='Component Design 2'||ribbonTab==='Component Layout')) ||(!selectedBuilderComponent && ribbonTab==='Component Design 2'))) ? (<>
              {ribbonTab==='Component Design 2'&&dataRibbon('source')}
              <SmartRibbon
                tab={ribbonTab==='Component Layout'?'Layout':
                  ribbonTab==='Component Design 2'?'Design2':'Design'}
                api={selected.type.startsWith('Custom:')?selected.type.slice(7):selected.type}
                definitions={ribbonCatalog.properties}
                design2Slots={ribbonCatalog.design2Slots}
                design2SlotRules={ribbonCatalog.design2SlotRules}
                design2Arrange={canvasArrangeProps}
                inspectorSection={inspectorSection} onInspectorSectionChange={setInspectorSection}
                openDesignSection={openDesignSection} onToggleDesignSection={toggleDesignSection}
                properties={selected.properties} objects={objects} pageObjectApiName={page.targetObject}
                componentId={selected.id} pageComponents={page.components}
                canvasBinding={canvasBinding}
                sharedPropertyIds={ribbonSharedPropertyIds} mixedPropertyIds={ribbonMixedPropertyIds}
                selectedApis={ribbonSelectedMembers.map(item=>item.type.startsWith('Custom:')?item.type.slice(7):item.type)}
                onChange={(properties:Record<string,unknown>,editedKeys?:readonly string[])=>{
                  // Tabs' Body Width/Height edit individual tabs; resize the frame in lockstep.
                  if(selected.type==='Custom:smart_tabs'&&ribbonSelectedMembers.length===1&&
                    ['tabWidth','tabHeight','tabCount','tabOrientation'].some(key=>
                      properties[key]!==selected.properties[key])){
                    const size=(key:string,fallback:number)=>Math.max(1,Number(properties[key]??selected.properties[key]??fallback)||fallback);
                    const count=Math.max(1,Math.floor(size('tabCount',3)));
                    const vertical=properties.tabOrientation==='vertical';
                    const gap=Math.max(0,Number(properties.tabGap??0)||0);
                    const width=Math.round(vertical?size('tabWidth',120):size('tabWidth',120)*count+gap*(count-1));
                    const height=Math.round(vertical?size('tabHeight',44)*count+gap*(count-1):size('tabHeight',44));
                    const position=selected.position?{...selected.position,width,height}:undefined;
                    updateComponent(selected.id,{properties,...(position?{position}:{})});
                  }else if(ribbonSelectedMembers.length>1){
                    const tab=ribbonTab==='Component Layout'?'Layout':
                      ribbonTab==='Component Design 2'?'Design2':'Design';
                    applyPage({...page,components:updateSharedCanvasProperties(
                      page.components,selected.id,ribbonSelectedMembers,sharedRibbonDefinitions,tab,properties,editedKeys)});
                  }else updateComponent(selected.id,{properties});
                }}
                componentVisible={selected.visible!==false}
                onVisibleChange={visible=>{
                  if(ribbonSelectedMembers.length>1){
                    const ids=new Set(ribbonSelectedMembers.map(item=>item.id));
                    applyPage({...page,components:page.components.map(item=>
                      ids.has(item.id)?{...item,visible}:item)});
                  }else updateComponent(selected.id,{visible});
                }}
                position={selected.position} layoutMode={page.layoutMode}
                onPositionChange={(position,editedFields)=>{
                  if(ribbonSelectedMembers.length>1)
                    applyPage({...page,components:updateSharedCanvasPositions(
                      page.components,selected.id,ribbonSelectedMembers,ribbonCatalog.properties,position,editedFields)});
                  else updateComponent(selected.id,{position});
                }}/>
  </>) : null;
  const insertRibbon = (<SmartInsertRibbon
            items={paletteComponents}
            onInsert={addPaletteComponent}
            renderIcon={renderPaletteIcon}/>);
  const ribbonComponentSelector = (!previewMode && <div className="office-builder-ribbon page-builder-global-selector" aria-label="Selected page component">
    <PageComponentNavigator components={page.components} libraryComponents={libraryComponents}
              pageKey={page.apiName+':'+(page.layoutVariant??'Desktop')}
              selectedId={selectedId} selectionIds={selectionIds}
              onSelect={(id,mode)=>{
                const next=selectCanvasIds(page.components,selectionIds,id,mode,selectedId);
                setGroupEditId(mode==='member'?id:'');
                setSelectionIds(next);
                setSelectedId(next.includes(id)?id:(next[0]??''));
                setSelectedRegion(null);setPageSettingsOpen(false);
                if(next.includes(id))window.requestAnimationFrame(()=>{
                  const nodes=pagePreviewAreaRef.current?.querySelectorAll<HTMLElement>('[data-component-id]');
                  Array.from(nodes??[]).find(node=>node.dataset.componentId===id)
                    ?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
                });
              }}
              onRename={(id,name)=>{
                const component=page.components.find(item=>item.id===id);
                if(!component)return;
                const proposed=name.trim();
                const error=validateInstanceName(id,proposed);
                if(error){onNotify(error);return;}
                updateComponent(id,{properties:{...component.properties,navigatorName:proposed}});
              }}/>
  </div>);
  const designInPanel = !previewMode;
  const ribbonNavigation = (<nav className="office-ribbon-tabs" role="tablist" aria-label="Page Builder tabs">
              {ribbonTabsVisible.map((tab,index) => {
                const Icon = {
                  'Add Block': Puzzle,
                  'Component Data': Database,
                  'Component Content': Type,
                  'Component Design 2': SlidersHorizontal,

                  Arrange: Layers3, Advanced: SlidersHorizontal,
                  'Component Style': Type,
                  'Component Responsive': Smartphone,
                  'Component Layout': Layers3,
                  'Component Action': Workflow,
                  Preview: Eye, Filters: Filter, Source: Database
                }[tab];
                const label = {
                  'Add Block': 'Insert',
                  'Component Data': 'Data',
                  'Component Content': 'Content',
                  'Component Design 2': 'Design',

                  Arrange: 'Arrange', Advanced: 'Advanced',
                  'Component Style': 'Format',
                  'Component Responsive': 'Responsive',
                  'Component Layout': 'Layout',
                  'Component Action': 'Actions',
                  Preview: 'View', Filters: 'Filters', Source: 'Source'
                }[tab];
                return <button key={tab} id={`page-builder-tab-${index}`} type="button"
                  role="tab" tabIndex={ribbonTab===tab?0:-1} aria-selected={ribbonTab === tab}
                  aria-controls="page-builder-tab-content"
                  className={ribbonTab===tab?'active':''} disabled={!selected && (tab.startsWith('Component ') && tab!=='Component Layout')} title={!selected && (tab.startsWith('Component ') && tab!=='Component Layout' )?'Select a component to edit its settings':label} onClick={() => selectRibbonTab(tab)}>
                  <Icon size={16} aria-hidden="true"/><span>{label}</span>
                </button>;
              })}
            </nav>);
  const renderRibbonPanel = () => (<div id="page-builder-tab-content" ref={ribbonStripRef}
          className="office-ribbon-content" role="tabpanel" aria-hidden={previewMode} aria-label={ribbonTab}
          aria-labelledby={`page-builder-tab-${Math.max(0,ribbonTabsVisible.indexOf(ribbonTab))}`}>
          {ribbonTab==='Add Block' && insertRibbon}
          {page.pageType==='Print Template'&&page.layoutMode==='template'&&selected&&ribbonTab==='Component Layout'&&
            <label><input type="checkbox" checked={selected.properties.printBreakBefore===true} onChange={event=>
              updateComponent(selected.id,{properties:{...selected.properties,printBreakBefore:event.target.checked}})}/>Page break before component</label>}
          {ribbonTab==='Component Action' &&
            <PageBuilderActionRibbon objects={objects} pages={pages} request={request}
              api={selected?.type.startsWith('Custom:')?selected.type.slice(7):selected?.type??''}
              selectedApis={actionMembers.map(item=>item.type.startsWith('Custom:')?item.type.slice(7):item.type)}
              actions={selectedActions} mixedEventIds={mixedActionEventIds}
              mixedButtonVisibilityKeys={mixedActionButtonVisibilityKeys} eventDefinitions={actionOptions} flows={flows}
              stateOptions={pageStateChoices(page.components)}
              dataFields={objects.find(item=>item.apiName===
                String(selected?.properties.objectApiName||page.targetObject||''))?.fields??[]}
              selectedEvent={activeActionEvent} disabled={!selected||actionSelectionDisabled}
              onSelectEvent={setInlineActionEvent}
              onChange={applyActionFlows}
              buttonVisibility={{
                qtyIncrease:selected?.properties.qtyIncreaseVisible!==false,
                qtyDecrease:selected?.properties.qtyDecreaseVisible!==false,
                customButton1:selected?.properties.customButton1Visible!==false,
                customButton2:selected?.properties.customButton2Visible!==false,
                customButton3:selected?.properties.customButton3Visible!==false
              }}
              onButtonVisibilityChange={applyCartButtonVisibility}/>}
          {ribbonTab==='Component Action' && <PageBuilderAdvancedSections
            section={advancedEditor} onInspectorHost={setRibbonPropertyHost}
            layout={{
              current:page.layoutVariant??'Desktop',
              options:PAGE_LAYOUT_ORDER.map(variant=>({value:variant,
                label:pageLayoutOptionLabel(variant,layoutSummaries[page.apiName])})),
              busy:switchingLayout||saving,
              onSwitch:variant=>void switchLayoutVariant(variant as PageLayoutVariant),
              copySource:layoutCopySource,
              onCopySource:variant=>setLayoutCopySource(variant as PageLayoutVariant|''),
              onCopy:()=>{if(layoutCopySource)void copyLayoutFrom(layoutCopySource);}
            }}
            assignment={{
              enabled:page.pageType==='Record Page'||page.pageType==='Home Page',
              assigned:(page.activationAssignments??[]).length>0,
              isDefault:(page.activationAssignments??[]).some(item=>item.scope===
                (page.pageType==='Record Page'?'Org Default':'App Default')),
              onAdd:()=>setPageDetailsApi(page.apiName)
            }}
            properties={{
              selected:!!selected,nameEditable:!!selected&&!isCanvasLocked(selected),
              apiName:selected?.type.startsWith('Custom:')?selected.type.slice(7):selected?.type??'',
              instanceName:selected?componentInstanceNames(page.components).get(selected.id)??'':'',
              validateInstanceName:value=>selected?validateInstanceName(selected.id,value):'Select a component.',
              onInstanceName:value=>{
                if(!selected)return;
                const error=validateInstanceName(selected.id,value);
                if(error){onNotify(error);return;}
                updateComponent(selected.id,{properties:{...selected.properties,navigatorName:value.trim()}});
              },
              visible:selected?.visible!==false,
              readOnly:!!selected&&(selectedCustomDefinition?.propertyDefinitions?.some(def=>def.propertyKey==='readonly')
                ?selected.properties.readonly!==false:selected.properties.readOnlyOnLayout===true),
              canReadOnly:!!selected&&(selected.type==='Record Field'
                ||Boolean(selectedCustomDefinition?.propertyDefinitions?.some(def=>def.propertyKey==='readonly'))),
              onVisible:value=>{if(selected)updateComponent(selected.id,{visible:value});},
              onReadOnly:value=>{
                if(!selected)return;
                const metadataReadonly=selectedCustomDefinition?.propertyDefinitions?.some(def=>def.propertyKey==='readonly');
                updateComponent(selected.id,{properties:metadataReadonly
                  ?{...selected.properties,readonly:value}
                  :{...selected.properties,readOnlyOnLayout:value,requiredOnLayout:false}});
              }
            }}
            nesting={{
              accepted:!!selected&&isLayoutContainer(selected),
              canChange:!!selected&&(!!selectedCustomDefinition||isLayoutContainer(selected)),
              onAccepted:value=>{
                if(!selected)return;
                if(!value&&childrenOf(page.components,selected.id).length){
                  onNotify('Move children out before disabling nesting.');return;
                }
                updateComponent(selected.id,{properties:{...selected.properties,layoutContainer:value}});
              }
            }}/>}
          {selected?.type==='Custom:smart_icon' && ribbonTab==='Component Design 2' &&
            <SmartIconGallery value={String(selected.properties.iconId??'house')}
              disabled={ribbonSelectedMembers.some(item=>item.type!=='Custom:smart_icon'||isCanvasLocked(item))}
              onChange={iconId=>{
                if(ribbonSelectedMembers.length>1){
                  const ids=new Set(ribbonSelectedMembers.map(item=>item.id));
                  applyPage({...page,components:page.components.map(item=>ids.has(item.id)
                    ?{...item,properties:{...item.properties,iconId}}:item)});
                }else updateComponent(selected.id,{properties:{...selected.properties,iconId}});
              }}/>}
          {smartRibbonElement}
          {ribbonTab==='Component Design 2' && <section className="smart-inspector-section page-builder-dock-section page-builder-canvas-section">
            <button type="button" className="smart-inspector-section-toggle"
              aria-expanded={openDesignSection==='Canvas'} onClick={()=>toggleDesignSection('Canvas')}>
              <ChevronDown size={15} aria-hidden="true"/>Canvas
            </button>
            {openDesignSection==='Canvas'&&<div className="page-builder-dock-section-body">
              <div className="page-builder-canvas-fields">
                <label data-ribbon-property="canvasWidth" className="une-sql-home-control une-ribbon-size-with-icon" title="Canvas Width">
                  <span className="une-ribbon-embedded-icon"><MoveHorizontal size={17}/></span>
                  {homeValue('canvasWidth')}
                </label>
                <label data-ribbon-property="canvasHeight" className="une-sql-home-control une-ribbon-size-with-icon" title="Canvas Height">
                  <span className="une-ribbon-embedded-icon"><MoveVertical size={17}/></span>
                  {homeValue('canvasHeight')}
                </label>
                <div data-ribbon-property="canvasFillColor" className="une-sql-home-control une-ribbon-canvas-colour">
                  <RibbonColorPalette variant="property" kind="fill" label="Canvas Fill Color"
                    value={page.canvasFillColor??'#ffffff'}
                    onChange={colour=>applyPage({...page,canvasFillColor:colour})}/>
                </div>
              </div>
              <div className="page-builder-canvas-zoom" role="group" aria-label="Zoom">
                <button type="button" onClick={()=>{setFitCanvas(true);setFitFullPage(true);}}
                  aria-pressed={fitCanvas&&fitFullPage}>Fit to Screen</button>
                <button type="button" onClick={()=>{setFitCanvas(true);setFitFullPage(false);}}
                  aria-pressed={fitCanvas&&!fitFullPage}>Fit Width</button>
                <label className="ribbon-view-zoom-number" title="Canvas zoom percentage">
                  <input type="number" min={20} max={200} step={5} aria-label="Canvas zoom percentage"
                    value={fitCanvas?Math.round(fitScale*100):canvasZoom}
                    onChange={event=>{const value=Number(event.target.value);
                      if(Number.isFinite(value)){setFitCanvas(false);setCanvasZoom(Math.min(200,Math.max(20,value)));}}}/>%
                </label>
              </div>
            </div>}
          </section>}
          {ribbonTab==='Component Design 2' && <section className="smart-inspector-section page-builder-dock-section page-builder-conditional-section">
            <button type="button" className="smart-inspector-section-toggle"
              aria-expanded={openDesignSection==='Conditional Visibility'} onClick={()=>toggleDesignSection('Conditional Visibility')}>
              <ChevronDown size={15} aria-hidden="true"/>Conditional Visibility
            </button>
            {openDesignSection==='Conditional Visibility'&&<div className="page-builder-dock-section-body">
              <div className="page-builder-visibility-controls">
                <label className="ribbon-small-checkbox"><input type="checkbox"
                  checked={selected?.visible??false} disabled={!selected}
                  onChange={event=>{if(selected)updateComponent(selected.id,{visible:event.target.checked});}}/>
                  Visible on this page</label>
                <button type="button" className="office-ribbon-icon-button" aria-label="Edit conditional visibility"
                  title="Edit conditional visibility" disabled={!selected} onClick={openVisibilityEditor}>
                  <Filter size={17} aria-hidden="true"/></button>
                <button type="button" disabled={!selected} onClick={openVisibilityEditor}>Conditions</button>
              </div>
            </div>}
          </section>}
        </div>);

  return {
    selectedRelatedLists, componentRelatedListOptions, homeValue, quickAccessOrder, dataRibbon,
    designInPanel, ribbonComponentSelector, ribbonNavigation, renderRibbonPanel,
  };
}
