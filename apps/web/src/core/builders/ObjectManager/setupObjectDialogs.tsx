// @ts-nocheck
// Object creation and tab configuration are tenant-metadata actions.
import { X } from 'lucide-react';
export default function SetupObjectDialogs({ context }: { context: any }) {
  const { showNewObject, setShowNewObject, setShowCustomTabWizard, newObjectLabel, setNewObjectLabel, newObjectPluralLabel, setNewObjectPluralLabel, newObjectRecordNameLabel, setNewObjectRecordNameLabel, newObjectSettings, setNewObjectSettings, newObjectDescription, setNewObjectDescription, launchCustomTabWizard, setLaunchCustomTabWizard, createObject, showCustomTabWizard, customTabObject, setCustomTabObject, customTabStyle, setCustomTabStyle, customTabStyles, customTabAppIds, setCustomTabAppIds, apps, saveCustomTab } = context;
  const closeNewObject=()=>{setShowNewObject(false);requestAnimationFrame(()=>document.querySelector<HTMLElement>('[aria-label="Create new object"]')?.focus());};
  return <>
      {showNewObject && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeNewObject(); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-object-title" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();closeNewObject();}}}>
            <div className="modal-header"><h2 id="new-object-title">New Custom Object</h2><button className="icon-button dark" type="button" onClick={closeNewObject} aria-label="Close"><X size={18} /></button></div>
            <p className="modal-copy">Define the object labels and description. A required record-name field and default layouts are created with it.</p>
            <label className="form-label" htmlFor="new-object-label">Label</label>
            <input className="form-control" id="new-object-label" value={newObjectLabel} onChange={(event) => setNewObjectLabel(event.target.value)} placeholder="For example, Project" autoFocus />
            <label className="form-label" htmlFor="new-object-plural">Plural Label</label>
            <input className="form-control" id="new-object-plural" value={newObjectPluralLabel} onChange={(event) => setNewObjectPluralLabel(event.target.value)} placeholder="For example, Projects" />
            <label className="form-label" htmlFor="new-object-record-name">Record Name Label</label>
            <input className="form-control" id="new-object-record-name" value={newObjectRecordNameLabel} onChange={(event) => setNewObjectRecordNameLabel(event.target.value)} placeholder={`${newObjectLabel || 'Object'} Name`} />
            <label className="form-label" htmlFor="new-object-record-name-type">Record Name Data Type</label>
            <select className="form-control" id="new-object-record-name-type" value={newObjectSettings.recordNameType} onChange={(event) => setNewObjectSettings((current) => ({ ...current, recordNameType: event.target.value as ObjectSettingsMetadata['recordNameType'], recordNameFormat: event.target.value === 'Auto Number' ? current.recordNameFormat || 'REC-{0000}' : '' }))}><option>Text</option><option>Auto Number</option></select>
            {newObjectSettings.recordNameType === 'Auto Number' && <label className="form-label">Display Format<input className="form-control" value={newObjectSettings.recordNameFormat} onChange={(event) => setNewObjectSettings((current) => ({ ...current, recordNameFormat: event.target.value }))} placeholder="REC-{0000}" /></label>}
            <label className="form-label" htmlFor="new-object-description">Description</label>
            <textarea className="form-control" id="new-object-description" value={newObjectDescription} onChange={(event) => setNewObjectDescription(event.target.value)} rows={3} />
            <div className="metadata-card"><h3>Optional Features</h3>{([
              ['allowReports', 'Allow Reports'],
              ['allowActivities', 'Allow Activities'],
              ['trackFieldHistory', 'Track Field History'],
              ['allowInChatter', 'Allow in Chatter']
            ] as const).map(([key, label]) => <label className="metadata-row" key={key}><span>{label}</span><input type="checkbox" checked={newObjectSettings[key]} onChange={(event) => setNewObjectSettings((current) => ({ ...current, [key]: event.target.checked }))} /></label>)}<label className="form-label">Deployment Status<select className="form-control" value={newObjectSettings.deploymentStatus} onChange={(event) => setNewObjectSettings((current) => ({ ...current, deploymentStatus: event.target.value as ObjectSettingsMetadata['deploymentStatus'] }))}><option>In Development</option><option>Deployed</option></select></label></div>
            <label className="checkbox-row"><input type="checkbox" checked={launchCustomTabWizard} onChange={(event) => setLaunchCustomTabWizard(event.target.checked)} />Launch New Custom Tab Wizard after saving this custom object</label>
            <div className="modal-actions"><button className="btn" type="button" onClick={closeNewObject}>Cancel</button><button className="btn btn-brand" type="button" onClick={createObject} disabled={!newObjectLabel.trim() || !newObjectPluralLabel.trim() || (newObjectSettings.recordNameType === 'Auto Number' && !newObjectSettings.recordNameFormat.trim())}>Save</button></div>
          </section>
        </div>
      )}
      {showCustomTabWizard && customTabObject && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal custom-tab-wizard" role="dialog" aria-modal="true" aria-labelledby="custom-tab-wizard-title">
            <div className="modal-header"><h2 id="custom-tab-wizard-title">New Custom Object Tab</h2><button className="icon-button dark" onClick={() => { setShowCustomTabWizard(false); setCustomTabObject(null); }} aria-label="Close"><X size={18} /></button></div>
            <p className="modal-copy">Choose an icon and colour for {customTabObject.label} in Records navigation. The tab does not grant record permissions.</p>
            <h3 className="custom-tab-section-title">Select a Tab Style</h3>
            <div className="custom-tab-style-grid" role="group" aria-label="Tab style">
              {customTabStyles.map((style) => (
                <button
                  className={customTabStyle === style.name ? 'custom-tab-style selected' : 'custom-tab-style'}
                  key={style.name}
                  type="button"
                  aria-pressed={customTabStyle === style.name}
                  onClick={() => setCustomTabStyle(style.name)}
                >
                  <span className="custom-tab-style-icon" style={{ backgroundColor: style.color }}><style.icon size={18} /></span>
                  <span>{style.name}</span>
                </button>
              ))}
            </div>
            <fieldset className="custom-tab-app-selection">
              <legend>Add to installed applications</legend>
              <p className="permission-help">Select the applications where this object tab should appear.
                Each app update requires its own OneEngine permissions.</p>
              {(apps??[]).filter(app=>app.apiName!=='Records').map(app=>
                <label className="metadata-row" key={app.apiName}>
                  <span>{app.label}</span>
                  <input type="checkbox"
                    checked={customTabAppIds.includes(app.apiName)}
                    onChange={event=>setCustomTabAppIds(current=>event.target.checked
                      ?[...new Set([...current,app.apiName])]
                      :current.filter(id=>id!==app.apiName))}/>
                </label>)}
              {!(apps??[]).some(app=>app.apiName!=='Records')&&
                <p className="permission-help">No additional installed app navigation is available.</p>}
            </fieldset>
            <div className="modal-actions"><button className="btn" onClick={() => { setShowCustomTabWizard(false); setCustomTabObject(null); }}>Cancel</button><button className="btn btn-brand" onClick={() => void saveCustomTab()}>Save</button></div>
          </section>
        </div>
      )}
  </>;
}
