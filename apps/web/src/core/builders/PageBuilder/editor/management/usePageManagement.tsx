import { availableComponentSettings, resolveComponentSettings, validateComponentSettings } from '../../../../components/Properties/componentSettingDefinitions';
import { pagePropertyIssues } from '../../../../components/Properties/pagePropertyContract';
import { generateMetadataApiName, metadataNameConflictExcept, suggestMetadataApiName } from '../../../../metadata/Definitions/metadataApiNames';
import { reconcileNavigationOrder } from '../../../../workspace/Navigation/appNavigation';
import { useEffect } from 'react';
import { duplicatePageComponentId } from '../../componentIdentity';
import { remapComponentInteractionTargets } from '../../pageComponentTree';
import { findRegisteredComponent } from '../../../../components/Registry/componentRegistryLookup';
import { type LightningPageMetadata, type PageLayoutVariant } from '../../../../metadata/Definitions/metadata';
import { designedPageLayouts, primaryPageLayout } from '../../pageLayoutSummary';
import { pageActivationAppCandidates, resolvePageActivationApp } from '../../pageAppMembership';
import { compilePage } from '../../../../pages/PageCompiler/compilePage';
import { downloadCode } from '../../../../pages/PageCompiler/downloadPageScript';
import { fetchServerPageScriptSource } from '../../../../pages/PageCompiler/serverPageScript';

import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageEditorState } from '../usePageEditorState';
import type { usePageLayoutActions } from './usePageLayoutActions';

export function usePageManagement(
  props: PageBuilderProps,
  editorState: ReturnType<typeof usePageEditorState>,
  layoutActions: ReturnType<typeof usePageLayoutActions>,
) {
  const {
    page, onNotify, libraryComponents, pages, apps, preparedAppId, onSave, onPublish, onSaveApp,
    onAppLinked, onBackToPages, request, onDeletePage, recordPageContext, editorMode, objects,
    onPrepareApp,
  } = props;
  const {
    savedPageApiName, builderAppApiName, setSaving, setSavedFeedback, setUndoStack,
    setSelectionUndoStack, setSelectionRedoStack, setRedoStack, saving, undoStack,
    setShowLayoutHistory, setSelectedId, setPageSettingsOpen, setPreviewMode,
    setArchivingPageApiName, setPendingArchivePageApiName, pageListTypeTab, pageListAppTab,
    pageListDeviceTab, pageListObject, pageListSearch, pageListSort, pageListSortDescending,
    pageListPage, fetchLayoutSummaries, layoutSummaries, applyPage, setLayoutCopySource,
    inventoryDownloading, inventoryExportVariant, setInventoryDownloading, setNewPageAppId,
    setNewPageTargetObject, setNewPageLayoutMode, setNewPageType, setNewPageDeviceChoice,
    setNewPageDevices, setNewPageCanvasWidth, setNewPageCanvasHeight, setCreatePageOpen,
    newPageLabel, newPageType, newPageTargetObject, newPageDevices, newRecordMode,
    newPageLayoutMode, newPageTemplate, newPageDeviceChoice, newPageCanvasWidth,
    newPageCanvasHeight, newPageAppId, setBuilderAppApiName, setNewPageLabel,
  } = editorState;
  const { selectSavedPage, openPageDesignLayout } = layoutActions;

  const savePage = async (status?: 'Active' | 'Draft', candidate: LightningPageMetadata = page,
    returnToList = false, listActivation = false) => {
    const duplicateId=duplicatePageComponentId(candidate.components);
    if(duplicateId){onNotify(duplicateId);return;}
    const propertyIssues=candidate.components.flatMap(c=>{
      const definition=c.type.startsWith('Custom:')?findRegisteredComponent(libraryComponents,c.type.slice(7),'page'):undefined;
      const definitions=availableComponentSettings(definition?.propertyDefinitions??[],candidate.layoutVariant??'Desktop',definition?.version);
      return [...pagePropertyIssues(c.type,c.properties),...validateComponentSettings(definitions.filter(d=>d.schemaVersion===1),resolveComponentSettings(definitions,c.properties??{}))]
        .map(issue=>c.label+': '+issue.path+' '+issue.message);
    });
    if(propertyIssues.length){onNotify(propertyIssues.join('; '));return;}
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(candidate.apiName)) {
      onNotify('API Name must start with a letter and contain only letters, numbers, and underscores');
      return;
    }
    // When activating a list row, its persisted identity is that row, not the open editor page.
    const previousApiName = listActivation ? candidate.apiName : savedPageApiName.current;
    if (metadataNameConflictExcept(candidate.apiName, pages.map(item => item.apiName), previousApiName)) {
      onNotify('A Lightning page with this API name already exists');
      return;
    }
    if (status === 'Active' && candidate.pageType === 'Record Page' && !candidate.activationAssignments?.length) {
      onNotify('Add at least one activation assignment before activating this record page');
      return;
    }
    if (status === 'Active' && candidate.pageType === 'Home Page' && !candidate.activationAssignments?.length) {
      onNotify('Assign this Home Page to an app or app and profile before activating it');
      return;
    }
    if (status === 'Active' && candidate.pageType === 'App Page' && apps.length === 0) {
      onNotify('Create a Lightning app before activating an App Page');
      return;
    }
    const nextPage = status ? { ...candidate, status } : candidate;
    // List activation uses this row's persisted membership, never a different open page.
    const preferredAppId = listActivation
      ? (pageListAppTab !== 'all' && pageListAppTab !== 'other' ? pageListAppTab : '')
      : (builderAppApiName || preparedAppId);
    const targetAppId = status === 'Active' && nextPage.pageType === 'App Page'
      ? resolvePageActivationApp(apps, nextPage, preferredAppId, !listActivation) : null;
    if (status === 'Active' && nextPage.pageType === 'App Page') {
      if (!targetAppId) {
        const associations = pageActivationAppCandidates(apps, nextPage);
        onNotify(associations.length > 1
          ? 'This page belongs to multiple applications. Choose an application tab before activating it.'
          : 'Assign this App Page to an installed application in Edit Page before activating it.');
        return;
      }
      if (!(nextPage.activationAssignments ?? []).some(item => item.appId === targetAppId)) {
        nextPage.activationAssignments = [...(nextPage.activationAssignments ?? []), {
          id: crypto.randomUUID(), scope: 'App Default', appId: targetAppId,
          profileId: null, recordTypeId: null, formFactors: [...nextPage.devices]
        }];
      }
    }
    setSaving(true);
    try {
      const saved = await onSave(nextPage, previousApiName);
      if (saved) {
        // Save = compile: formulas, data loads and actions are rebuilt from the saved metadata.
        const compiled=compilePage(nextPage,objects);
        const errors=compiled.diagnostics.filter(entry=>entry.level==='error');
        if(errors.length){
          const label=(id:string)=>nextPage.components.find(item=>item.id===id)?.label||id;
          onNotify('Saved. '+errors.length+' formula error'+(errors.length===1?'':'s')+' to fix: '
            +errors.slice(0,3).map(entry=>label(entry.componentId)+' → '+entry.message).join('; ')+(errors.length>3?' …':''));
        }
        // Save already applies active-page edits live. Only the initial
        // activation of a draft page needs a separate publish request.
        if (status === 'Active' && saved.draftRevision !== saved.publishedRevision) {
          const published=await onPublish(nextPage.apiName,nextPage.layoutVariant??'Desktop',saved.draftRevision||undefined);
          if(!published)return;
        }
        if (status === 'Active' && nextPage.pageType === 'App Page') {
          const destinationApp = apps.find(item => item.apiName === targetAppId);
          if (destinationApp && !destinationApp.navigationPageApiNames.includes(nextPage.apiName)) {
            const navigationPageApiNames = [...destinationApp.navigationPageApiNames, nextPage.apiName];
            try {
              await onSaveApp({
                ...destinationApp, navigationPageApiNames,
                navigationOrder: reconcileNavigationOrder(
                  destinationApp.navigationItems, navigationPageApiNames, destinationApp.navigationOrder
                )
              }, true);
              onAppLinked(nextPage.apiName);
            } catch (error) {
              onNotify(error instanceof Error ? error.message : 'Page activated, but app navigation could not be updated');
            }
          } else if (destinationApp) onAppLinked(nextPage.apiName);
        }
        // Saving a different list row must not change the editor's persisted page identity.
        if (!listActivation) {
          savedPageApiName.current = nextPage.apiName;
          setSavedFeedback(true);
          setUndoStack([]);
          setSelectionUndoStack([]);
          setSelectionRedoStack([]);
          setRedoStack([]);
          if (returnToList) onBackToPages();
        }
        return saved;
      }
    } finally {
      setSaving(false);
    }
  };
  /** Activate a list row from its latest authored device draft, not the list's Desktop summary. */
  const activateListedPage=async(item:LightningPageMetadata)=>{
    if(saving)return;
    setSaving(true);
    try{
      const summary=layoutSummaries[item.apiName]??(await fetchLayoutSummaries([item.apiName]))
        .find(row=>row.apiName===item.apiName);
      const variant=primaryPageLayout(summary);
      const {page:current}=await request<{page:LightningPageMetadata}>(
        `/metadata/pages/${encodeURIComponent(item.apiName)}/layouts/${variant}/editor`);
      if(current.status==='Active'){
        onNotify('This page is already active. Refresh the list to see its current status.');
        return;
      }
      await savePage('Active',current,false,true);
    }catch(error){
      onNotify(error instanceof Error?error.message:'Unable to load the page layout for activation');
    }finally{setSaving(false);}
  };
  const publishCurrentLayout=async()=>{
    if(saving)return;
    if(undoStack.length||!page.draftRevision){
      const saved=await savePage();
      if(!saved)return;
      const published=await onPublish(saved.apiName,saved.layoutVariant??'Desktop',saved.draftRevision||undefined);
      if(published){setSavedFeedback(true);setShowLayoutHistory(false);}
      return;
    }
    setSaving(true);
    try{
      const published=await onPublish(page.apiName,page.layoutVariant??'Desktop',page.draftRevision);
      if(published){setSavedFeedback(true);setShowLayoutHistory(false);}
    }finally{setSaving(false);}
  };
  const clonePage = async () => {
    const baseApiName = `${page.apiName}_Copy`;
    let apiName = baseApiName;
    let suffix = 2;
    while (pages.some((item) => item.apiName.toLowerCase() === apiName.toLowerCase())) {
      apiName = `${baseApiName}_${suffix}`;
      suffix += 1;
    }
    const clonedIds = new Map<string,string>(page.components.map(component => [component.id, `${component.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID()}`] as const));
    const cloned: LightningPageMetadata = {
      ...structuredClone(page),
      revision: undefined,
      apiName,
      label: `${page.label} Copy`,
      updatedAt: undefined,
      status: 'Draft',
      activationAssignments: [],
      components: page.components.map((component) => {
        const properties={...component.properties,
          ...(typeof component.properties?.layoutParentId === 'string'
            ? { layoutParentId: clonedIds.get(component.properties.layoutParentId) ?? component.properties.layoutParentId }
            : {})};
        return {...component,id:clonedIds.get(component.id)!,
          parentId:component.parentId?clonedIds.get(component.parentId)??component.parentId:component.parentId,
          properties};
      })
    };
    cloned.components=remapComponentInteractionTargets(cloned.components,clonedIds);
    setSaving(true);
    try {
      const saved = await onSave(cloned, apiName, 'Lightning page cloned as a new draft');
      if (saved) {
        savedPageApiName.current = apiName;
        // A page clone includes every independently authored form factor, not
        // only the variant currently open. Keep the clone unpublished.
        const sourcePageName=page.apiName;
        const variants=['Mobile','Desktop','Tablet','Custom'] as const;
        try {
          for(const variant of variants){
            if(variant===(page.layoutVariant??'Desktop'))continue;
            const loaded=await request<{page:LightningPageMetadata}>(
              `/metadata/pages/${encodeURIComponent(sourcePageName)}/layouts/${variant}/editor`);
            const source=loaded.page;
            const ids=new Map(source.components.map(item=>[item.id,
              item.type.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+crypto.randomUUID()]));
            const components=source.components.map(item=>({
              ...structuredClone(item),
              id:ids.get(item.id)!,
              parentId:item.parentId?(ids.get(item.parentId)??item.parentId):undefined,
              properties:{...structuredClone(item.properties),
                ...(typeof item.properties.layoutParentId==='string'
                  ?{layoutParentId:ids.get(item.properties.layoutParentId)??item.properties.layoutParentId}:{})}
            }));
            await request(`/metadata/pages/${encodeURIComponent(apiName)}/layouts/${variant}/draft`,{
              method:'PUT',
              body:JSON.stringify({...source,apiName,label:cloned.label,status:'Draft',
                activationAssignments:[],components,draftRevision:1,publishedRevision:0})
            });
          }
        }catch(error){
          onNotify('Page cloned, but another device layout could not be copied: '+
            (error instanceof Error?error.message:String(error)));
          return;
        }
        savedPageApiName.current = apiName;
        setSelectedId(cloned.components[0]?.id ?? '');
        setPageSettingsOpen(cloned.components.length === 0);
        setPreviewMode(false);
        setUndoStack([]);
        setSelectionUndoStack([]);
        setSelectionRedoStack([]);
        setRedoStack([]);
      }
    } finally {
      setSaving(false);
    }
  };
  const pageDeviceLabel = (item: LightningPageMetadata) => item.canvasWidth <= 600 || (item.devices.length === 1 && item.devices[0] === 'Phone') ? 'Phone' : item.canvasWidth < 1400 ? 'Tablet' : 'Desktop';
  const archiveSavedPage = async (candidate: LightningPageMetadata) => {
    setArchivingPageApiName(candidate.apiName);
    try {
      await onDeletePage(candidate.apiName);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unable to archive page';
      onNotify(reason.includes('App-owned Page') || reason.includes('App Home Page')
        ? reason + '. Manage the app or reassign its Home Page first.'
        : reason);
    } finally {
      setArchivingPageApiName('');
      setPendingArchivePageApiName('');
    }
  };
  // Rebuild the app tabs from tenant app metadata on every render. No app names are hardcoded.
  const pageAppIds = (item: LightningPageMetadata): string[] => pageActivationAppCandidates(apps,item);
  const pageAppTabs = [...apps].sort((a,b) => a.label.localeCompare(b.label));
  const pageTabType = (item: LightningPageMetadata) => item.pageType;
  const visiblePages = pages.filter(item => (recordPageContext
    ? item.pageType === 'Record Page' && item.targetObject === recordPageContext
    : item.pageType !== 'Record Page') && (recordPageContext || pageListTypeTab !== 'App Page' || pageListAppTab === 'all' || (pageListAppTab === 'other'
      ? pageAppIds(item).length === 0 : pageAppIds(item).includes(pageListAppTab)))
    && (recordPageContext || pageListTypeTab === 'all' || pageTabType(item) === pageListTypeTab)
    && (pageListDeviceTab === 'all' || (pageListDeviceTab === 'Mobile'
      ? item.layoutVariant === 'Mobile' || item.devices.includes('Phone')
      : pageListDeviceTab === 'Desktop'
        ? item.layoutVariant === 'Desktop' || item.devices.includes('Desktop')
        : item.layoutVariant === pageListDeviceTab))
    && (!pageListObject || item.targetObject === pageListObject) && `${item.label} ${item.apiName}`.toLowerCase().includes(pageListSearch.trim().toLowerCase())).sort((a,b) => {
      const result=pageListSort==='updatedAt'?(Date.parse(a.updatedAt??'')||0)-(Date.parse(b.updatedAt??'')||0):
        pageListSort==='status'?a.status.localeCompare(b.status):
        pageListSort==='apiName'?a.apiName.localeCompare(b.apiName):a.label.localeCompare(b.label);
      return pageListSortDescending?-result:result;
    });
  const showRelatedObjectColumn=visiblePages.some(item=>Boolean(item.targetObject));
  const pageListPageCount=Math.max(1,Math.ceil(visiblePages.length/50));
  const safePageListPage=Math.min(pageListPage,pageListPageCount);
  const paginatedPages=visiblePages.slice((safePageListPage-1)*50,safePageListPage*50);
  const paginatedPageNames=paginatedPages.map(item=>item.apiName).join(',');
  useEffect(()=>{
    if(editorMode||!paginatedPageNames)return;
    void fetchLayoutSummaries(paginatedPageNames.split(','));
  },[editorMode,paginatedPageNames,fetchLayoutSummaries]);
  // The open page: refresh after every switch or save so counts stay current.
  useEffect(()=>{
    if(!editorMode||!page.apiName)return;
    void fetchLayoutSummaries([page.apiName]);
  },[editorMode,page.apiName,page.layoutVariant,page.draftRevision,fetchLayoutSummaries]);
  /** Design opens the layout the page was designed in; Desktop-only pages are unchanged. */
  const openPageDesign=async(apiName:string)=>{
    const summary=layoutSummaries[apiName]??(await fetchLayoutSummaries([apiName]))
      .find(item=>item.apiName===apiName);
    const variant=primaryPageLayout(summary);
    if(variant==='Desktop'){selectSavedPage(apiName);return;}
    await openPageDesignLayout(apiName,variant);
  };
  const layoutBadges=(item:LightningPageMetadata)=>designedPageLayouts(layoutSummaries[item.apiName])
    .filter(layout=>layout.variant!=='Desktop'||designedPageLayouts(layoutSummaries[item.apiName]).length>1)
    .map(layout=><span key={layout.variant} className="page-layout-badge"
      title={layout.variant+' layout: '+layout.components+' components'}>{layout.variant} · {layout.components}</span>);
  /** Replace this layout's components with another layout's, as one undoable unsaved edit. */
  const copyLayoutFrom=async(source:PageLayoutVariant)=>{
    const current=page.layoutVariant??'Desktop';
    if(!source||source===current)return;
    try{
      const {page:from}=await request<{page:LightningPageMetadata}>(
        `/metadata/pages/${encodeURIComponent(page.apiName)}/layouts/${source}/editor`);
      if(!from.components.length){onNotify(source+' layout has no components to copy.');return;}
      if(page.components.length&&!window.confirm('Replace the '+page.components.length+' components on '+current+
        ' with the '+from.components.length+' from '+source+'? Nothing is saved until you Save; Undo reverts it.'))return;
      applyPage({...page,components:structuredClone(from.components)});
      setLayoutCopySource('');
      onNotify('Copied '+from.components.length+' components from '+source+'. Review positions for this canvas, then Save.');
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to copy the layout');}
  };
  const downloadPageInventory = async (item:LightningPageMetadata) => {
    if(inventoryDownloading)return;
    const variant=inventoryExportVariant==='Auto'
      ?primaryPageLayout(layoutSummaries[item.apiName]):inventoryExportVariant;
    setInventoryDownloading(item.apiName);
    try{
      const {csv}=await request<{csv:string}>(
        '/metadata/pages/'+encodeURIComponent(item.apiName)+'/inventory?variant='+variant);
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');
      link.href=url;link.download=item.apiName+'_'+variant+'_component_inventory.csv';
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to download page inventory');}
    finally{setInventoryDownloading('');}
  };
  /** Download the page's converted (compiled) TypeScript, from the same layout the inventory uses. */
  const downloadCompiledPageScript = async (item:LightningPageMetadata) => {
    if(inventoryDownloading)return;
    const variant=inventoryExportVariant==='Auto'
      ?primaryPageLayout(layoutSummaries[item.apiName]):inventoryExportVariant;
    setInventoryDownloading(item.apiName);
    try{
      // The exact file the server builds from the saved layout (the same file Preview runs).
      const code=await fetchServerPageScriptSource(request,item.apiName,variant);
      downloadCode(code,item.apiName+'_'+variant+'.page.js');
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to download the page script');}
    finally{setInventoryDownloading('');}
  };
  const openCreatePage = () => { setNewPageAppId(pageListAppTab!=='all'&&pageListAppTab!=='other'?pageListAppTab:''); setNewPageTargetObject(recordPageContext || ''); setNewPageLayoutMode('free-canvas'); setNewPageType(recordPageContext ? 'Record Page' : 'Home Page'); setNewPageDeviceChoice('Desktop'); setNewPageDevices(['Desktop']); setNewPageCanvasWidth(1440); setNewPageCanvasHeight(900); setCreatePageOpen(true); };
  const createPage = async () => {
    if (saving) return;
    const label = newPageLabel.trim();
    if (!label) return;
    if (newPageType === 'Record Page' && !recordPageContext) {
      onNotify('Record Pages can only be created from Object Manager.');
      return;
    }
    if (newPageType === 'Record Page' && !objects.some(item => item.apiName === newPageTargetObject)) {
      onNotify('Record Pages need an existing data object; Home and App Pages do not.');
      return;
    }
    if (newPageTargetObject && !objects.some(item => item.apiName === newPageTargetObject)) {
      onNotify('Choose a valid data object or leave it unbound.');
      return;
    }
    if (!newPageDevices.length) {
      onNotify('Choose at least one supported device');
      return;
    }
    const baseApiName = generateMetadataApiName(label) || 'New_Page';
    const apiName = suggestMetadataApiName(baseApiName,[page.apiName,...pages.map(item=>item.apiName)]);
    if (!apiName) {onNotify('Enter a valid page name');return;}
    if (apiName !== baseApiName) onNotify(`Duplicate API Name; created as ${apiName}`);
    const nextPage: LightningPageMetadata = {
      apiName, label, targetObject: newPageTargetObject,
      pageType: newPageType,
      ...(newPageType === 'Record Page' ? { recordMode: newRecordMode } : {}),
      layoutMode: newPageLayoutMode, template: newPageTemplate,
      layoutVariant: newPageDeviceChoice === 'Phone' ? 'Mobile' : newPageDeviceChoice,
      canvasWidth: newPageCanvasWidth,
      canvasHeight: newPageCanvasHeight,
       canvasFillColor:'#ffffff',
       status: 'Draft', devices: [...newPageDevices], components: [],
      // App Pages belong to app navigation; only Record/Home pages use activation assignments.
      activationAssignments: newPageAppId
        ? [{
          id: crypto.randomUUID(), scope: 'App Default', appId: newPageAppId,
          profileId: null, recordTypeId: null, formFactors: [...newPageDevices]
        }] : []
    };
    setSaving(true);
    try {
      // Persist first: the route resolver must never replace a new unsaved page
      // with the previously selected page on its next metadata refresh.
      const saved = await onSave(nextPage, apiName, 'Lightning page draft created');
      if (!saved) return;
      if(saved.apiName!==apiName) onNotify('Page API name already reserved; created as '+saved.apiName);
      if (newPageAppId&&newPageType!=='In-Screen Page'&&newPageType!=='Print Template') onPrepareApp(saved.apiName,newPageAppId);
      savedPageApiName.current = saved.apiName;
      if (newPageAppId) setBuilderAppApiName(newPageAppId);
      setSelectedId('');
      setPageSettingsOpen(true);
      setCreatePageOpen(false);
      setNewPageLabel('');
      setUndoStack([]);
      setSelectionUndoStack([]);
      setSelectionRedoStack([]);
      setRedoStack([]);
      setPreviewMode(false);
    } finally {
      setSaving(false);
    }
  };

  return {
    savePage, publishCurrentLayout, pageDeviceLabel, archiveSavedPage, pageAppTabs, visiblePages,
    showRelatedObjectColumn, pageListPageCount, safePageListPage, paginatedPages, openPageDesign,
    layoutBadges, copyLayoutFrom, downloadPageInventory, downloadCompiledPageScript, openCreatePage, createPage,
  };
}
