import * as React from 'react';
import { useEffect } from 'react';
import { isCanvasLocked, ungroupCanvasComponent } from '../../canvasInteractions';
import {
canvasGroupKey, groupCanvasSelection, ungroupCanvasSelection, moveCanvasLayer, shiftCanvasLayer,
} from '../../canvasLayerGroups';
import { childrenOf } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { type LightningPageMetadata, type PageLayoutVariant } from '../../../../metadata/Definitions/metadata';

import type { PageBuilderProps } from '../PageBuilderTypes';
import {takePrefetchedPageEditorDraft} from '../../../../authentication/Client/authClient';
import type { usePageEditorState } from '../usePageEditorState';
import type { usePageComponentProperties } from '../inspector/usePageComponentProperties';

export function usePageLayoutActions(
  props: PageBuilderProps,
  editorState: ReturnType<typeof usePageEditorState>,
  componentProperties: ReturnType<typeof usePageComponentProperties>,
) {
  const {
    page, editorMode, initialLayoutVariant, request, onChange, onNotify, onLayoutVariantChange,
    onSelectPage, onBackToPages, pages, objects, onTargetObjectChange,
  } = props;
  const {
    setPaletteTab, builderAppApiName, setRecordAppId, loadedEditorVariantRef, switchingLayout,
    undoStack, setSwitchingLayout, setSelectedId, setSelectionIds, setUndoStack, setRedoStack,
    setSelectionUndoStack, setSelectionRedoStack, setSavedFeedback, setShowLayoutHistory,
    setFitCanvas, savedPageApiName, setLayoutVersions, setSelectedHistoryVersion,
    setMigrationLayoutId, applyPage, selected, selectionIds, paletteResizeStart,
    componentPanelWidth, setComponentPanelWidth, setCustomPropertiesDraft, updateComponent,
    setCustomPropertiesError,
  } = editorState;
  const { selectedGroupMembers } = componentProperties;

  useEffect(() => {
    if (page.pageType !== 'Record Page') setPaletteTab('Components');
  }, [page.pageType]);
  useEffect(() => {
    if (builderAppApiName) setRecordAppId(builderAppApiName);
  }, [builderAppApiName]);
  /** Editor metadata is separate from the published runtime snapshot. */
  useEffect(() => {
    if (!editorMode) return;
    let active=true;
    const variant=initialLayoutVariant??page.layoutVariant??'Desktop';
    // A user-initiated device switch already fetched this draft. Do not fetch
    // it a second time when the deep-link changes and overwrite new edits.
    if(loadedEditorVariantRef.current===variant)return;
    void takePrefetchedPageEditorDraft<{page:LightningPageMetadata}>(
      `/metadata/pages/${encodeURIComponent(page.apiName)}/layouts/${variant}/editor`,request)
      .then(result => {if(active){loadedEditorVariantRef.current=variant;onChange(result.page);}})
      .catch(error => {if(active)onNotify(error instanceof Error?error.message:'Unable to load page draft');});
    return ()=>{active=false;};
  },[editorMode,page.apiName,initialLayoutVariant]);
  const switchLayoutVariant=async(variant:'Mobile'|'Desktop'|'Tablet'|'Custom'):Promise<boolean>=>{
    if((page.layoutVariant??'Desktop')===variant)return true;
    if(switchingLayout)return false;
    if(undoStack.length&&!window.confirm('Discard unsaved edits on this layout? Save before switching.'))return false;
    setSwitchingLayout(true);
    try {
      const {page:layout}=await request<{page:LightningPageMetadata}>(
        `/metadata/pages/${encodeURIComponent(page.apiName)}/layouts/${variant}/editor`);
      loadedEditorVariantRef.current=variant;
      onChange(layout);
      onLayoutVariantChange?.(variant);
      setSelectedId(layout.components[0]?.id??'');
      setSelectionIds(layout.components[0]?[layout.components[0].id]:[]);
      setUndoStack([]);setRedoStack([]);setSelectionUndoStack([]);setSelectionRedoStack([]);
      setSavedFeedback(false);setShowLayoutHistory(false);setFitCanvas(true);
      return true;
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to change layout');return false;}
    finally{setSwitchingLayout(false);}
  };
  /** Open selected device drafts from Page Details with the guarded shared editor. */
  const openPageDesignLayout=async(apiName:string,variant:PageLayoutVariant):Promise<boolean>=>{
    if(editorMode&&page.apiName===apiName)return switchLayoutVariant(variant);
    if(!confirmDiscardPageChanges())return false;
    try{
      const {page:layout}=await request<{page:LightningPageMetadata}>(
        `/metadata/pages/${encodeURIComponent(apiName)}/layouts/${variant}/editor`);
      savedPageApiName.current=apiName;
      onSelectPage(apiName);
      onChange(layout);
      onLayoutVariantChange?.(variant,apiName);
      return true;
    }catch(error){
      onNotify(error instanceof Error?error.message:'Unable to open the chosen page layout');
      return false;
    }
  };
  const loadLayoutHistory=async()=>{
    try{
      const result=await request<{versions:Array<{version:number;createdAt:string;published:boolean;draft:boolean}>}>(
        `/metadata/pages/${encodeURIComponent(page.apiName)}/layouts/${page.layoutVariant??'Desktop'}/history`);
      setLayoutVersions(result.versions);setShowLayoutHistory(true);setSelectedHistoryVersion(result.versions.find(item=>!item.draft)?.version??null);
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to load layout history');}
  };
  const restoreLayoutVersion=async(version:number)=>{
    if(!window.confirm('Restore this version to your draft? The live layout stays unchanged until you publish.'))return;
    try{
      const {page:restored}=await request<{page:LightningPageMetadata}>(
        `/metadata/pages/${encodeURIComponent(page.apiName)}/layouts/${page.layoutVariant??'Desktop'}/restore`,{
          method:'POST',body:JSON.stringify({version})
        });
      onChange(restored);setUndoStack([]);setRedoStack([]);setSelectionUndoStack([]);
      setSelectionRedoStack([]);setSavedFeedback(true);
      await loadLayoutHistory();
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to restore page layout');}
  };
  const confirmDiscardPageChanges = () =>
    !editorMode || !undoStack.length ||
    window.confirm('Discard unsaved Page Builder edits?');
  useEffect(()=>{
    if(!editorMode||!undoStack.length)return;
    const preventClose=(event:BeforeUnloadEvent)=>{
      event.preventDefault();
      event.returnValue='';
    };
    window.addEventListener('beforeunload',preventClose);
    return ()=>window.removeEventListener('beforeunload',preventClose);
  },[editorMode,undoStack.length]);
  const safeBackToPages=()=>{if(confirmDiscardPageChanges())onBackToPages();};
  const selectSavedPage = (apiName: string) => {
    if(!confirmDiscardPageChanges())return;
    savedPageApiName.current = apiName;
    onSelectPage(apiName);
  };
  const changeTargetObject = (apiName: string) => {
    if(!confirmDiscardPageChanges())return;
    const existingPage = pages.find((item) => item.pageType === 'Record Page' && item.targetObject === apiName);
    const nextApiName = existingPage?.apiName ?? `${apiName.replace(/__c$/, '')}_Record_Page`;
    const nextObject = objects.find((item) => item.apiName === apiName);
    savedPageApiName.current = nextApiName;
    setMigrationLayoutId(nextObject?.pageLayoutAssignments?.[0]?.pageLayoutId ?? nextObject?.pageLayouts?.[0]?.id ?? '');
    onTargetObjectChange(apiName);
  };
  const moveLayer = (id: string, offset: -1 | 1) => {
    applyPage({...page,components:shiftCanvasLayer(page.components,id,offset)});
  };
  const placeSelectedLayer = (edge: 'front'|'back') => {
    if (selected && !isCanvasLocked(selected))
      applyPage({...page,components:moveCanvasLayer(page.components,selected.id,edge)});
  };
  const wrapSelectedInContainer = () => {
    if (page.layoutMode !== 'free-canvas' || selectionIds.length < 2) return;
    const next = groupCanvasSelection(page.components,selectionIds,'group-' + crypto.randomUUID());
    if (next.every((item,index) => item === page.components[index])) {
      onNotify('Select two or more unlocked components in the same parent to group.');
      return;
    }
    applyPage({...page,components:next});
  };
  const ungroupSelected = () => {
    if (!selected || isCanvasLocked(selected)) return;
    if (canvasGroupKey(selected)) {
      if(selectedGroupMembers.some(isCanvasLocked))return;
      applyPage({...page,components:ungroupCanvasSelection(page.components,selected.id)});
      setSelectionIds([selected.id]);
      return;
    }
    if (selected.type !== 'Container') return;
    const children = childrenOf(page.components,selected.id);
    if (!children.length || children.some(isCanvasLocked)) return;
    applyPage({...page,components:ungroupCanvasComponent(page.components,selected.id)});
    setSelectedId(children[0].id);
  };
  const startComponentPanelResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    paletteResizeStart.current = { pointerId: event.pointerId, pointerX: event.clientX, width: componentPanelWidth };
  };
  const moveComponentPanelResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = paletteResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setComponentPanelWidth(Math.min(528, Math.max(264, start.width + event.clientX - start.pointerX)));
  };
  const endComponentPanelResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (paletteResizeStart.current?.pointerId === event.pointerId) paletteResizeStart.current = null;
  };
  const updateCustomProperties = (value: string) => {
    setCustomPropertiesDraft(value);
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Properties must be a JSON object.');
      }
      if (selected) updateComponent(selected.id, { properties: parsed as Record<string, unknown> });
      setCustomPropertiesError('');
    } catch (failure) {
      setCustomPropertiesError(failure instanceof Error ? failure.message : 'Enter valid JSON properties.');
    }
  };

  return {
    switchLayoutVariant, openPageDesignLayout, loadLayoutHistory, restoreLayoutVersion, safeBackToPages,
    selectSavedPage, moveLayer, placeSelectedLayer, wrapSelectedInContainer, ungroupSelected,
  };
}
