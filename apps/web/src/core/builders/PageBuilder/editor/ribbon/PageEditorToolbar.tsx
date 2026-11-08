import { Pencil, X } from 'lucide-react';
import PageBuilderVisibilityDialog from '../../PageBuilderVisibilityDialog';
import { rawLayoutParentId } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';

import type { usePageEditorState } from '../usePageEditorState';
import type { createPageRibbon } from './createPageRibbon';
import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageComponentProperties } from '../inspector/usePageComponentProperties';

export default function PageEditorToolbar({ editorState, ribbon, props, componentProperties }: {
  editorState: ReturnType<typeof usePageEditorState>;
  ribbon: ReturnType<typeof createPageRibbon>;
  props: PageBuilderProps;
  componentProperties: ReturnType<typeof usePageComponentProperties>;
}) {
  const {
    previewMode, saving, setPageDetailsApi, selected, fields, targetObject, ribbonTab,
    pageSettingsDialogOpen, setPageSettingsDialogOpen, setRibbonPropertyHost,
  } = editorState;
  const { homeValue, dataRibbon, quickAccessOrder } = ribbon;
  const { page, profiles } = props;
  const {
    visibilityEditorOpen, visibilityDraft, setVisibilityDraft, applyVisibilityEditor,
    setVisibilityEditorOpen,
  } = componentProperties;
  return <>
<section className={`office-builder-ribbon ${previewMode ? 'is-interactive-preview' : ''}`} aria-label="Page Builder toolbar">
        <div className="office-ribbon-topbar">
          <div className="office-ribbon-topbar-back">{homeValue('backIcon')}</div>
          <button type="button" className="office-ribbon-icon-button" aria-label="Edit page properties and versions"
            title="Edit page properties and versions" disabled={saving||previewMode}
            onClick={()=>setPageDetailsApi(page.apiName)}><Pencil size={16}/></button>
          <div className="office-ribbon-selection-context" title={selected?.label||selected?.type||'Welcome'}>
            {selected ? 'Page › '+(rawLayoutParentId(selected)
               ? (page.components.find(component=>component.id===rawLayoutParentId(selected))?.label??'Container')+' › '
               : '')+(selected.label||selected.type) : 'Welcome'}
          </div>
          {/* Always-on Formula Bar (filter, image upload, ƒx and the formula) for the
              selected component's data bindings; disabled when nothing is bindable. */}
          <div className="office-ribbon-topbar-formula" role="group" aria-label="Formula Bar">
            {!previewMode&&dataRibbon('formulaBar')||<div className="smart-data-formula-bar is-empty" aria-label="Formula Bar">
              <span className="smart-data-fx-prefix" aria-hidden="true">ƒx</span>
              <div className="smart-data-formula-input"><input type="text" disabled
                aria-label="Formula (select a component with data first)"
                placeholder={selected?'No data bindings for this component':'Select a component'}/></div>
            </div>}
          </div>
          <div className="office-ribbon-quick-access" role="group" aria-label="Quick Access Toolbar">
            {quickAccessOrder.map(key=><span key={key} className={'office-ribbon-quick-action office-ribbon-quick-'+key}>
              {homeValue(key)}
            </span>)}
          </div>
        </div>
      </section>
      {visibilityEditorOpen && selected && <PageBuilderVisibilityDialog
        label={selected.label||selected.type} rules={visibilityDraft} onChange={setVisibilityDraft}
        fields={fields} allowRecordFields={Boolean(targetObject&&page.pageType==='Record Page')}
        profiles={profiles.map(profile=>({id:profile.id,label:profile.label}))}
        recordTypes={(targetObject?.recordTypes??[]).map(type=>({id:type.id,label:type.label}))}
        onApply={applyVisibilityEditor} onClose={()=>setVisibilityEditorOpen(false)}/>}
      {ribbonTab==='Component Design 2' && pageSettingsDialogOpen && <div className="modal-backdrop office-ribbon-modal-backdrop" role="presentation">
        <section className="modal office-ribbon-config-modal office-ribbon-page-settings-modal" role="dialog" aria-modal="true" aria-label="Page settings">
          <div className="modal-header"><h2>Page settings</h2><button type="button" className="icon-button" aria-label="Close page settings" onClick={()=>setPageSettingsDialogOpen(false)}><X size={16}/></button></div>
          <div className="office-ribbon-modal-content"><div className="office-ribbon-inspector-host" ref={setRibbonPropertyHost} aria-label="Page settings editor"/></div>
          <div className="office-ribbon-modal-actions"><button type="button" className="btn btn-brand" onClick={()=>setPageSettingsDialogOpen(false)}>Close</button></div>
        </section>
      </div>}
  </>;
}
