import {downloadPageExcel} from '../../pageInventoryExcel';
import { availableComponentSettings, resolveComponentSettings, validateComponentSettings } from '../../../../components/Properties/componentSettingDefinitions';
import { pagePropertyIssues } from '../../../../components/Properties/pagePropertyContract';
import { generateMetadataApiName, metadataNameConflictExcept, suggestMetadataApiName } from '../../../../metadata/Definitions/metadataApiNames';
import { reconcileNavigationOrder } from '../../../../workspace/Navigation/appNavigation';
import { useEffect, useMemo } from 'react';
import { duplicatePageComponentId } from '../../componentIdentity';
import { remapComponentInteractionTargets } from '../../pageComponentTree';
import { findRegisteredComponent } from '../../../../components/Registry/componentRegistryLookup';
import { type LightningPageMetadata, type PageLayoutVariant } from '../../../../metadata/Definitions/metadata';
import { designedPageLayouts, primaryPageLayout } from '../../pageLayoutSummary';
import { pageActivationAppCandidates, resolvePageActivationApp, pageAppsWithPopups } from '../../pageAppMembership';
import { compilePage } from '../../../../pages/PageCompiler/compilePage';
import { downloadPageCode } from '../../../../pages/AppPackage/pageCodeDownload';
import { dropAppDraft, keepAppDraft, otherAppDrafts } from './appDraftStore';
import { appBrokenLinks, appPageNames, describeLinkErrors, publishAppVersion, recordAppVersion, type AppLinkError } from './appVersions';
import { brokenPageLinks } from '../../pageLinkCheck';
import { PAGE_LIST_TYPES } from '../../pageBuilderUx';

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
    onPrepareApp, appModeId,
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

  /** Editing the whole app: write the edits kept on the app's other pages (and publish their drafts). */
  const saveOtherAppPages = async (publish: boolean) => {
    if (!appModeId) return;
    const open = { apiName: page.apiName, variant: page.layoutVariant ?? 'Desktop' };
    const kept = otherAppDrafts(appModeId, open);
    const failed: string[] = [];
    for (const { page: draft } of kept) {
      const variant = draft.layoutVariant ?? 'Desktop';
      const duplicateId = duplicatePageComponentId(draft.components);
      if (duplicateId) { failed.push(draft.label + ': ' + duplicateId); continue; }
      const saved = await onSave(draft, draft.apiName);
      if (!saved) { failed.push(draft.label); continue; }
      if (publish && saved.draftRevision !== saved.publishedRevision
        && !await onPublish(draft.apiName, variant, saved.draftRevision || undefined)) { failed.push(draft.label); continue; }
      dropAppDraft(appModeId, draft.apiName, variant);
    }
    if (failed.length) onNotify('Not saved: ' + failed.join('; '));
    else if (kept.length) onNotify((publish ? 'Published ' : 'Saved ') + (kept.length + 1) + ' pages of the app');
  };
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
          const label=(id:string)=>{
            const item=nextPage.components.find(entry=>entry.id===id);
            const name=item?.properties?.navigatorName;
            return typeof name==='string'&&name?name:item?.label||id;
          };
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
          if (appModeId) dropAppDraft(appModeId, nextPage.apiName, nextPage.layoutVariant ?? 'Desktop');
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
  /** The whole app as it is now: its pages and the broken links on any of them. */
  const checkApp=async(appId:string,current:LightningPageMetadata)=>{
    const kept=otherAppDrafts(appId,{apiName:current.apiName,variant:current.layoutVariant??'Desktop'});
    const edited=new Map<string,LightningPageMetadata['components']>([[current.apiName,current.components]]);
    for(const {page:draft} of kept)if((draft.layoutVariant??'Desktop')==='Desktop'||!edited.has(draft.apiName))
      edited.set(draft.apiName,draft.components);
    const names=appPageNames(appId,apps,pages,[current.apiName,...kept.map(item=>item.page.apiName)]);
    return {names,errors:await appBrokenLinks(request,names,pages,edited)};
  };
  /** Save = a new version of the app (the last 10 are kept, see App Manager > Versions). */
  const recordVersion=async(appId:string,current:LightningPageMetadata)=>{
    const {names,errors}=await checkApp(appId,current);
    const recorded=await recordAppVersion(request,appId,names,errors);
    return {...recorded,errors};
  };
  const linkWarning=(errors:readonly AppLinkError[])=>errors.length
    ?errors.length+' broken link'+(errors.length===1?'':'s')+' (red on the canvas) — fix before publishing: '+describeLinkErrors(errors):'';
  /** Save button. Editing the whole app saves every changed page of the app together. */
  const saveCurrent=async()=>{
    const saved=await savePage();
    if(saved&&appModeId){
      await saveOtherAppPages(false);
      try{
        const {version,errors}=await recordVersion(appModeId,saved);
        onNotify('Saved app version '+version+(errors.length?'. '+linkWarning(errors):''));
      }catch(error){onNotify('Saved. Version not recorded: '+(error instanceof Error?error.message:'unknown error'));}
    }
    return saved;
  };
  const publishCurrentLayout=async()=>{
    if(saving)return;
    if(appModeId){
      // Publish the app: save every changed page, record the app version, and make it live.
      // Nothing is published while any page of the app has a broken link.
      const saved=undoStack.length||!page.draftRevision?await savePage():page;
      if(!saved)return;
      await saveOtherAppPages(false);
      setSaving(true);
      try{
        const {version,errors}=await recordVersion(appModeId,saved);
        if(errors.length){onNotify('Not published (saved as version '+version+'). '+linkWarning(errors));return;}
        await publishAppVersion(request,appModeId,version);
        // The open page is now live: show it as the server has it.
        const variant=saved.layoutVariant??'Desktop';
        const fresh=await request<{page:LightningPageMetadata}>(
          `/metadata/pages/${encodeURIComponent(saved.apiName)}/layouts/${variant}/editor`).catch(()=>null);
        if(fresh?.page&&fresh.page.apiName===page.apiName)props.onChange(fresh.page);
        onNotify('Published app version '+version);
        setSavedFeedback(true);setShowLayoutHistory(false);
      }catch(error){
        onNotify(error instanceof Error?error.message:'Unable to publish the app');
      }finally{setSaving(false);}
      return;
    }
    const pageErrors=brokenPageLinks(page.components,pages);
    if(pageErrors.length){
      onNotify('Not published. '+linkWarning(pageErrors.map(item=>({page:page.label,component:item.component,message:item.message}))));
      return;
    }
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
  // A page's apps: the ones that own, assign or navigate to it; an In-Screen page (popup)
  // also belongs to every app whose pages open it with SCREEN(page, ...).
  const pageAppIdMap = useMemo(()=>pageAppsWithPopups(apps,pages),[apps,pages]);
  const pageAppIds = (item: LightningPageMetadata): string[] => pageAppIdMap.get(item.apiName) ?? pageActivationAppCandidates(apps,item);
  const pageAppTabs = [...apps].sort((a,b) => a.label.localeCompare(b.label));
  const pageTabType = (item: LightningPageMetadata) => item.pageType;
  const visiblePages = pages.filter(item => (recordPageContext
    ? item.pageType === 'Record Page' && item.targetObject === recordPageContext
    : (PAGE_LIST_TYPES as readonly string[]).includes(item.pageType)) && (recordPageContext || pageListAppTab === 'all' || (pageListAppTab === 'other'
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
      await downloadPageExcel(request,csv,item.apiName+'_'+variant+'_page');
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to download page inventory');}
    finally{setInventoryDownloading('');}
  };
  /** One CSV with every property of the pages listed now (Application, Page type, Layout,
   * Object and Search filters), same columns as a single page's download.
   * Edit any value (colours, labels, formulas) and send it back with Upload CSV. */
  const downloadAllPageFormulas = async () => {
    const listed=visiblePages;
    if(inventoryDownloading||!listed.length)return;
    setInventoryDownloading('*');
    try{
      const summaries=new Map((await fetchLayoutSummaries(listed.map(item=>item.apiName)))
        .map(row=>[row.apiName,row]));
      const parts:string[]=[];
      const failed:string[]=[];
      for(const item of listed){
        const variant=inventoryExportVariant==='Auto'
          ?primaryPageLayout(summaries.get(item.apiName)??layoutSummaries[item.apiName]):inventoryExportVariant;
        try{
          const {csv}=await request<{csv:string}>('/metadata/pages/'+encodeURIComponent(item.apiName)
            +'/inventory?variant='+variant);
          // The header is one line: keep it from the first page only.
          const rows=csv.replace(/\r?\n$/,'');
          const cut=rows.search(/\r?\n/);
          if(cut<0){if(!parts.length)parts.push(rows);continue;}
          parts.push(parts.length?rows.slice(cut).replace(/^\r?\n/,''):rows);
        }catch{failed.push(item.label||item.apiName);}
      }
      const csv=parts.filter(Boolean).join('\r\n')+'\r\n';
      // File name says what was listed, e.g. smart_till_in_screen_pages.
      const appName=pageListAppTab==='all'?'all':pageListAppTab==='other'?'other'
        :apps.find(app=>app.apiName===pageListAppTab)?.label??pageListAppTab;
      const typeName=pageListTypeTab==='all'?'':pageListTypeTab.replace(/ Page$/,'');
      const fileName=[appName,typeName,'pages'].filter(Boolean).join('_')
        .toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
      await downloadPageExcel(request,csv,fileName||'all_pages');
      if(failed.length)onNotify('Not included (could not be read): '+failed.slice(0,10).join(', '));
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to download the pages');}
    finally{setInventoryDownloading('');}
  };
  /** Download the page's code files (publish to code: .tsx, .css, .formulas.ts, .actions.ts,
   * .data.ts, manifest.json, newest version) as one .zip, from the layout the inventory uses. */
  const downloadCompiledPageScript = async (item:LightningPageMetadata) => {
    if(inventoryDownloading)return;
    const variant=inventoryExportVariant==='Auto'
      ?primaryPageLayout(layoutSummaries[item.apiName]):inventoryExportVariant;
    setInventoryDownloading(item.apiName);
    try{
      // The code the app runs from (what publishing wrote, or a developer's edit).
      await downloadPageCode(request,item.apiName,variant);
    }catch(error){onNotify(error instanceof Error?error.message:'Unable to download the page script');}
    finally{setInventoryDownloading('');}
  };
  const openCreatePage = () => { setNewPageAppId(pageListAppTab!=='all'&&pageListAppTab!=='other'?pageListAppTab:''); setNewPageTargetObject(recordPageContext || ''); setNewPageLayoutMode('free-canvas'); setNewPageType(recordPageContext ? 'Record Page' : 'Print Template'); setNewPageDeviceChoice('Desktop'); setNewPageDevices(['Desktop']); setNewPageCanvasWidth(recordPageContext ? 1440 : 794); setNewPageCanvasHeight(recordPageContext ? 900 : 1123); setCreatePageOpen(true); };
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

  /** Bottom bar "+": add a screen to the app being edited as an App page or a Popup (In-Screen page). */
  /** Red X on the page bar. Warns first: the page is deleted for good, not archived. */
  const deletePagePermanently = async (apiName: string) => {
    if (saving || !props.onDeletePagePermanently) return;
    const label = [page, ...pages].find(item => item.apiName === apiName)?.label ?? apiName;
    if (!window.confirm('Delete "' + label + '" permanently?\n\nThe page, its layouts and its history are deleted and cannot be recovered. It is not archived.')) return;
    setSaving(true);
    try {
      await props.onDeletePagePermanently(apiName);
      if (appModeId) dropAppDraft(appModeId, apiName, page.layoutVariant ?? 'Desktop');
      setUndoStack([]); setRedoStack([]);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to delete the page');
    } finally { setSaving(false); }
  };
  /** Bottom bar +: a new App page or Popup with the name typed in the dialog. Its API name is made
   *  from that name (taken → _2, _3…) and never changes afterwards. */
  const addAppPage = async (type: 'App Page' | 'In-Screen Page', name: string) => {
    if (saving || !builderAppApiName) return;
    // Editing the whole app keeps this page's edits; a single page still asks first.
    if (appModeId) { if (undoStack.length) keepAppDraft(appModeId, page, undoStack[0]); }
    else if (editorMode && undoStack.length && !window.confirm('Discard unsaved Page Builder edits?')) return;
    const label = name.trim();
    if (!label) { onNotify('Give the new screen a name'); return; }
    const apiName = suggestMetadataApiName(generateMetadataApiName(label), [page.apiName, ...pages.map(item => item.apiName)]);
    if (!apiName) { onNotify('Use a name that starts with a letter'); return; }
    const devices = page.devices?.length ? [...page.devices] : ['Desktop' as const];
    const nextPage: LightningPageMetadata = {
      apiName, label, targetObject: '', pageType: type, layoutMode: 'free-canvas', template: page.template,
      layoutVariant: page.layoutVariant, canvasWidth: page.canvasWidth, canvasHeight: page.canvasHeight,
      canvasFillColor: '#ffffff', status: 'Draft', devices, components: [],
      activationAssignments: [{ id: crypto.randomUUID(), scope: 'App Default', appId: builderAppApiName,
        profileId: null, recordTypeId: null, formFactors: [...devices] }]
    };
    setSaving(true);
    try {
      const saved = await onSave(nextPage, apiName, 'Lightning page draft created');
      if (!saved) return;
      if (type === 'App Page') onPrepareApp(saved.apiName, builderAppApiName);
      savedPageApiName.current = saved.apiName;
      setBuilderAppApiName(builderAppApiName);
      setSelectedId('');
      setUndoStack([]); setSelectionUndoStack([]); setSelectionRedoStack([]); setRedoStack([]);
      setPreviewMode(false);
    } finally { setSaving(false); }
  };

  return {
    savePage, saveCurrent, activateListedPage, deletePagePermanently, pageAppIds, publishCurrentLayout, pageDeviceLabel, archiveSavedPage, pageAppTabs, visiblePages,
    showRelatedObjectColumn, pageListPageCount, safePageListPage, paginatedPages, openPageDesign,
    layoutBadges, copyLayoutFrom, downloadPageInventory, downloadAllPageFormulas, downloadCompiledPageScript, openCreatePage, createPage, addAppPage,
  };
}
