import { Database, RefreshCw, Search } from 'lucide-react';
import {RecordObjectPicker} from '../RecordObjectPicker/RecordObjectPicker';
import type { ObjectMetadata } from '../../../../core/metadata/Definitions/metadata';

/** Shared Records heading; no tenant-specific or app-specific routing. */
export function RecordsListPageHeading({label,onRefresh,objects,selected,onObjectSelect}:{
  label:string;onRefresh:()=>void;objects:ObjectMetadata[];selected:string;
  onObjectSelect:(apiName:string)=>void;
}) {
  return <div className="records-page-heading">
    <div className="record-object-icon"><Database size={18} /></div>
    <div><div className="eyebrow">OBJECT</div><h1>{label}</h1></div>
    <div className="records-heading-object-picker" aria-label="Switch record object">
      <RecordObjectPicker objects={objects} selected={selected} onSelect={onObjectSelect} />
    </div>
    <div className="records-heading-actions">
      <button className="btn" type="button" onClick={onRefresh}><RefreshCw size={14} />Refresh</button>
    </div>
  </div>;
}

/** Local record search, separate from the heading's object picker. */
export function RecordsListSearchControls({
  label, search, onSearchChange
}: {
  label: string;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return <div className="records-list-context">
    <label className="records-search">
      <Search size={15} aria-hidden="true" />
      <input type="search" aria-label={`Search ${label} records`}
        placeholder={`Search ${label}…`} value={search}
        onChange={(event) => onSearchChange(event.target.value)} />
    </label>
  </div>;
}
