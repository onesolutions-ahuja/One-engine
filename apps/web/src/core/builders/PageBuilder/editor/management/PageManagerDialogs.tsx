import { Plus, X } from 'lucide-react';
import PageRouteDirectory from '../../../../pages/PageRouteDirectory/PageRouteDirectory';
import { inspectPageDependencies } from '../../../../pages/PageRuntime/pageDependencies';
import { pageBuilderStartOptions } from '../../pageBuilderUx';

import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageEditorState } from '../usePageEditorState';
import type { usePageManagement } from './usePageManagement';

export default function PageManagerDialogs({ props, editorState, management }: {
  props: PageBuilderProps;
  editorState: ReturnType<typeof usePageEditorState>;
  management: ReturnType<typeof usePageManagement>;
}) {
  const {
    editorMode, pages, page, apps, objects, reports, dashboards, flows, libraryComponents, request,
    canManageRoutes, onNotify, recordPageContext,
  } = props;
  const {
    pendingArchivePageApiName, archivingPageApiName, setPendingArchivePageApiName,
    dependenciesOpen, setDependenciesOpen, setSelectedId, routeDirectoryOpen, builderAppApiName,
    setRouteDirectoryOpen, createPageOpen, setCreatePageOpen, createPageDialogRef,
    handleCreatePageDialogKey, newPageLabel, setNewPageLabel, newPageType, newPageTargetObject,
    setNewPageTargetObject, newPageAppId, setNewPageAppId, setNewPageType, setNewPageTemplate,
    setNewPageLayoutMode, newPageDeviceChoice, setNewPageCanvasWidth, setNewPageCanvasHeight,
    newPageCanvasWidth, newPageCanvasHeight, newRecordMode, setNewRecordMode,
    setNewPageDeviceChoice, setNewPageDevices, saving,
  } = editorState;
  const { archiveSavedPage, createPage } = management;
  return <>
{!editorMode && pendingArchivePageApiName && (() => {
        const toArchive = pages.find(candidate => candidate.apiName === pendingArchivePageApiName);
        return toArchive ? <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-lightning-page-title">
            <div className="modal-header"><h2 id="delete-lightning-page-title">Delete page</h2></div>
            <p className="modal-copy">Archive <strong>{toArchive.label}</strong>?</p>
            <p className="modal-copy">The page will be removed from the live page list. Its SQL metadata,
              layouts and version history are preserved. App-owned and app-home pages may require reassignment or AppExchange management.</p>
            <div className="modal-actions">
              <button className="btn" type="button" disabled={Boolean(archivingPageApiName)}
                onClick={()=>setPendingArchivePageApiName('')}>Cancel</button>
              <button className="btn btn-brand" type="button" disabled={Boolean(archivingPageApiName)}
                onClick={()=>void archiveSavedPage(toArchive)}>
                {archivingPageApiName ? 'Deleting…' : 'Delete page'}
              </button>
            </div>
          </section>
        </div> : null;
      })()}
      {dependenciesOpen && <div className="modal-backdrop" role="presentation"
        onMouseDown={event => { if (event.target === event.currentTarget) setDependenciesOpen(false); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="page-dependencies-title"
          style={{maxHeight:'85vh',overflowY:'auto'}}>
          <div className="modal-header"><h2 id="page-dependencies-title">Page dependencies</h2>
            <button className="btn btn-small" type="button" onClick={() => setDependenciesOpen(false)}>Close</button></div>
          <p className="modal-copy">References use saved objects, apps, reports, dashboards, components and Flows.</p>
          <table className="records-table" aria-label="Page dependencies"><thead><tr><th>Type</th><th>Reference</th><th>Status</th><th>Source</th></tr></thead><tbody>
            {inspectPageDependencies(page, {apps,pages,objects,reports,dashboards,flows,libraryComponents}).map((entry,idx) =>
              <tr key={entry.kind + ':' + entry.name + ':' + idx}><td>{entry.kind}</td><td>{entry.name}</td>
                <td>{entry.status}</td><td>{entry.componentId
                  ? <button className="btn btn-small" type="button" onClick={() => {setSelectedId(entry.componentId!);setDependenciesOpen(false);}}>{entry.description}</button>
                  : entry.description}</td></tr>)}
          </tbody></table>
        </section>
      </div>}
      {routeDirectoryOpen && <PageRouteDirectory apps={apps} pages={pages} objects={objects}
        initialAppId={builderAppApiName} selectedPageApiName={page.apiName} basePath={import.meta.env.BASE_URL}
        request={request} canManage={canManageRoutes}
        onNotify={onNotify} onClose={() => setRouteDirectoryOpen(false)} />}
      {createPageOpen && <div className="modal-backdrop" role="presentation"
        onMouseDown={event => { if (event.target === event.currentTarget) setCreatePageOpen(false); }}>
        <section ref={createPageDialogRef} onKeyDown={handleCreatePageDialogKey} className="modal builder-create-page-dialog" role="dialog" aria-modal="true" aria-labelledby="create-lightning-page-title">
          <div className="modal-header">
            <h2 id="create-lightning-page-title">Create a page</h2>
            <button className="icon-button dark" type="button" onClick={() => setCreatePageOpen(false)} aria-label="Close"><X size={18} /></button>
          </div>
          <div className="builder-create-page-grid">
            <div className="builder-create-page-fields">
              <p className="modal-copy">Start with the page you need. You can adjust its blocks and appearance later.</p>
              <label className="form-label" htmlFor="new-lightning-page-label">Page name (required)
                <input id="new-lightning-page-label" className="form-control" required autoFocus
                  value={newPageLabel} onChange={event => setNewPageLabel(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') void createPage(); }}
                  placeholder="For example, Inventory Management" />
                {!newPageLabel.trim()&&<small className="builder-create-page-required-hint">Enter a page name to enable Create draft.</small>}
              </label>
              <label className="form-label" htmlFor="new-lightning-page-object">Connect to data {newPageType === 'Record Page' ? '(required)' : '(optional)'}
                <select id="new-lightning-page-object" className="form-control" required={newPageType==='Record Page'} value={newPageTargetObject}
                  onChange={event => setNewPageTargetObject(event.target.value)}>
                  {!recordPageContext && <option value="">No data object — bind later</option>}
                  {objects.filter(object => !recordPageContext || object.apiName === recordPageContext).map(object => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}
                </select>
              </label>
              <label className="form-label" htmlFor="new-lightning-page-app">Application (optional)
                <select id="new-lightning-page-app" className="form-control" value={newPageAppId}
                  onChange={event => setNewPageAppId(event.target.value)}>
                  <option value="">Assign later</option>
                  {apps.map(app => <option key={app.apiName} value={app.apiName}>{app.label}</option>)}
                </select>
              </label>
            </div>
            <div className="builder-create-page-options">
              <p className="properties-help builder-create-page-help">
                {newPageType === 'App Page'
                  ? "When you activate this page, it will be added to the chosen application's navigation."
                  :newPageType==='In-Screen Page'?'In-screen windows are reusable and not added to navigation. Their application association controls ownership and filtering.'
                  :'For Home and Record pages, choosing an application prepares an App Default assignment. You can change it before activation.'}
              </p>
              <fieldset className="builder-start-choices">
                <legend>What do you want to build?</legend>
                <div role="radiogroup" aria-label="Choose page type" className="builder-choice-grid">
                  {pageBuilderStartOptions.filter(choice => recordPageContext ? choice.type === 'Record Page' : choice.type !== 'Record Page').map(choice => <label key={choice.type} className={newPageType === choice.type ? 'builder-choice active' : 'builder-choice'}>
                    <input type="radio" name="builder-new-page-type" value={choice.type} checked={newPageType === choice.type}
                      onChange={() => {
                        setNewPageType(choice.type);
                        setNewPageTargetObject(choice.type === 'Record Page' ? (recordPageContext || '') : '');
                        setNewPageTemplate(choice.type === 'Record Page' ? 'header-main-sidebar' : 'main-sidebar');
                        if(choice.type==='In-Screen Page')setNewPageLayoutMode('free-canvas');
                        const size = choice.type==='Print Template'?[794,1123]:newPageDeviceChoice === 'Phone' ? [390,844]
                          : newPageDeviceChoice === 'Tablet' ? [1024,768]
                          : newPageDeviceChoice === 'Custom' ? [1440,900]
                          : choice.type === 'In-Screen Page' ? [480,420] : [1440,900];
                        setNewPageCanvasWidth(size[0]);setNewPageCanvasHeight(size[1]);
                      }}/>
                    <strong>{choice.title}</strong><span>{choice.description}</span>
                  </label>)}
                </div>
              </fieldset>
              {newPageType==='Print Template'&&<label className="form-label">Paper size
                <select className="form-control" value={newPageCanvasWidth+'x'+newPageCanvasHeight}
                  onChange={event=>{const [w,h]=event.target.value.split('x').map(Number);setNewPageCanvasWidth(w);setNewPageCanvasHeight(h);}}>
                  <option value="794x1123">A4</option><option value="816x1056">Letter</option>
                  <option value="559x794">A5</option>
                  {!['794x1123','816x1056','559x794'].includes(newPageCanvasWidth+'x'+newPageCanvasHeight)&&
                    <option value={newPageCanvasWidth+'x'+newPageCanvasHeight}>Custom canvas size</option>}
                </select></label>}
              {recordPageContext && <label className="form-label">Record operation
                <select className="form-control" value={newRecordMode} onChange={event=>setNewRecordMode(event.target.value as 'View'|'Edit')}>
                  <option value="View">View records</option><option value="Edit">Edit records</option>
                </select>
              </label>}
              <label className="form-label">Design for
                <select className="form-control" aria-label="Target device" value={newPageDeviceChoice} onChange={event => {
                  const target = event.target.value as 'Desktop' | 'Tablet' | 'Phone' | 'Custom';
                  setNewPageDeviceChoice(target);
                  setNewPageDevices([target]);
                  const size = target === 'Phone' ? [390,844] : target === 'Tablet' ? [1024,768]
                    : target === 'Custom' ? [1440,900]
                    : newPageType === 'In-Screen Page' ? [480,420] : [1440,900];
                  setNewPageCanvasWidth(size[0]); setNewPageCanvasHeight(size[1]);
                }}>
                  <option value="Desktop">Desktop</option><option value="Phone">Mobile</option>
                  <option value="Tablet">Tablet</option><option value="Custom">Custom</option>
                </select>
              </label>
            </div>
          </div>
          <div className="modal-actions builder-create-page-actions">
            {newPageType==='Record Page'&&!newPageTargetObject&&<small role="status">Choose a data object to create this Record Page.</small>}
            <button className="btn" type="button" onClick={() => setCreatePageOpen(false)}>Cancel</button>
            <button className="btn btn-brand" type="button"
              disabled={saving || !newPageLabel.trim() || (newPageType === 'Record Page' && !newPageTargetObject)}
              onClick={() => void createPage()}><Plus size={14} />{saving ? 'Creating…' : 'Create draft'}</button>
          </div>
        </section>
      </div>}
  </>;
}
