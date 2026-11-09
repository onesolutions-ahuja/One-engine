import { useFormFactor } from '../../../workspace/Responsive/useFormFactor';
import { ensureComponentInstanceNames } from '../../../../../../server/src/system-support/page-component-names';
import { relatedListRelationships } from '../relatedListRelationships';
import { pageTemplates, pageStringList } from '../pageEditorMetadata';
import { type RecordData } from '../../../records/RecordWorkspace/recordMetadataUtils';
import { formatRecordValue } from '../../../records/RecordWorkspace/recordCsvUtils';
import * as React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasBindingTarget } from '../canvasDataBindingTargets';
import type { AdvancedFeature } from '../PageBuilderAdvancedRibbon';
import { isBuilderApi, type SharedRibbonCatalog, type BuilderApi } from '../builderPropertyInventory';
import { isCanvasLocked } from '../canvasInteractions';
import { constrainCanvasRect } from '../canvasPointerInteractions';
import { pageBuilderPreviewDevice } from '../pageBuilderPreviewDevice';
import { type ComponentClipboard } from '../pageComponentTree';
import { standardPageComponents } from '../../../components/Catalog/index';
import { findRegisteredComponent } from '../../../components/Registry/componentRegistryLookup';
import { canvasOrientation } from '../../../pages/PageRuntime/pageCanvas';
import { pageBuilderPaletteCategories } from '../pageBuilderPalette';
import { loadRecentPageBlocks } from '../pageBuilderUx';
import {
type PageActivationAssignmentMetadata, type LightningPageTemplate, type LightningPageMetadata,
type PageLayoutVariant,
} from '../../../metadata/Definitions/metadata';
import { ensureTenantBrand } from '../../../branding/tenantBrandLoader';
import { type PageLayoutSummary } from '../pageLayoutSummary';

import type { PageBuilderProps } from './PageBuilderTypes';
import type { CanvasSelectionSnapshot, ResizeEdge } from './PageBuilderTypes';

export function usePageEditorState(
  props: PageBuilderProps,
) {
  const {
    page, preparedAppId, apps, recordPageContext, objects, editorMode, request, onNotify,
    libraryComponents, onChange,
  } = props;

  // $tenant.name / $tenant.logo formulas: load the signed-in tenant's brand once.
  useEffect(()=>{void ensureTenantBrand();},[]);
  const isPhoneBuilder = useFormFactor() === 'Phone';
  // An existing App Page keeps its saved App Default assignment as the builder app, so it can be
  // activated in a later session (the prepared app context only exists in the session that created it).
  const assignedAppApiName = page.activationAssignments
    ?.find(item => item.scope === 'App Default' && item.appId)?.appId ?? '';
  const [builderAppApiName, setBuilderAppApiName] = useState(preparedAppId || assignedAppApiName);
  useEffect(() => {
    if (preparedAppId) setBuilderAppApiName(preparedAppId);
    else if (assignedAppApiName) setBuilderAppApiName(current => current || assignedAppApiName);
  }, [preparedAppId, assignedAppApiName]);
  const template = pageTemplates.find((item) => item.id === page.template) ?? pageTemplates[0];
  const targetObject = objects.find((object) => object.apiName === page.targetObject);
  const pageTypeComponents = page.pageType === 'Record Page'
    ? standardPageComponents.map((component) => component.apiName)
    : standardPageComponents
      .filter((component) => ['Accordion', 'Tabs', 'Report Chart', 'Dashboard', 'Rich Text', 'List View', 'Screen Flow', 'Items to Approve'].includes(component.apiName))
      .map((component) => component.apiName);
  const relatedListOptions = useMemo(() => [...new Map(
    relatedListRelationships(objects, page.targetObject)
      .filter((item) => Boolean(item.childRelationshipName))
      .map((item) => [item.childRelationshipName, item.pluralLabel] as const)
  )].map(([apiName, label]) => ({ apiName, label })), [objects, page.targetObject]);
  const defaultRelatedLists = relatedListOptions.slice(0, 3).map((item) => item.apiName);
  const availableComponents = pageTypeComponents.filter((component) =>
    (component !== 'Activities' || targetObject?.settings?.allowActivities)
    && (component !== 'Chatter' || targetObject?.settings?.allowInChatter)
    && (component !== 'Report Chart' || targetObject?.settings?.allowReports));
  const stringList = pageStringList;
  const [selectedId, setSelectedId] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<'header' | 'main' | 'sidebar' | null>(null);
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [groupEditId,setGroupEditId]=useState('');
  const [openBuilderTabs,setOpenBuilderTabs]=useState<Record<string,string>>({});
  const [previewRecords,setPreviewRecords]=useState<RecordData[]>([]);
  const [previewRecordId,setPreviewRecordId]=useState('');
  const previewRecord=previewRecords.find(item=>String(item.Id)===previewRecordId)??previewRecords[0];
  useEffect(()=>{
    if(!editorMode||page.pageType!=='Record Page'||!page.targetObject){
      setPreviewRecords([]);setPreviewRecordId('');return;
    }
    let active=true;
    setPreviewRecords([]);setPreviewRecordId('');
    void request<{records:RecordData[]}>(`/records/${encodeURIComponent(page.targetObject)}?limit=20&offset=0`)
      .then(result=>{if(active)setPreviewRecords(result.records??[]);})
      .catch(()=>{if(active)setPreviewRecords([]);});
    return ()=>{active=false;};
  },[page.pageType,page.targetObject,editorMode]);
  const previewFieldValue=(apiName:string)=>{
    if(!previewRecord)return 'No accessible record selected';
    if(!Object.prototype.hasOwnProperty.call(previewRecord,apiName))return 'Field not readable';
    return formatRecordValue(previewRecord[apiName]);
  };
  useEffect(() => {
    setSelectionIds(current => selectedId && current.includes(selectedId) ? current : selectedId ? [selectedId] : []);
  }, [selectedId]);
  const savedPageApiName = useRef(page.apiName);
  const device = pageBuilderPreviewDevice(page);
  const orientation = canvasOrientation(page.canvasWidth, page.canvasHeight);
  const [paletteTab, setPaletteTab] = useState<'Components' | 'Fields' | 'Layers'>('Components');
  const [paletteSearch, setPaletteSearch] = useState('');
  const [paletteInsertRegion, setPaletteInsertRegion] = useState<'header' | 'main' | 'sidebar' | null>(null);
  const [paletteCategory, setPaletteCategory] = useState<(typeof pageBuilderPaletteCategories)[number]>('All Components');
  const [favouriteComponents, setFavouriteComponents] = useState<string[]>([]);
  const [recentComponents, setRecentComponents] = useState<string[]>(() => {
    try { return loadRecentPageBlocks(window.localStorage.getItem('metadrive:page-builder:recent')); }
    catch { return []; }
  });
  const [favouritesLoaded, setFavouritesLoaded] = useState(false);
  const [componentPanelWidth, setComponentPanelWidth] = useState(336);
  // One Canva-style contextual rail and one collapsible panel; never two competing sidebars.
  const [activePanel, setActivePanel] = useState<'palette' | 'properties' | 'page' | null>(() => {
    try { return window.localStorage.getItem('metadrive:page-builder:panel') === 'collapsed' ? null : 'palette'; }
    catch { return 'palette'; }
  });
  useEffect(() => {
    try { window.localStorage.setItem('metadrive:page-builder:panel', activePanel === null ? 'collapsed' : 'expanded'); }
    catch { /* Optional browser preference, not page metadata. */ }
  }, [activePanel]);
  // The shared Page Builder controls live in a single persistent left dock.
  const [pageListObject, setPageListObject] = useState('');
  const [pageListSearch, setPageListSearch] = useState('');
  const [pageListAppTab, setPageListAppTab] = useState('all');
  const [pageListTypeTab, setPageListTypeTab] = useState('App Page');
  const [pageListDeviceTab, setPageListDeviceTab] = useState('all');
  const [pageListPage,setPageListPage]=useState(1);
  const [pageListSort,setPageListSort]=useState<'updatedAt'|'label'|'apiName'|'status'>('updatedAt');
  const [pageListSortDescending,setPageListSortDescending]=useState(true);
  const changePageListSort=(key:typeof pageListSort)=>{if(key===pageListSort)setPageListSortDescending(value=>!value);else{setPageListSort(key);setPageListSortDescending(key==='updatedAt');}setPageListPage(1);};
  const [pageDetailsApi,setPageDetailsApi]=useState<string|null>(null);
  const paletteResizeStart = useRef<{ pointerId: number; pointerX: number; width: number } | null>(null);
  const [customPropertiesDraft, setCustomPropertiesDraft] = useState('');
  const [customPropertiesError, setCustomPropertiesError] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  // Preview uses the same published runtime, but with draft metadata and an isolated cache.
  const previewPageDefinitionCache = useRef(new Map<string,{page:LightningPageMetadata;fetchedAt:number}>());
  const externalPreviewWindowRef = useRef<Window | null>(null);
  const [externalPreviewTarget, setExternalPreviewTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    return () => { externalPreviewWindowRef.current?.close(); externalPreviewWindowRef.current = null; };
  }, []);
  const openExternalPreview = () => {
    if (externalPreviewWindowRef.current && !externalPreviewWindowRef.current.closed) {
      externalPreviewWindowRef.current.focus();
      return;
    }
    const popup = window.open('', 'metadrive-page-preview', 'popup=yes,width=1280,height=860,resizable=yes,scrollbars=yes');
    if (!popup) { onNotify('Please allow the page preview popup in your browser.'); return; }
    externalPreviewWindowRef.current = popup;
    popup.document.title = `${page.label} — Preview`;
    for (const sheet of Array.from(document.querySelectorAll('link[rel="stylesheet"],style'))) {
      popup.document.head.appendChild(sheet.cloneNode(true));
    }
    popup.document.body.style.margin = '0';
    const container = popup.document.createElement('main');
    container.id = 'metadrive-popup-preview';
    popup.document.body.appendChild(container);
    popup.addEventListener('beforeunload', () => {
      if (externalPreviewWindowRef.current === popup) {
        externalPreviewWindowRef.current = null;
        setExternalPreviewTarget(null);
      }
    });
    setExternalPreviewTarget(container);
  };
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  const loadedEditorVariantRef=useRef<string|null>(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [dynamicFormsUpgradeOpen, setDynamicFormsUpgradeOpen] = useState(false);
  const [migrationLayoutId, setMigrationLayoutId] = useState('');
  const [newRecordLinkLabel,setNewRecordLinkLabel]=useState('');
  const [newRecordLinkUrl,setNewRecordLinkUrl]=useState('');
  const [fitCanvas, setFitCanvas] = useState(false);
  const [fitFullPage, setFitFullPage] = useState(false);
  const [canvasZoom,setCanvasZoom] = useState(100);
  const [fitScale, setFitScale] = useState(1);
  const pagePreviewAreaRef = useRef<HTMLDivElement | null>(null);
  const marqueeOverlayRef=useRef<HTMLDivElement|null>(null);
  const marqueeStartRef=useRef<{pointerId:number;x:number;y:number;clientX:number;clientY:number;additive:boolean;moved:boolean}|null>(null);
  const suppressCanvasClickRef=useRef(false);
  const pendingInsertedRef=useRef<string|null>(null);
  const [canvasRefreshKey, setCanvasRefreshKey] = useState(0);
  // After inserting at any canvas zoom/scroll offset, reveal the selected block.
  // No page-level scrolling, camera metadata mutation, or global DOM query.
  useLayoutEffect(()=>{
    const id=pendingInsertedRef.current;
    const viewport=pagePreviewAreaRef.current;
    if(!id||!viewport)return;
    const frame=window.requestAnimationFrame(()=>{
      const target=Array.from(viewport.querySelectorAll<HTMLElement>('[data-component-id]'))
        .find(element=>element.dataset.componentId===id);
      if(!target)return;
      pendingInsertedRef.current=null;
      const visible=viewport.getBoundingClientRect();
      const bounds=target.getBoundingClientRect();
      const gap=20;
      const dx=bounds.left<visible.left+gap?bounds.left-visible.left-gap:
        bounds.right>visible.right-gap?bounds.left-visible.left-gap:0;
      const dy=bounds.top<visible.top+gap?bounds.top-visible.top-gap:
        bounds.bottom>visible.bottom-gap?bounds.top-visible.top-gap:0;
      if(dx||dy)viewport.scrollTo({left:viewport.scrollLeft+dx,top:viewport.scrollTop+dy,behavior:'auto'});
    });
    return()=>window.cancelAnimationFrame(frame);
  },[page.components,page.layoutMode]);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const createPageTriggerRef=useRef<HTMLButtonElement>(null);
  const createPageDialogRef=useRef<HTMLElement>(null);
  const wasCreatingPage=useRef(false);
  useEffect(()=>{
    if(createPageOpen){wasCreatingPage.current=true;return;}
    if(wasCreatingPage.current){wasCreatingPage.current=false;requestAnimationFrame(()=>createPageTriggerRef.current?.focus());}
  },[createPageOpen]);
  const handleCreatePageDialogKey=(event:React.KeyboardEvent<HTMLElement>)=>{
    if(event.key==='Escape'){event.preventDefault();setCreatePageOpen(false);return;}
    if(event.key!=='Tab')return;
    const controls=Array.from(createPageDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')??[]);
    if(!controls.length)return;
    if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls[controls.length-1].focus();}
    if(!event.shiftKey&&document.activeElement===controls[controls.length-1]){event.preventDefault();controls[0].focus();}
  };
  const [routeDirectoryOpen, setRouteDirectoryOpen] = useState(false);
  const [dependenciesOpen, setDependenciesOpen] = useState(false);
  const [newPageLabel, setNewPageLabel] = useState('');
  const [newPageType, setNewPageType] = useState<LightningPageMetadata['pageType']>(recordPageContext ? 'Record Page' : 'App Page');
  const [newRecordMode,setNewRecordMode]=useState<'View'|'Edit'>('View');
  const [newPageTemplate, setNewPageTemplate] = useState<LightningPageTemplate>('header-main-sidebar');
  const [newPageLayoutMode, setNewPageLayoutMode] = useState<LightningPageMetadata['layoutMode']>('free-canvas');
  const [newPageTargetObject, setNewPageTargetObject] = useState(recordPageContext || '');
  const [newPageAppId, setNewPageAppId] = useState('');
  const [newPageDevices, setNewPageDevices] = useState<LightningPageMetadata['devices']>(['Desktop']);
  const [newPageDeviceChoice, setNewPageDeviceChoice] = useState<'Desktop' | 'Tablet' | 'Phone' | 'Custom'>('Desktop');
  const [newPageCanvasWidth, setNewPageCanvasWidth] = useState(1440);
  const [newPageCanvasHeight, setNewPageCanvasHeight] = useState(900);
  const [dragOverId, setDragOverId] = useState('');
  const [undoStack, setUndoStack] = useState<LightningPageMetadata[]>([]);
  const [redoStack, setRedoStack] = useState<LightningPageMetadata[]>([]);
  const [selectionUndoStack, setSelectionUndoStack] = useState<CanvasSelectionSnapshot[]>([]);
  const [selectionRedoStack, setSelectionRedoStack] = useState<CanvasSelectionSnapshot[]>([]);
  const canvasResizeStart = useRef<{ id: string; pointerId: number; pointerX: number; pointerY: number; x: number; y: number; width: number; height: number; edge: ResizeEdge; element: HTMLElement; current: { x: number; y: number; width: number; height: number }; viewport: HTMLDivElement | null; scrollStart: number; lastX: number; lastY: number; dragged: boolean; autoScrollFrame: number } | null>(null);
  const canvasGuideXRef = useRef<HTMLDivElement | null>(null);
  const canvasGuideYRef = useRef<HTMLDivElement | null>(null);
  const canvasSnap = false;
  const [componentMenuId, setComponentMenuId] = useState('');
  const canvasMoveStart = useRef<{
    id:string;pointerId:number;pointerX:number;pointerY:number;
    original:{x:number;y:number;width:number;height:number};
    element:HTMLElement;x:number;y:number;
    members:Array<{id:string;original:{x:number;y:number;width:number;height:number};element:HTMLElement}>;
  }|null>(null);
  const [showLayers, setShowLayers] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'Design' | 'Data & Actions' | 'Visibility' | 'Position'>('Design');
  const [ribbonPropertyHost, setRibbonPropertyHost] = useState<HTMLDivElement | null>(null);
  const [ribbonCatalog,setRibbonCatalog]=useState<SharedRibbonCatalog|null>(null);
  const [ribbonCatalogError,setRibbonCatalogError]=useState('');
  useEffect(()=>{
    let active=true;
    void request<SharedRibbonCatalog>('/metadata/builder-ribbon')
      .then(catalog=>{
        if(!active)return;
        if(!Array.isArray(catalog.components)||!Array.isArray(catalog.properties))
          throw Error('Invalid shared property library response');
        setRibbonCatalog(catalog);setRibbonCatalogError('');
      })
      .catch(error=>{if(active)setRibbonCatalogError(error instanceof Error?error.message:'Shared property library unavailable');});
    return ()=>{active=false};
  },[request]);
  const [ribbonFilterDraft,setRibbonFilterDraft] = useState<Record<string,unknown>>({});

  const [ribbonSourceOffset,setRibbonSourceOffset] = useState(0);
  const [additionalPropertyDialogOpen,setAdditionalPropertyDialogOpen] = useState(false);
  const [pageSettingsDialogOpen,setPageSettingsDialogOpen] = useState(false);
  const [advancedEditor,setAdvancedEditor] = useState<AdvancedFeature|null>(null);
  const [inlineActionEvent,setInlineActionEvent]=useState('');
  const [focusedCardMapping,setFocusedCardMapping] = useState('');
  const ribbonStripRef=useRef<HTMLDivElement|null>(null);
  const [canvasBinding,setCanvasBinding]=useState<CanvasBindingTarget|null>(null);
  const [ribbonTab, setRibbonTab] = useState<'Add Block' | 'Component Content' | 'Component Design 2' | 'Component Style' | 'Component Data' | 'Component Action' | 'Component Layout' | 'Component Responsive' | 'Preview' | 'Filters' | 'Source' | 'Arrange' | 'Advanced'>('Add Block');
  const [inspectorSection,setInspectorSection]=useState<string|null>('Body');
  // A canvas click may choose a Design area (Header, Row...) in the same click
  // that selects the component; that area survives the selection reset.
  const nextDesignAreaRef=useRef<string|null>(null);
  useEffect(()=>{
    setInspectorSection(nextDesignAreaRef.current??'Body');
    nextDesignAreaRef.current=null;
  },[selectedId]);
  const chooseCanvasDesignArea=useCallback((area:string)=>{
    nextDesignAreaRef.current=area;
    setInspectorSection(area);
    // Only for this click: a later selection from the layer list starts at Body.
    window.setTimeout(()=>{if(nextDesignAreaRef.current===area)nextDesignAreaRef.current=null;},0);
  },[]);
  // Builder-only marker for the active Design area. DOM attribute only:
  // never a component property, never a re-render of the component.
  useEffect(()=>{
    const viewport=pagePreviewAreaRef.current;
    if(!viewport)return;
    viewport.querySelectorAll('[data-design-area-active]')
      .forEach(node=>node.removeAttribute('data-design-area-active'));
    if(!selectedId||!inspectorSection||inspectorSection==='Body')return;
    const host=Array.from(viewport.querySelectorAll<HTMLElement>('[data-component-id]'))
      .find(node=>node.dataset.componentId===selectedId);
    host?.querySelectorAll<HTMLElement>('[data-design-area]').forEach(node=>{
      if(node.dataset.designArea===inspectorSection
        &&node.closest('[data-component-id]')===host)node.setAttribute('data-design-area-active','true');
    });
  },[selectedId,inspectorSection,page]);
  const componentNeedsData = (type: string) => {
    const metadata = type.startsWith('Custom:') ? findRegisteredComponent(libraryComponents,type.slice('Custom:'.length),'page') : undefined;
    return Boolean(type.startsWith('Custom:')&&isBuilderApi(type.slice(7),ribbonCatalog?.components??[])
      &&(ribbonCatalog?.properties??[]).some(row=>row.tab==='Data'&&row.components.includes(type.slice(7) as BuilderApi)))
      || Boolean(metadata?.propertyDefinitions?.some(definition=>definition.kind==='OBJECT'||definition.kind==='OBJECT_FIELD'))
      || /^(?:Record Field|Record Detail|Related List|List View|Report Chart|Dashboard)$/.test(type);
  };
  const selectCanvasDataBinding=(componentId:string,target:Omit<CanvasBindingTarget,'componentId'|'requestId'>)=>{
    setSelectedId(componentId);setSelectionIds([componentId]);setSelectedRegion(null);
    setCanvasBinding(previous=>({...target,componentId,requestId:(previous?.requestId??0)+1}));
    // The Formula Bar lives in the topbar, so a field icon keeps the current tab.
    setPageSettingsOpen(false);
    openComponentInspector('Data & Actions');
  };
  const selectRibbonTab = (tab: typeof ribbonTab) => {
    // Layout, Arrange and Data are retired: Source sits at the end of Design and the
    // Formula Bar is always in the topbar.
    if(tab==='Component Layout'||tab==='Arrange'||tab==='Component Data')tab='Component Design 2';
    setRibbonTab(tab);
    setPageSettingsDialogOpen(false);
    if (tab === 'Add Block') { setPageSettingsOpen(false); openPalette('Components', 'All Components'); }
    if (tab === 'Advanced') { setPageSettingsOpen(false); }
    if (tab === 'Advanced') setAdvancedEditor('assignments');
    else setAdvancedEditor(null);
    const inspector = { 'Component Design 2': 'Design', 'Arrange': 'Position', 'Component Style': 'Design', 'Component Data': 'Data & Actions', 'Component Content': 'Data & Actions', 'Component Action': 'Visibility', 'Component Layout': 'Position', 'Component Responsive': 'Position' } as const;
    if (tab in inspector) { setPageSettingsOpen(false); openComponentInspector(inspector[tab as keyof typeof inspector]); }
  };
  useEffect(()=>{
    if(!focusedCardMapping||ribbonTab!=='Component Content')return;
    const select=document.querySelector<HTMLSelectElement>(`select[data-card-mapping-field="${focusedCardMapping}"]`);
    if(select)select.focus();
  },[focusedCardMapping,ribbonTab,selectedId]);
  const [componentClipboard, setComponentClipboard] = useState<ComponentClipboard | null>(null);
  const [recordScope, setRecordScope] = useState<PageActivationAssignmentMetadata['scope']>('Org Default');
  const [recordAppId, setRecordAppId] = useState(builderAppApiName || apps[0]?.apiName || '');
  const [recordProfileId, setRecordProfileId] = useState('');
  const [recordTypeId, setRecordTypeId] = useState('');
  const [recordFormFactors, setRecordFormFactors] = useState<Array<'Desktop' | 'Phone' | 'Tablet' | 'Custom'>>(['Desktop']);
  const [homeAppId, setHomeAppId] = useState(apps[0]?.apiName ?? '');
  const [homeScope, setHomeScope] = useState<'App Default' | 'App and Profile'>('App Default');
  const [homeProfileId, setHomeProfileId] = useState('');
  const [homeFormFactors, setHomeFormFactors] = useState<Array<'Desktop' | 'Phone' | 'Tablet' | 'Custom'>>(['Desktop']);
  const [saving, setSaving] = useState(false);
  const [inventoryUploadOpen,setInventoryUploadOpen] = useState(false);
  const [inventoryDownloading,setInventoryDownloading] = useState('');
  // 'Auto' downloads each page's own layout (the one Design opens).
  const [inventoryExportVariant,setInventoryExportVariant] = useState<PageLayoutVariant|'Auto'>('Auto');
  /** Device layouts each page has designed, keyed by page API name. */
  const [layoutSummaries,setLayoutSummaries] = useState<Record<string,PageLayoutSummary>>({});
  const [layoutCopySource,setLayoutCopySource] = useState<PageLayoutVariant|''>('');
  const fetchLayoutSummaries=useCallback(async(names:readonly string[])=>{
    const unique=[...new Set(names)].filter(Boolean).slice(0,500);
    if(!unique.length)return [] as PageLayoutSummary[];
    try{
      const result=await request<{pages:PageLayoutSummary[]}>(
        '/metadata/page-layout-summaries?pages='+unique.map(encodeURIComponent).join(','));
      setLayoutSummaries(current=>{
        const next={...current};
        for(const name of unique)delete next[name];
        for(const summary of result.pages)next[summary.apiName]=summary;
        return next;
      });
      return result.pages;
    }catch{return [] as PageLayoutSummary[];} // A hint only: Design still opens Desktop.
  },[request]);
  const [archivingPageApiName, setArchivingPageApiName] = useState('');
  const [pendingArchivePageApiName, setPendingArchivePageApiName] = useState('');
  const [switchingLayout, setSwitchingLayout] = useState(false);
  const [layoutVersions, setLayoutVersions] = useState<Array<{version:number;createdAt:string;published:boolean;draft:boolean}>>([]);
  const [showLayoutHistory, setShowLayoutHistory] = useState(false);
  const [selectedHistoryVersion, setSelectedHistoryVersion] = useState<number | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const fields = targetObject?.fields ?? [];
  const pageLayouts = targetObject?.pageLayouts ?? [];
  const selected = page.components.find((component) => component.id === selectedId);
  const applyPage = (nextPage: LightningPageMetadata) => {
    // Assign stable, unique names to legacy and newly inserted components in the
    // same normal metadata save path. UUID ids continue to identify runtime nodes.
    try{nextPage={...nextPage,components:ensureComponentInstanceNames(nextPage.components)};}
    catch(error){onNotify(error instanceof Error?error.message:'Duplicate component name');return;}
    if (JSON.stringify(page) === JSON.stringify(nextPage)) return;
    setUndoStack((current) => [...current.slice(-49), page]);
    setRedoStack([]);
    setSelectionUndoStack(current => [...current.slice(-49), { selectedId, selectionIds: [...selectionIds] }]);
    setSelectionRedoStack([]);
    setSavedFeedback(false);
    onChange(nextPage);
  };
  const updateComponent = (id: string, update: Partial<LightningPageMetadata['components'][number]>) => {
    const target = page.components.find(component => component.id === id);
    if (!target) return;
    // Lock prevents accidental edits; an explicit unlock is always allowed.
    if (isCanvasLocked(target) && update.properties?.editorLocked !== false) return;
    const nextUpdate=target.type==='Custom:smart_toggle'&&update.position
      ? {...update,position:{...update.position,height:Math.min(update.position.height,
          Math.max(24,Math.round(update.position.width/1.6)))}}:update;
    const bounded=page.layoutMode==='free-canvas'&&nextUpdate.position
      ?{...nextUpdate,position:constrainCanvasRect(nextUpdate.position,
        {width:page.canvasWidth,height:page.canvasHeight})}:nextUpdate;
    applyPage({ ...page, components: page.components.map((component) => component.id === id ? { ...component, ...bounded } : component) });
  };
  const openComponentInspector = (tab: typeof inspectorTab = 'Design') => {
    setInspectorTab(tab); setPageSettingsOpen(false); setActivePanel('properties'); setComponentMenuId('');
  };
  const openPalette = (tab: typeof paletteTab = 'Components', category?: typeof paletteCategory) => {
    setPaletteTab(tab); if (category) setPaletteCategory(category);
    setActivePanel('palette'); setComponentMenuId(''); setPaletteInsertRegion(null);
  };
  const openAddBlocks = (region: 'header' | 'main' | 'sidebar' | null = null) => {
    setPaletteInsertRegion(region); setPaletteTab('Components'); setPaletteCategory('All Components'); setActivePanel('palette');
  };

  return {
    isPhoneBuilder, builderAppApiName, setBuilderAppApiName, template, targetObject, relatedListOptions,
    defaultRelatedLists, availableComponents, stringList, selectedId, setSelectedId, selectedRegion,
    setSelectedRegion, selectionIds, setSelectionIds, groupEditId, setGroupEditId, openBuilderTabs,
    setOpenBuilderTabs, previewRecords, previewRecordId, setPreviewRecordId, previewRecord,
    previewFieldValue, savedPageApiName, device, setPaletteTab, paletteSearch, paletteInsertRegion,
    setPaletteInsertRegion, paletteCategory, favouriteComponents, setFavouriteComponents,
    recentComponents, setRecentComponents, favouritesLoaded, setFavouritesLoaded, componentPanelWidth,
    setComponentPanelWidth, activePanel, setActivePanel, pageListObject, setPageListObject,
    pageListSearch, setPageListSearch, pageListAppTab, setPageListAppTab, pageListTypeTab,
    setPageListTypeTab, pageListDeviceTab, setPageListDeviceTab, pageListPage, setPageListPage,
    pageListSort, setPageListSort, pageListSortDescending, setPageListSortDescending, changePageListSort,
    pageDetailsApi, setPageDetailsApi, paletteResizeStart, setCustomPropertiesDraft,
    setCustomPropertiesError, previewMode, setPreviewMode, previewPageDefinitionCache,
    externalPreviewWindowRef, externalPreviewTarget, pageSettingsOpen, setPageSettingsOpen,
    loadedEditorVariantRef, dynamicFormsUpgradeOpen, setDynamicFormsUpgradeOpen, migrationLayoutId,
    setMigrationLayoutId, newRecordLinkLabel, setNewRecordLinkLabel, newRecordLinkUrl,
    setNewRecordLinkUrl, fitCanvas, setFitCanvas, fitFullPage, setFitFullPage, canvasZoom, setCanvasZoom,
    fitScale, setFitScale, pagePreviewAreaRef, marqueeOverlayRef, marqueeStartRef,
    suppressCanvasClickRef, pendingInsertedRef, canvasRefreshKey, createPageOpen, setCreatePageOpen,
    createPageTriggerRef, createPageDialogRef, handleCreatePageDialogKey, routeDirectoryOpen,
    setRouteDirectoryOpen, dependenciesOpen, setDependenciesOpen, newPageLabel, setNewPageLabel,
    newPageType, setNewPageType, newRecordMode, setNewRecordMode, newPageTemplate, setNewPageTemplate,
    newPageLayoutMode, setNewPageLayoutMode, newPageTargetObject, setNewPageTargetObject, newPageAppId,
    setNewPageAppId, newPageDevices, setNewPageDevices, newPageDeviceChoice, setNewPageDeviceChoice,
    newPageCanvasWidth, setNewPageCanvasWidth, newPageCanvasHeight, setNewPageCanvasHeight, dragOverId,
    setDragOverId, undoStack, setUndoStack, redoStack, setRedoStack, selectionUndoStack,
    setSelectionUndoStack, selectionRedoStack, setSelectionRedoStack, canvasResizeStart, canvasGuideXRef,
    canvasGuideYRef, canvasSnap, componentMenuId, setComponentMenuId, canvasMoveStart, inspectorTab,
    setInspectorTab, ribbonPropertyHost, setRibbonPropertyHost, ribbonCatalog, setRibbonFilterDraft,
    pageSettingsDialogOpen, setPageSettingsDialogOpen, advancedEditor, setAdvancedEditor,
    inlineActionEvent, setInlineActionEvent, setFocusedCardMapping, ribbonStripRef,
    canvasBinding, ribbonTab, setRibbonTab, inspectorSection,
    setInspectorSection, chooseCanvasDesignArea, componentNeedsData, selectCanvasDataBinding, selectRibbonTab,
    componentClipboard, setComponentClipboard, recordScope, setRecordScope, recordAppId, setRecordAppId,
    recordProfileId, setRecordProfileId, recordTypeId, setRecordTypeId, recordFormFactors,
    setRecordFormFactors, homeAppId, setHomeAppId, homeScope, setHomeScope, homeProfileId,
    setHomeProfileId, homeFormFactors, setHomeFormFactors, saving, setSaving, inventoryUploadOpen,
    setInventoryUploadOpen, inventoryDownloading, setInventoryDownloading, inventoryExportVariant,
    setInventoryExportVariant, layoutSummaries, layoutCopySource, setLayoutCopySource,
    fetchLayoutSummaries, archivingPageApiName, setArchivingPageApiName, pendingArchivePageApiName,
    setPendingArchivePageApiName, switchingLayout, setSwitchingLayout, layoutVersions, setLayoutVersions,
    showLayoutHistory, setShowLayoutHistory, selectedHistoryVersion, setSelectedHistoryVersion,
    setSavedFeedback, fields, pageLayouts, selected, applyPage, updateComponent, openComponentInspector,
    openAddBlocks,
  };
}
