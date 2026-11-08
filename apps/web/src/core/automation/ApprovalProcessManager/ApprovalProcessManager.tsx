import {PlatformPageSlot} from '../../platform/Workspace/PlatformPageSlot';
import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import {generateMetadataApiName,metadataNameConflict,suggestMetadataApiName,apiNameIsValid} from '../../metadata/Definitions/metadataApiNames';
import type {
  ApprovalProcessInput,
  ApprovalProcessMetadata,
  ObjectMetadata,
  UserMetadata
} from '../../metadata/Definitions/metadata';

type ApprovalProcessManagerProps = {
  processes: ApprovalProcessMetadata[];
  objects: ObjectMetadata[];
  users: UserMetadata[];
  canManage: boolean;
  onSave: (process: ApprovalProcessInput) => Promise<void>;
  onDelete: (apiName: string) => Promise<void>;
  onNotify: (message: string) => void;
};


export default function ApprovalProcessManager({
  processes, objects, users, canManage, onSave, onDelete, onNotify
}: ApprovalProcessManagerProps) {
  const [selectedApiName, setSelectedApiName] = useState('');
  const [apiName, setApiName] = useState('');
  const [label, setLabel] = useState('');
  const [objectApiName, setObjectApiName] = useState('');
  const [approverUserIds, setApproverUserIds] = useState<string[]>([]);
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualApiName, setManualApiName] = useState(false);
  const isNew = !selectedApiName;
  const selected = processes.find((item) => item.apiName === selectedApiName);

  useEffect(() => {
    if (selected) {
      setApiName(selected.apiName);
      setLabel(selected.label);
      setObjectApiName(selected.objectApiName);
      setApproverUserIds(selected.approverUserIds);
      setActive(selected.active);
    } else if (!selectedApiName) {
      setApiName('');
      setLabel('');
      setObjectApiName(objects[0]?.apiName ?? '');
      setApproverUserIds([]);
      setActive(false);
    }
  }, [selected, selectedApiName, objects]);

  const startNew = () => {
    setSelectedApiName('');
    setManualApiName(false);
    setApiName('');
    setLabel('');
    setObjectApiName(objects[0]?.apiName ?? '');
    setApproverUserIds([]);
    setActive(false);
  };

  const save = async () => {
    if (!label.trim() || !apiNameIsValid(apiName) || (isNew && metadataNameConflict(apiName,processes.map(process=>process.apiName))) || !objectApiName || !approverUserIds.length) {
      onNotify('Approval process requires a name, object, and at least one approver');
      return;
    }
    setSaving(true);
    try {
      await onSave({ apiName, label, objectApiName, approverUserIds, active });
      setSelectedApiName(apiName);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to save approval process');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Delete approval process "${selected.label}"?`)) return;
    try {
      await onDelete(selectedApiName);
      startNew();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to delete approval process');
    }
  };

  return <div className="approval-process-manager">
    <div className="workspace-heading">
      <div><p className="eyebrow">AUTOMATION</p><h1>Approval Processes</h1><p>Configure reusable, single-step approval routing for Flow submissions.</p></div>
      <button className="btn btn-brand" type="button" disabled={!canManage} onClick={startNew}><Plus size={14} />New Approval Process</button>
    </div>
    {!canManage && <div className="info-callout">You need metadata write or security management permission to configure approval processes.</div>}
    <div className="approval-process-layout">
      <section className="surface approval-process-list" aria-label="Saved approval processes">
        <h2>Saved Processes</h2>
        {processes.length ? processes.map((process) => <button
          className={`approval-process-item${selectedApiName === process.apiName ? ' selected' : ''}`}
          type="button" key={process.apiName} onClick={() => setSelectedApiName(process.apiName)}>
          <strong>{process.label}</strong><span>{process.objectApiName} · {process.active ? 'Active' : 'Draft'}</span>
        </button>) : <p className="empty-list">No approval processes are configured.</p>}
      </section>
      <section className="surface approval-process-editor" aria-label="Approval process details">
        <div className="section-heading"><h2>{isNew ? 'New Approval Process' : 'Process Details'}</h2>{!isNew && canManage && <button className="row-menu" type="button" aria-label="Delete approval process" onClick={() => void remove()}><Trash2 size={15} /></button>}</div>
        <PlatformPageSlot slotKey="field-approval-01"><label className="form-label">Process Label<input className="form-control" value={label} disabled={!canManage || saving} onChange={(event) => {
          const nextLabel = event.target.value;
          setLabel(nextLabel);
          if (isNew && !manualApiName) setApiName(generateMetadataApiName(nextLabel));
        }} /></label></PlatformPageSlot>
        <PlatformPageSlot slotKey="field-approval-02"><details><summary>Advanced: API Name</summary><label className="form-label">Process API Name<input className="form-control" value={apiName} disabled={!canManage || saving || !isNew} onChange={(event) => {setManualApiName(true);setApiName(event.target.value.toLowerCase());}} /></label></details>
        {!manualApiName&&<p className="settings-panel-copy">API Name: {apiName||'Generated from label'}</p>}
        {isNew&&metadataNameConflict(apiName,processes.map(process=>process.apiName))&&<p role="alert" className="formula-validation-error">API Name already exists.
        <button type="button" className="btn" onClick={()=>{setManualApiName(true);setApiName(suggestMetadataApiName(apiName,processes.map(process=>process.apiName)));}}>Use suggested name</button></p>}</PlatformPageSlot>
        <PlatformPageSlot slotKey="field-approval-03"><label className="form-label">Object<select className="form-control" value={objectApiName} disabled={!canManage || saving} onChange={(event) => setObjectApiName(event.target.value)}><option value="">Select an object</option>{objects.filter((object) => object.apiName !== 'User').map((object) => <option key={object.apiName} value={object.apiName}>{object.label}</option>)}</select></label></PlatformPageSlot>
        <PlatformPageSlot slotKey="field-approval-04"><label className="form-label">Approver Users<select className="form-control" multiple size={Math.min(7, Math.max(3, users.length))} value={approverUserIds} disabled={!canManage || saving} onChange={(event) => setApproverUserIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.username}</option>)}</select></label></PlatformPageSlot>
        <PlatformPageSlot slotKey="field-approval-05"><label className="checkbox-row"><input type="checkbox" checked={active} disabled={!canManage || saving} onChange={(event) => setActive(event.target.checked)} />Active</label></PlatformPageSlot>
        <p className="settings-panel-copy">The first assigned approver to approve or reject resolves the submission. Flow runtime verifies the submitter can edit the record and every approver can read it.</p>
        <button className="btn btn-brand" type="button" disabled={!canManage || saving} onClick={() => void save()}><Save size={14} />{saving ? 'Saving…' : 'Save Approval Process'}</button>
      </section>
    </div>
  </div>;
}
