import ResponsiveDataList from '../../../../records/ResponsiveDataList/ResponsiveDataList';
import PageManagerTabs from '../../PageManagerTabs';
import { Download, Upload, Pencil, Power, Plus, Trash2 } from 'lucide-react';
import { canvasOrientation } from '../../../../pages/PageRuntime/pageCanvas';
import { type LightningPageMetadata, type PageLayoutVariant } from '../../../../metadata/Definitions/metadata';
import PageDetailsDialog from '../../PageDetailsDialog';
import PageDesignSplitAction from '../../PageDesignSplitAction';
import PageInventoryImportDialog from '../../PageInventoryImportDialog';

import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageEditorState } from '../usePageEditorState';
import type { usePageManagement } from './usePageManagement';
import type { usePageLayoutActions } from './usePageLayoutActions';

export default function PageManagerView({ props, editorState, management, layoutActions }: {
  props: PageBuilderProps;
  editorState: ReturnType<typeof usePageEditorState>;
  management: ReturnType<typeof usePageManagement>;
  layoutActions: ReturnType<typeof usePageLayoutActions>;
}) {
  const {
    editorMode, recordPageContext, objects, onDeactivate, apps, request, page, onChange, onNotify,
    pages, profiles, onUpdatePageDetails, onSave,
  } = props;
  const {
    createPageTriggerRef, saving, setInventoryUploadOpen, inventoryExportVariant,
    setInventoryExportVariant, pageListTypeTab, pageListAppTab, setPageListTypeTab,
    setPageListPage, setPageListAppTab, pageListObject, setPageListObject, pageListSearch,
    setPageListSearch, pageListDeviceTab, setPageListDeviceTab, pageListSort, setPageListSort,
    setPageListSortDescending, pageListSortDescending, setPageDetailsApi, inventoryDownloading,
    layoutSummaries, archivingPageApiName, setPendingArchivePageApiName, changePageListSort,
    inventoryUploadOpen, pageDetailsApi,
  } = editorState;
  const {
    openCreatePage, pageAppTabs, paginatedPages, openPageDesign, pageDeviceLabel, layoutBadges,
    downloadPageInventory, savePage, showRelatedObjectColumn, visiblePages, safePageListPage,
    pageListPageCount,
  } = management;
  const { openPageDesignLayout } = layoutActions;
  return <>
{!editorMode && <section className="page-manager-view" aria-label="Page management">
        <header className="page-manager-header"><div><h1>{recordPageContext ? 'Record Page Editor' : 'Page Builder'}</h1><p>{recordPageContext ? 'Object-owned record pages: view, edit, activate and publish device layouts.' : 'Manage Home and App Pages. Record Pages are managed inside Object Manager.'}</p></div>
          <div className="page-manager-header-actions">
            <button ref={createPageTriggerRef} className="btn btn-brand" type="button" onClick={openCreatePage}><Plus size={16}/> New Page</button>
            <button className="btn" type="button" disabled={saving} onClick={()=>setInventoryUploadOpen(true)}><Upload size={16}/> Upload CSV</button>
            <select className="form-control" aria-label="Inventory CSV device layout" title="Layout used by page inventory downloads"
              style={{width:'min(172px, 100%)',minWidth:0,maxWidth:'100%',boxSizing:'border-box'}} value={inventoryExportVariant} onChange={event=>setInventoryExportVariant(event.target.value as PageLayoutVariant|'Auto')}>
              <option value="Auto">CSV: Page’s layout</option>
              {(['Desktop','Tablet','Mobile','Custom'] as const).map(device=><option key={device} value={device}>CSV: {device}</option>)}
            </select>
          </div></header>
        {!recordPageContext && <PageManagerTabs
          type={pageListTypeTab} app={pageListAppTab} apps={pageAppTabs}
          onTypeChange={value=>{setPageListTypeTab(value);setPageListPage(1);}}
          onAppChange={value=>{setPageListAppTab(value);setPageListPage(1);}}/>}
        <div className="page-manager-filters">
          <label className="form-label">Related Record / Object<select className="form-control" value={pageListObject} aria-label="Related Record or Object" onChange={event=>setPageListObject(event.target.value)}><option value="">All objects</option>{objects.map(item=><option key={item.apiName} value={item.apiName}>{item.label}</option>)}</select></label>
          <label className="form-label">Search pages<input className="form-control" type="search" value={pageListSearch} onChange={event=>setPageListSearch(event.target.value)} placeholder="Search page name…"/></label>
          {!recordPageContext && <label className="form-label page-manager-layout-filter">Layout
            <select className="form-control" aria-label="Layout" value={pageListDeviceTab} onChange={event=>setPageListDeviceTab(event.target.value)}>
              <option value="all">All devices</option>{['Desktop','Tablet','Mobile','Custom'].map(device=><option key={device} value={device}>{device}</option>)}
            </select>
          </label>}
        </div>
        <div className="page-manager-mobile-sort"><label htmlFor="page-manager-card-sort">Sort pages</label>
          <select className="form-control" id="page-manager-card-sort" value={pageListSort} onChange={event=>{setPageListSort(event.target.value as typeof pageListSort);setPageListSortDescending(event.target.value==='updatedAt');setPageListPage(1);}}>
           <option value="updatedAt">Last modified</option><option value="label">Page name</option>
           <option value="apiName">API name</option><option value="status">Status</option>
          </select>
          <button type="button" className="btn page-manager-sort-direction"
           aria-label={'Sort '+(pageListSortDescending?'ascending':'descending')}
           onClick={()=>{setPageListSortDescending(value=>!value);setPageListPage(1);}}>
            {pageListSortDescending?'↓ Descending':'↑ Ascending'}
          </button>
        </div>
        <ResponsiveDataList rows={paginatedPages} includeTablet includeNarrowDesktop getId={item=>item.apiName}
          label="Page Manager pages" emptyText={pageListSearch||pageListObject||pageListDeviceTab!=="all"?"No pages match the selected filters.":"No pages of this type exist yet."}
          onOpen={item=>void openPageDesign(item.apiName)} openLabel="Open page designer"
          columns={[
            {apiName:'label',label:'Page',phoneRole:'title',render:item=>item.label},
            {apiName:'api',label:'API name',phoneRole:'subtitle',render:item=>item.apiName},
            {apiName:'status',label:'Status',phoneRole:'badge',render:item=>item.status},
            {apiName:'type',label:'Type',render:item=>item.pageType},
            {apiName:'device',label:'Devices',phoneRole:'trailing',render:item=><>{pageDeviceLabel(item)}{layoutBadges(item)}</>},
            {apiName:'actions',label:'Actions',render:item=><div className="page-manager-mobile-actions">
              <button type="button" className="btn" aria-label={"Page properties for "+item.label} disabled={saving} onClick={()=>setPageDetailsApi(item.apiName)}>Page properties</button>
              <button type="button" className="btn" aria-label={"Download component inventory for "+item.label}
                disabled={Boolean(inventoryDownloading)} onClick={()=>void downloadPageInventory(item)}>Download inventory</button>
              <PageDesignSplitAction label={item.label} summary={layoutSummaries[item.apiName]}
                onOpenDefault={()=>void openPageDesign(item.apiName)}
                onOpenLayout={variant=>void openPageDesignLayout(item.apiName,variant)}/>
              <button type="button" className="btn" aria-label={(item.status==="Active"?"Deactivate ":"Activate ")+item.label} disabled={saving} onClick={()=>void(item.status==='Active'?onDeactivate(item.apiName):savePage('Active',item,true))}>{item.status==='Active'?'Deactivate':'Activate'}</button>
              <button type="button" className="btn" aria-label={"Delete "+item.label} disabled={saving||Boolean(archivingPageApiName)} onClick={()=>setPendingArchivePageApiName(item.apiName)}>Delete</button>
            </div>}
          ]}/>
        <div className="page-manager-table-scroll md-mobile-table-replaced md-tablet-table-replaced"><table className="records-table page-manager-table"><thead><tr>
          <th scope="col" className="page-manager-actions-heading">Actions</th>
          {([['label','Page name'],['apiName','API name']] as const).map(([key,label])=>
            <th key={key} scope="col" aria-sort={pageListSort===key?(pageListSortDescending?'descending':'ascending'):undefined}>
              <button className="page-manager-sort-button" type="button" onClick={()=>changePageListSort(key)}>{label} {pageListSort===key&&<span className="md-sort-indicator" aria-hidden="true">{pageListSortDescending?'↓':'↑'}</span>}</button>
            </th>)}
          <th scope="col">Application</th><th scope="col">Version</th>
          {showRelatedObjectColumn&&<th scope="col">Related object</th>}<th scope="col">Layout</th>
          <th scope="col" aria-sort={pageListSort==='updatedAt'?(pageListSortDescending?'descending':'ascending'):undefined}>
            <button className="page-manager-sort-button" type="button" onClick={()=>changePageListSort('updatedAt')}>Last modified {pageListSort==='updatedAt'&&<span className="md-sort-indicator" aria-hidden="true">{pageListSortDescending?'↓':'↑'}</span>}</button>
          </th>
          <th scope="col" aria-sort={pageListSort==='status'?(pageListSortDescending?'descending':'ascending'):undefined}>
            <button className="page-manager-sort-button" type="button" onClick={()=>changePageListSort('status')}>Status {pageListSort==='status'&&<span className="md-sort-indicator" aria-hidden="true">{pageListSortDescending?'↓':'↑'}</span>}</button>
          </th>
        </tr></thead>
        <tbody>{paginatedPages.map(item=><tr key={item.apiName}>
          <td className="page-manager-actions">
            <div className="page-manager-action-icons" role="group" aria-label={'Actions for '+item.label}>
              <button className="page-manager-icon-action" type="button" disabled={saving}
                aria-label={'Edit page properties for '+item.label} title="Edit page properties"
                onClick={()=>setPageDetailsApi(item.apiName)}><Pencil size={16}/></button>
              <button className="page-manager-icon-action" type="button" disabled={Boolean(inventoryDownloading)}
                aria-label={'Download component inventory for '+item.label} title="Download component inventory CSV"
                onClick={()=>void downloadPageInventory(item)}><Download size={16}/></button>
              <PageDesignSplitAction label={item.label} summary={layoutSummaries[item.apiName]}
                onOpenDefault={()=>void openPageDesign(item.apiName)}
                onOpenLayout={variant=>void openPageDesignLayout(item.apiName,variant)}/>
              <button className={'page-manager-icon-action page-manager-toggle'+(item.status==='Active'?' is-active':'')} type="button"
                disabled={saving}
                aria-label={(item.status==='Active'?'Deactivate ':'Activate ')+item.label}
                title={item.status==='Active'?'Deactivate page':'Activate page'}
                onClick={()=>void(item.status==='Active'?onDeactivate(item.apiName):savePage('Active',item,true))}><Power size={16}/></button>
              <button className="page-manager-icon-action page-manager-delete" type="button"
                disabled={saving||Boolean(archivingPageApiName)}
                aria-label={(archivingPageApiName===item.apiName?'Deleting ':'Delete ')+item.label}
                title={archivingPageApiName===item.apiName?'Deleting page…':'Delete page'}
                onClick={()=>setPendingArchivePageApiName(item.apiName)}><Trash2 size={16}/></button>
            </div>
          </td>
          <td><button type="button" className="page-manager-page-link" onClick={()=>void openPageDesign(item.apiName)}>{item.label}</button></td><td title={item.apiName}><code>{item.apiName}</code></td>
          <td>{apps.find(app=>app.navigationPageApiNames.includes(item.apiName)
            ||(item.activationAssignments??[]).some(a=>a.appId===app.apiName))?.label??'—'}</td>
          <td>{item.publishedRevision?'v'+item.publishedRevision:'—'}</td>
          {showRelatedObjectColumn&&<td>{item.targetObject ? objects.find(object=>object.apiName===item.targetObject)?.label ?? item.targetObject : '—'}</td>}
          <td title={item.pageType+' · '+pageDeviceLabel(item)+' · '+item.canvasWidth+' × '+item.canvasHeight+' · '+canvasOrientation(item.canvasWidth,item.canvasHeight)}>
            <strong>{pageDeviceLabel(item)}{layoutBadges(item)}</strong>
            <small className="page-manager-layout-metadata">{item.pageType} · {item.canvasWidth} × {item.canvasHeight}</small>
          </td>
          <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '—'}</td>
          <td><span className={item.status === 'Active' ? 'page-status-badge active' : 'page-status-badge'}>{item.status}</span></td>

        </tr>)}</tbody></table>{!visiblePages.length && <div className="records-empty">{!recordPageContext && pageListTypeTab === 'Record Page' ? 'Record Pages are managed inside Object Manager. Choose an object there to manage its record pages.' : pageListSearch||pageListObject||pageListDeviceTab!=='all'?'No pages match the selected filters. Clear filters to see all pages.':'No pages of this type exist yet. Create a new page to begin.'}</div>}</div>
        <nav className="flow-existing-pagination" aria-label="Page list pagination">
          <span>{visiblePages.length} {visiblePages.length===1?"page":"pages"} · Page {safePageListPage} of {pageListPageCount}</span>
          <button className="btn" disabled={safePageListPage<=1} onClick={()=>setPageListPage(safePageListPage-1)}>Previous</button>
          <button className="btn" disabled={safePageListPage>=pageListPageCount} onClick={()=>setPageListPage(safePageListPage+1)}>Next</button>
        </nav>
      </section>}
      {inventoryUploadOpen&&<PageInventoryImportDialog
        request={request}
        onClose={()=>setInventoryUploadOpen(false)}
        onApplied={(updatedPages,changes)=>{
          const current=updatedPages.find(updated=>updated.apiName===page.apiName
            &&(updated.layoutVariant??'Desktop')===(page.layoutVariant??'Desktop'));
          if(current)onChange(current);
          onNotify(changes+' component metadata changes saved across '+
            updatedPages.length+' existing page drafts. Publish each updated layout when ready.');
          setInventoryUploadOpen(false);
        }}/>}
      {pageDetailsApi&&(()=>{
        // In the builder the open layout is the context; from the page list,
        // use the listed page so Edit Page defaults to the page's own layout.
        const detailsPage=editorMode&&page.apiName===pageDetailsApi?page:
          pages.find(item=>item.apiName===pageDetailsApi)??(page.apiName===pageDetailsApi?page:null);
        return detailsPage?<PageDetailsDialog key={pageDetailsApi} page={detailsPage}
          layoutSummary={layoutSummaries[detailsPage.apiName]??null}
          apps={apps} profiles={profiles}
          recordTypes={objects.find(item=>item.apiName===detailsPage.targetObject)?.recordTypes??[]}
          disabled={saving} request={request}
          onClose={()=>setPageDetailsApi(null)} onSave={onUpdatePageDetails}
          onSaveAssignments={async (source,activationAssignments)=>{
            // Load the current full SQL draft for pages outside the active canvas; never
            // write an old Page Manager list snapshot over a newer component layout.
            const current=editorMode&&page.apiName===source.apiName?page:
              (await request<{page:LightningPageMetadata}>(
                `/metadata/pages/${encodeURIComponent(source.apiName)}/layouts/${source.layoutVariant??'Desktop'}/editor`)).page;
            if(JSON.stringify(current.activationAssignments??[])!==JSON.stringify(source.activationAssignments??[])){
              onNotify('Page activation assignments changed. Reload Page Details before saving.');
              return false;
            }
            return onSave({...current,activationAssignments,
              status:current.status==='Active'&&!activationAssignments.length?'Draft':current.status},
              source.apiName,'Page activation assignments saved to the draft');
          }}
          onOpenDesign={openPageDesignLayout} onReload={onChange}/>:null;
      })()}
  </>;
}
