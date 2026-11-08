import { placeNewCanvasComponent, visibleCanvasBounds } from '../canvasInsertPlacement';
import { componentNameStem, nextComponentInstanceName } from '../../../../../../server/src/system-support/page-component-names';
import { confirmDestructiveAction } from '../../../components/ConfirmAction/confirmDestructiveAction';
import { libraryComponentLabel } from '../../../components/Registry/componentLibraryDiscovery';
import { legacyLayoutToRecordComponents } from '../../../records/RecordWorkspace/recordPageLayoutMigration';
import { useEffect, useRef } from 'react';
import { isBuilderApi, builderDefaults } from '../builderPropertyInventory';
import { isLayoutType } from '../../../pages/TemplatePageRuntime/pageComponentLayout';
import { isCanvasLocked, alignCanvasComponents, distributeCanvasComponents } from '../canvasInteractions';
import { translateCanvasSelection } from '../canvasSelectionInteractions';
import { copyComponentTree, cloneComponentTree, assignTabOnReparent, removePageComponentSelection } from '../pageComponentTree';
import { isLayoutContainer, rawLayoutParentId } from '../../../pages/TemplatePageRuntime/pageComponentLayout';
import { findRegisteredComponent } from '../../../components/Registry/componentRegistryLookup';
import { addRecentPageBlock } from '../pageBuilderUx';
import {
type PageLayoutCustomLinkMetadata, type PageActivationAssignmentMetadata, type PageComponentMetadata,
} from '../../../metadata/Definitions/metadata';

import type { PageBuilderProps } from './PageBuilderTypes';
import type { usePageEditorState } from './usePageEditorState';
import type { usePageComponentProperties } from './inspector/usePageComponentProperties';
import type { usePageLayoutActions } from './management/usePageLayoutActions';
import type { RecordListSetting } from './PageBuilderTypes';

export function usePageComponentActions(
  props: PageBuilderProps,
  editorState: ReturnType<typeof usePageEditorState>,
  componentProperties: ReturnType<typeof usePageComponentProperties>,
  layoutActions: ReturnType<typeof usePageLayoutActions>,
) {
  const { page, libraryComponents, onNotify, request, onChange, editorMode } = props;
  const {
    pagePreviewAreaRef, availableComponents, ribbonCatalog, defaultRelatedLists,
    pendingInsertedRef, applyPage, openBuilderTabs, setRecentComponents, setSelectedId,
    setPageSettingsOpen, setActivePanel, setInspectorTab, componentNeedsData, setRibbonTab, fields,
    updateComponent, stringList, setDynamicFormsUpgradeOpen, selectionIds, selected,
    setSelectionIds, setSelectedRegion, setComponentMenuId, recordScope, targetObject,
    recordFormFactors, recordAppId, recordProfileId, recordTypeId, homeFormFactors, homeAppId,
    homeScope, homeProfileId, setComponentClipboard, componentClipboard, undoStack, setRedoStack,
    setUndoStack, setSelectionRedoStack, selectedId, setSelectionUndoStack, selectionUndoStack,
    redoStack, selectionRedoStack, previewMode, setGroupEditId,
  } = editorState;
  const { dynamicFormsEnabled, selectedMigrationLayout, assignedMigrationLayout } = componentProperties;
  const { moveLayer, ungroupSelected, wrapSelectedInContainer } = layoutActions;

  const hasOverlappingPageAssignment = (assignment: PageActivationAssignmentMetadata) =>
    (page.activationAssignments ?? []).some((existing) =>
      existing.scope === assignment.scope
      && existing.appId === assignment.appId
      && existing.profileId === assignment.profileId
      && existing.recordTypeId === assignment.recordTypeId
      && existing.formFactors.some((factor) => assignment.formFactors.includes(factor)));
  // A palette insertion must be discoverable even when the first vacancy is below the viewport.
  const pendingInsertedComponentRef = useRef<string | null>(null);
  useEffect(() => {
    const pendingId = pendingInsertedComponentRef.current;
    if (!pendingId || !page.components.some(item => item.id === pendingId)) return;
    const frame = window.requestAnimationFrame(() => {
      const node = Array.from(pagePreviewAreaRef.current?.querySelectorAll<HTMLElement>('[data-component-id]') ?? [])
        .find(item => item.dataset.componentId === pendingId);
      if (!node) return;
      node.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
      pendingInsertedComponentRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [page.components]);

  const componentNameHighWaterRef=useRef<Record<string,number>>({});
  const addComponent = async (type: string, position = page.components.length, region: 'header' | 'main' | 'sidebar' = 'main', canvasPosition?: PageComponentMetadata['position'], parentId: string | null = null) => {
    const customApiName = type.startsWith('Custom:') ? type.slice('Custom:'.length) : '';
    const custom = findRegisteredComponent(libraryComponents, customApiName, 'page');
    const dynamicFormComponent = type === 'Field Section' && page.pageType === 'Record Page';
    if (!availableComponents.includes(type) && !custom && !dynamicFormComponent && !isLayoutType(type)) {
      onNotify(`Enable the matching object feature before adding the ${type} component`);
      return;
    }
    const stem=componentNameStem(type);
    // SQL immutable versions retain deleted numbers. The draft revision guard
    // prevents concurrent editors from silently overwriting another saved name.
    let historical=0;
    try{
      const response=await request<{last:number}>(
        `/metadata/pages/${encodeURIComponent(page.apiName)}/component-name-history?stem=${encodeURIComponent(stem)}`);
      historical=Number.isSafeInteger(response.last)?response.last:0;
    }catch(error){
      onNotify(error instanceof Error?error.message:'Unable to allocate a component name');
      return;
    }
    const allocated=nextComponentInstanceName(page.components,type,
      Math.max(historical,componentNameHighWaterRef.current[stem]??0));
    const parsed=Number(allocated.slice(stem.length));
    componentNameHighWaterRef.current[stem]=Math.max(parsed,componentNameHighWaterRef.current[stem]??0);
    const id = `${type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID()}`;
    const components = [...page.components];
    const defaultWidth = Math.min(page.canvasWidth, custom?.resize?.defaultWidth ?? 320);
    const defaultHeight = Math.min(page.canvasHeight, custom?.resize?.defaultHeight ?? 180);
    // An inserted component is an independent sibling, not an invisible child
    // of the previous one. Find free canvas space instead of stacking every
    // 24px-offset component on top of its neighbours.
    const usedBounds = page.components.filter(item=>item.position && !rawLayoutParentId(item))
      .map(item=>item.position!);
    const viewport=pagePreviewAreaRef.current;
    const stage=viewport?.querySelector<HTMLElement>('.free-canvas-stage');
    const visible=viewport&&stage?visibleCanvasBounds(stage.getBoundingClientRect(),
      viewport.getBoundingClientRect(),page.canvasWidth,page.canvasHeight):undefined;
    const origin=canvasPosition??placeNewCanvasComponent({
      canvasWidth:page.canvasWidth,canvasHeight:page.canvasHeight,
      width:defaultWidth,height:defaultHeight,used:usedBounds,visible
    });
    const freeCanvasPosition = page.layoutMode === 'free-canvas'
      ? {x:Math.max(0,Math.min(origin.x,page.canvasWidth-defaultWidth)),
         y:Math.max(0,Math.min(origin.y,page.canvasHeight-defaultHeight)),
         width:defaultWidth,height:defaultHeight}
      : undefined;
    components.splice(Math.max(0, Math.min(position, components.length)), 0, {
      id, type, label: custom ? libraryComponentLabel(custom) : type,
      properties: custom
        ? { navigatorName:allocated,libraryComponentId: custom.apiName,
            ...(isBuilderApi(custom.apiName,ribbonCatalog?.components??[]) ?builderDefaults(custom.apiName,ribbonCatalog?.properties??[]):{}),
            ...Object.fromEntries((custom.propertyDefinitions??[]).filter(def=>Array.isArray(def.defaultValue)
              || (def.propertyKey==='layoutContainer'&&def.defaultValue===true))
              .map(def=>[def.propertyKey,Array.isArray(def.defaultValue)?[...def.defaultValue]:def.defaultValue])),
            ...(parentId ? { layoutParentId: parentId } : {}) }
        : type === 'Report Chart'
          ? { navigatorName:allocated,reportApiName: '' }
          : type === 'Dashboard'
            ? { navigatorName:allocated,dashboardApiName: '' }
          : type === 'Related List Quick Links'
            ? { relatedLists: defaultRelatedLists }
          : type === 'Rich Text'
            ? { content: '' }
          : type === 'List View'
            ? { listObjectApiName: page.targetObject, savedViewId: '', columns: [], pageSize: 25 }
          : type === 'Screen Flow'
            ? { flowApiName: '', inputRecordIdAs: '', embed: true }
          : type === 'Path'
            ? { stageFieldApiName: '' }
          : type === 'Related List'
            ? { relatedLists: defaultRelatedLists }
            : type === 'Field Section'
              ? { fieldApiNames: [], columns: 2 }
            : {},
      visible: true, parentId: parentId ?? undefined, region,
      ...(freeCanvasPosition ? { position: freeCanvasPosition } : {})
    });
    // Author a visible, editable border only for new components.
    const inserted = components.find(item => item.id === id)!;
    inserted.properties={...inserted.properties,navigatorName:allocated};
    const authored = inserted.properties.visualStyle && typeof inserted.properties.visualStyle === 'object'
      && !Array.isArray(inserted.properties.visualStyle)
      ? inserted.properties.visualStyle as Record<string,unknown> : {};
    inserted.properties = isLayoutType(type)
      ? {...inserted.properties,visualStyle:{...authored,borderWidth:1,borderColor:'#000000'}}
      : {...inserted.properties,borderWidth:1,borderColor:'#000000'};
    pendingInsertedRef.current=page.layoutMode==='free-canvas'?id:null;
    applyPage({ ...page, components: assignTabOnReparent(
      components,id,parentId,parentId ? openBuilderTabs[parentId] : undefined) });
    setRecentComponents(current => addRecentPageBlock(current, type));
    pendingInsertedComponentRef.current = id;
    setSelectedId(id);
    setPageSettingsOpen(false);
    setActivePanel('properties');
    setInspectorTab(componentNeedsData(type)?'Data & Actions':'Design');
    setRibbonTab('Component Design 2');
    onNotify(`${custom?libraryComponentLabel(custom):type} added and selected`);
  };
  const addField = (fieldApiName: string) => {
    if (dynamicFormsEnabled) {
      const field = fields.find((item) => item.apiName === fieldApiName);
      if (!field) return;
      const id = `record-field-${crypto.randomUUID()}`;
      const component: PageComponentMetadata = {
        id,
        type: 'Record Field',
        label: field.label,
        properties: { fieldApiName },
        visible: true,
        region: 'main'
      };
      applyPage({ ...page, components: [...page.components, component] });
      setSelectedId(id);
      setPageSettingsOpen(false);
      return;
    }
    const detail = page.components.find((component) => component.type === 'Record Detail');
    if (!detail) {
      const id = `record-detail-${crypto.randomUUID()}`;
      applyPage({ ...page, components: [...page.components, { id, type: 'Record Detail', label: 'Record Detail', properties: { fields: [fieldApiName] }, visible: true }] });
      setSelectedId(id);
      return;
    }
    const currentFields = Array.isArray(detail.properties.fields) ? detail.properties.fields.filter((value): value is string => typeof value === 'string') : [];
    const nextFields = currentFields.includes(fieldApiName) ? currentFields.filter((value) => value !== fieldApiName) : [...currentFields, fieldApiName];
    updateComponent(detail.id, { properties: { ...detail.properties, fields: nextFields } });
    setSelectedId(detail.id);
  };
  const addFieldToSection = (sectionId: string, fieldApiName: string) => {
    const section = page.components.find((component) => component.id === sectionId && component.type === 'Field Section');
    if (!section) {
      addField(fieldApiName);
      return;
    }
    const fieldApiNames = stringList(section.properties.fieldApiNames, []);
    if (fieldApiNames.includes(fieldApiName)) return;
    updateComponent(sectionId, { properties: { ...section.properties, fieldApiNames: [...fieldApiNames, fieldApiName] } });
    setSelectedId(sectionId);
    setPageSettingsOpen(false);
  };
  const moveSectionField = (sectionId: string, fieldIndex: number, offset: -1 | 1) => {
    const section = page.components.find((component) => component.id === sectionId && component.type === 'Field Section');
    if (!section) return;
    const fieldApiNames = stringList(section.properties.fieldApiNames, []);
    const nextIndex = fieldIndex + offset;
    if (nextIndex < 0 || nextIndex >= fieldApiNames.length) return;
    [fieldApiNames[fieldIndex], fieldApiNames[nextIndex]] = [fieldApiNames[nextIndex]!, fieldApiNames[fieldIndex]!];
    updateComponent(sectionId, { properties: { ...section.properties, fieldApiNames } });
  };
  const importLegacyRecordLayout = () => {
    if (!selectedMigrationLayout || page.pageType !== 'Record Page') return;
    if ((dynamicFormsEnabled || page.components.some(c=>c.type==='Record Actions'))
      && !window.confirm('Replace this device layout’s field sections, record actions and related lists with the selected legacy layout? Only this unpublished draft will change.')) return;
    applyPage({...page,components:legacyLayoutToRecordComponents(
      selectedMigrationLayout,page.components,page.layoutVariant??'Desktop')});
    setDynamicFormsUpgradeOpen(false);
    setPageSettingsOpen(true);
    onNotify('Legacy layout imported into this device draft. Review it, then Save and Publish.');
  };
  const upgradeRecordDetail = (_recordDetail: PageComponentMetadata) => importLegacyRecordLayout();
  const updateRecordPageControls = (next:Record<string,unknown>) => {
    const existing=page.components.find(component=>component.type==='Record Actions');
    if (existing) updateComponent(existing.id,{properties:{...existing.properties,...next}});
    else applyPage({...page,components:[...page.components,{
      id:'record-actions-'+crypto.randomUUID(),type:'Record Actions',label:'Record Actions',
      region:'header',visible:true,properties:{
        actions:[...(assignedMigrationLayout?.actions??['New','Edit','Delete'])],
        customLinks:[...(assignedMigrationLayout?.customLinks??[])],
        relatedListSettings:{...(assignedMigrationLayout?.relatedListSettings??{})},...next}
    }]});
  };
  const recordPageControls=page.components.find(component=>component.type==='Record Actions');
  const recordPageActionIds=Array.isArray(recordPageControls?.properties.actions)
    ?recordPageControls.properties.actions.filter((name):name is string=>typeof name==='string')
    :assignedMigrationLayout?.actions??['New','Edit','Delete'];
  const rawActionOverrides=recordPageControls?.properties.actionOverrides;
  const recordPageActionOverrides:Partial<Record<'Edit'|'Clone'|'Delete',string>>={};
  if(rawActionOverrides&&typeof rawActionOverrides==='object'&&!Array.isArray(rawActionOverrides)){
    for(const name of ['Edit','Clone','Delete'] as const){
      const id=(rawActionOverrides as Record<string,unknown>)[name];
      if(typeof id==='string')recordPageActionOverrides[name]=id;
    }
  }
  const rawActionVisibility=recordPageControls?.properties.actionVisibility;
  const recordPageActionVisibility:Record<string,{fieldApiName:string;equalsValue:string;operator?:'Equals'|'NotEquals'|'Contains'|'IsBlank'|'IsNotBlank'}>={}
  if(rawActionVisibility&&typeof rawActionVisibility==='object'&&!Array.isArray(rawActionVisibility))
    for(const [actionId,value] of Object.entries(rawActionVisibility)){
      if(!value||typeof value!=='object'||Array.isArray(value))continue;
      const item=value as Record<string,unknown>;
      if(typeof item.fieldApiName==='string'&&typeof item.equalsValue==='string'
        &&(item.operator===undefined||['Equals','NotEquals','Contains','IsBlank','IsNotBlank'].includes(String(item.operator))))
        recordPageActionVisibility[actionId]={fieldApiName:item.fieldApiName,equalsValue:item.equalsValue,
          ...(item.operator!==undefined?{operator:item.operator as 'Equals'|'NotEquals'|'Contains'|'IsBlank'|'IsNotBlank'}:{})};
    }
  const recordPageLinks=Array.isArray(recordPageControls?.properties.customLinks)
    ?recordPageControls.properties.customLinks.filter((item):item is PageLayoutCustomLinkMetadata=>
      Boolean(item&&typeof item==='object'&&typeof item.id==='string'&&typeof item.url==='string'
        &&typeof item.label==='string'&&typeof item.openInNewWindow==='boolean'))
    :assignedMigrationLayout?.customLinks??[];
  const rawRecordListSettings=recordPageControls?.properties.relatedListSettings;
  const recordPageRelatedSettings:Record<string,RecordListSetting>=
    rawRecordListSettings&&typeof rawRecordListSettings==='object'&&!Array.isArray(rawRecordListSettings)
      ?rawRecordListSettings as Record<string,RecordListSetting>
      :assignedMigrationLayout?.relatedListSettings??{};
  const updateRecordPageRelatedList=(name:string,settings:RecordListSetting)=>{
    updateRecordPageControls({relatedListSettings:{
      ...recordPageRelatedSettings,[name]:{...(recordPageRelatedSettings[name]??{}),...settings}
    }});
  };
  const deleteTargetIds = selectionIds.length > 1 ? selectionIds : selected ? [selected.id] : [];
  const deleteTargets = page.components.filter(component => deleteTargetIds.includes(component.id));
  const deleteBlockedByLock = deleteTargets.some(isCanvasLocked);
  const removeSelected = () => {
    if (!deleteTargets.length) {
      onNotify('Select a component to remove');
      return;
    }
    const result = removePageComponentSelection(page.components, deleteTargetIds);
    if (result.locked.length) {
      onNotify('Unlock all '+result.locked.length+' locked selected component(s) before deleting. Nothing was removed.');
      return;
    }
    if (!result.removed) return;
    const plural = result.removed > 1;
    if (!confirmDestructiveAction('Delete',
      plural ? result.removed+' selected page components' : 'Page component "'+deleteTargets[0].label+'"',
      (plural ? 'All selected components' : 'The component')+
      ' will be removed from this layout draft. Save and publish to make the change live.')) return;
    // One history snapshot and one change, so Undo restores the whole selection.
    applyPage({ ...page, components: result.components });
    setSelectionIds([]);
    setSelectedId('');
    setSelectedRegion(null);
    setComponentMenuId('');
    onNotify((plural ? result.removed+' components' : 'Component')+
      ' removed from draft. Save the page to keep this change.');
  };
  const addRecordAssignment = () => {
    const needsApp = recordScope !== 'Org Default';
    const needsProfile = recordScope === 'App and Profile' || recordScope === 'App, Record Type, and Profile';
    const needsRecordType = recordScope === 'App, Record Type, and Profile';
    const availableRecordTypes = (targetObject?.recordTypes ?? []).filter((recordType) => recordType.active);
    const formFactors = recordFormFactors.filter((factor) => factor === 'Tablet' || factor === 'Custom' || page.devices.includes(factor));
    if (!formFactors.length
      || (needsApp && !recordAppId)
      || (needsProfile && !recordProfileId)
      || (needsRecordType && !availableRecordTypes.some((recordType) => recordType.id === recordTypeId))) {
      onNotify('Choose all required assignment values and at least one supported form factor');
      return;
    }
    const assignment: PageActivationAssignmentMetadata = {
      id: `record-activation-${crypto.randomUUID()}`,
      scope: recordScope,
      appId: needsApp ? recordAppId : null,
      profileId: needsProfile ? recordProfileId : null,
      recordTypeId: needsRecordType ? recordTypeId : null,
      formFactors
    };
    if (hasOverlappingPageAssignment(assignment)) {
      onNotify('An activation assignment already exists for this target and form factor');
      return;
    }
    applyPage({ ...page, activationAssignments: [...(page.activationAssignments ?? []), assignment] });
  };
  const addHomeAssignment = () => {
    const formFactors = homeFormFactors.filter((factor) => factor === 'Tablet' || factor === 'Custom' || page.devices.includes(factor));
    if (!homeAppId || !formFactors.length || (homeScope === 'App and Profile' && !homeProfileId)) {
      onNotify('Choose an app, form factor, and profile when required');
      return;
    }
    const assignment: PageActivationAssignmentMetadata = {
      id: `home-activation-${crypto.randomUUID()}`,
      scope: homeScope,
      appId: homeAppId,
      profileId: homeScope === 'App and Profile' ? homeProfileId : null,
      recordTypeId: null,
      formFactors
    };
    if (hasOverlappingPageAssignment(assignment)) {
      onNotify('An activation assignment already exists for this app, profile, and form factor');
      return;
    }
    applyPage({ ...page, activationAssignments: [...(page.activationAssignments ?? []), assignment] });
  };
  const removePageAssignment = (id: string) => {
    const activationAssignments = (page.activationAssignments ?? []).filter((assignment) => assignment.id !== id);
    applyPage({
      ...page,
      activationAssignments,
      status: page.status === 'Active' && !activationAssignments.length ? 'Draft' : page.status
    });
  };
  const copySelected = () => {
    if (selected) setComponentClipboard(copyComponentTree(page.components, selected.id));
  };
  const cutSelected = () => {
    if (!selected || isCanvasLocked(selected)) return;
    const snapshot=copyComponentTree(page.components,selected.id);
    setComponentClipboard(snapshot);
    const removedIds=new Set(snapshot.components.map(item=>item.id));
    applyPage({...page,components:page.components.filter(item=>!removedIds.has(item.id))});
    setSelectedId('');
  };
  const pasteComponent = () => {
    if (!componentClipboard) return;
    // Match Insert and the runtime: a selected layout container is the paste
    // destination; selecting its child pastes a sibling inside that container.
    const parentId=selected
      ? (isLayoutContainer(selected) ? selected.id : rawLayoutParentId(selected))
      : null;
    if (parentId && !page.components.some(item=>item.id===parentId && isLayoutContainer(item))) {
      onNotify('Select a valid container before pasting inside it.');
      return;
    }
    const cloned=cloneComponentTree(componentClipboard,parentId);
    const root=cloned.components.find(item=>item.id===cloned.rootId)!;
    const position=root.position ? {
      ...root.position,
      // Nested content flows inside the container, not at its former page
      // coordinates. Retain dimensions and a useful local position for unnest.
      x:parentId?16:Math.max(0,Math.min(page.canvasWidth-root.position.width,root.position.x+24)),
      y:parentId?16:Math.max(0,Math.min(page.canvasHeight-root.position.height,root.position.y+24))
    }:undefined;
    const inserted=cloned.components.map(item=>item.id===root.id?{...item,position,region:selected?.region??item.region}:item);
    const originalIndex=selected?page.components.findIndex(item=>item.id===selected.id):-1;
    const components=[...page.components];
    components.splice(originalIndex<0?components.length:originalIndex+1,0,...inserted);
    // The same shared nesting contract is used for paste, palette insertion,
    // drag-and-drop and published runtime. Preserve active Tabs membership.
    applyPage({...page,components:assignTabOnReparent(components,cloned.rootId,parentId,
      parentId?openBuilderTabs[parentId]:undefined)});
    setSelectedId(cloned.rootId);
    setSelectionIds([cloned.rootId]);
    pendingInsertedComponentRef.current=cloned.rootId;
  };
  const duplicateSelected = () => {
    if (!selected || isCanvasLocked(selected)) return;
    const snapshot=copyComponentTree(page.components,selected.id);
    const clone=cloneComponentTree(snapshot,rawLayoutParentId(selected));
    const ids=new Set(snapshot.components.map(item=>item.id));
    const lastIndex=page.components.reduce((last,item,index)=>ids.has(item.id)?index:last,-1);
    const components=[...page.components];
    components.splice(lastIndex+1,0,...clone.components);
    applyPage({...page,components});
    setSelectedId(clone.rootId);
    setSelectionIds([clone.rootId]);
    setComponentMenuId('');
  };
  const alignSelected = (axis: 'x' | 'y', anchor: 'start' | 'center' | 'end') => {
    const targets = page.components.filter(component =>
      selectionIds.includes(component.id) && component.position
      && !rawLayoutParentId(component) && !isCanvasLocked(component));
    const selectedTargets = targets.length > 1 ? targets
      : selected?.position && !isCanvasLocked(selected)
        ? [selected] : [];
    if (!selectedTargets.length) return;
    const aligned = alignCanvasComponents(page.components, selectedTargets.map(component => component.id),
      axis, anchor, { width: page.canvasWidth, height: page.canvasHeight });
    applyPage({ ...page, components: aligned });
  };
  const distributeSelected = (axis: 'x'|'y') => {
    if (selectionIds.length < 3) return;
    applyPage({...page,components:distributeCanvasComponents(page.components,selectionIds,axis)});
  };
  const moveSelected = (offset: -1 | 1) => { if (selected) moveLayer(selected.id, offset); };
  const undo = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setRedoStack(current => [...current, page]);
    setUndoStack(current => current.slice(0, -1));
    setSelectionRedoStack(current => [...current, { selectedId, selectionIds: [...selectionIds] }]);
    setSelectionUndoStack(current => current.slice(0, -1));
    onChange(previous);
    const previousIds = new Set(previous.components.map(component => component.id));
    const snapshot = selectionUndoStack[selectionUndoStack.length - 1];
    const restoredSelection = (snapshot?.selectionIds ?? selectionIds).filter(id => previousIds.has(id));
    setSelectionIds(restoredSelection);
    const requestedId = snapshot?.selectedId ?? selectedId;
    setSelectedId(previousIds.has(requestedId) ? requestedId : (restoredSelection[0] ?? ''));
  };
  const redo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setUndoStack(current => [...current, page]);
    setRedoStack(current => current.slice(0, -1));
    setSelectionUndoStack(current => [...current, { selectedId, selectionIds: [...selectionIds] }]);
    setSelectionRedoStack(current => current.slice(0, -1));
    onChange(next);
    const nextIds = new Set(next.components.map(component => component.id));
    const snapshot = selectionRedoStack[selectionRedoStack.length - 1];
    const restoredSelection = (snapshot?.selectionIds ?? selectionIds).filter(id => nextIds.has(id));
    setSelectionIds(restoredSelection);
    const requestedId = snapshot?.selectedId ?? selectedId;
    setSelectedId(nextIds.has(requestedId) ? requestedId : (restoredSelection[0] ?? ''));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if(!editorMode)return;
      const target = event.target;
      if (event.defaultPrevented || (target instanceof HTMLElement &&
        (['INPUT','TEXTAREA','SELECT'].includes(target.tagName) || target.isContentEditable))) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && key === 'a' && !event.altKey && !event.shiftKey &&
        !previewMode && page.components.length > 0 &&
        !(target instanceof HTMLElement && target.closest('[role="dialog"],[aria-modal="true"]'))) {
        // Select every component in the active layout (including nested, hidden,
        // and locked components) through the existing multi-selection state.
        // No page metadata is changed, and text editors keep native Ctrl/Cmd+A.
        event.preventDefault();
        const allIds = page.components.map(component => component.id);
        setSelectionIds(allIds);
        setSelectedId(current => allIds.includes(current) ? current : allIds[0]);
        setSelectedRegion(null);
        setPageSettingsOpen(false);
        setComponentMenuId('');
      } else if (command && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (command && key === 'y') {
        event.preventDefault(); redo();
      } else if (command && key === 'c' && selected && !previewMode) {
        event.preventDefault(); copySelected();
      } else if (command && key === 'x' && selected && !previewMode && !isCanvasLocked(selected)) {
        event.preventDefault(); cutSelected();
      } else if (command && key === 'v' && componentClipboard && !previewMode) {
        event.preventDefault(); pasteComponent();
      } else if (command && key === 'd' && selected && !previewMode) {
        event.preventDefault(); duplicateSelected();
      } else if (!command && (event.key === 'Delete' || event.key === 'Backspace')
        && selected && !previewMode) {
        event.preventDefault(); removeSelected();
      } else if (command && key === 'g' && !previewMode && page.layoutMode === 'free-canvas') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelected();
        else wrapSelectedInContainer();
      } else if(event.key==='Escape'&&!previewMode){
        setSelectedId('');setSelectionIds([]);setGroupEditId('');
        setSelectedRegion(null);setComponentMenuId('');
      } else if(!previewMode&&page.layoutMode==='free-canvas'
        &&!event.altKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        const ids=selectionIds.length?selectionIds:(selectedId?[selectedId]:[]);
        if(!ids.length)return;
        if(target instanceof HTMLElement&&target.closest('.office-builder-ribbon,button,[role="tab"],[role="dialog"]'))return;
        event.preventDefault();
        const step=event.shiftKey?10:1;
        const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0;
        const dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
        const next=translateCanvasSelection(page.components,ids,dx,dy,
          {width:page.canvasWidth,height:page.canvasHeight});
        if(next.some((item,index)=>item!==page.components[index]))
          applyPage({...page,components:next});
      }
    };
    // Capture first: embedded Smart controls may stop bubbling. Preserve
    // native copy/cut/paste for focused text inputs via the guard above.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return {
    addComponent, addField, addFieldToSection, moveSectionField, importLegacyRecordLayout,
    upgradeRecordDetail, updateRecordPageControls, recordPageActionIds, recordPageActionOverrides,
    recordPageActionVisibility, recordPageLinks, recordPageRelatedSettings, updateRecordPageRelatedList,
    deleteTargets, deleteBlockedByLock, removeSelected, addRecordAssignment, addHomeAssignment,
    removePageAssignment, copySelected, cutSelected, pasteComponent, duplicateSelected, alignSelected,
    distributeSelected, moveSelected, undo, redo,
  };
}
