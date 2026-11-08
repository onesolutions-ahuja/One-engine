import { useMemo, useState } from 'react';
import { ChevronRight, Search, Settings2, X } from 'lucide-react';
import SettingsNavigationIcon from './SettingsNavigationIcon';
import { setupNavigation } from '../metadata/Definitions/metadata';
import {canSeeSetupItem} from '../platform/Workspace/setupNavigationAccess';
import './MobileSettingsHome.css';

type Rights = {
  viewMetadata: boolean;
  editMetadata: boolean;
  viewSecurity: boolean;
  manageSecurity: boolean;
  manageFlows: boolean;
  manageTenants: boolean;
  namedDevices: boolean;
};
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Group = {group: string; items: string[]};
/** Navigation only: reuse the Setup registry and existing routes; APIs remain the RBAC authority. */
export default function MobileSettingsHome({rights, permissions, loading, onOpen, onOpenOverview}:{
  rights: Rights;
  request: Request;
  permissions: readonly string[];
  loading: boolean;
  onOpen: (label: string) => void;
  onOpenOverview:()=>void;
}) {
  const [query, setQuery] = useState('');
  const sections = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (setupNavigation as Group[]).map(({group, items}) => ({
      group,
      items: items.filter(label => label !== 'Setup Home' &&
        canSeeSetupItem(label,permissions) &&
        (!normalized || (label + ' ' + group).toLocaleLowerCase().includes(normalized)))
    })).filter(section => section.items.length);
  }, [query,permissions]);

  return <div className="mobile-settings-home" aria-label="Mobile Settings">
    <div className="mobile-settings-title">
      <span className="mobile-settings-brand"><Settings2 size={20} aria-hidden="true" /> MetaDrive</span>
      <h1>Settings</h1>
      <p>Manage your organisation and apps</p>
    </div>
    <button type="button" className="mobile-settings-overview" onClick={onOpenOverview}>
      <span><strong>Setup dashboard</strong><small>Quick actions, setup progress and platform status</small></span>
      <ChevronRight size={20} aria-hidden="true"/>
    </button>
    <label className="mobile-settings-search">
      <Search size={19} aria-hidden="true" />
      <input type="search" aria-label="Search settings" placeholder="Search settings" value={query}
        onChange={event => setQuery(event.target.value)} />
      {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}
    </label>
    {loading ? <p className="mobile-settings-empty" role="status">Loading permitted settings…</p> :
      sections.length === 0 ? <p className="mobile-settings-empty">No settings available for your access or search.</p> :
        <div className="mobile-settings-groups">{sections.map(({group, items}) => {
          return <section key={group} className="mobile-settings-group" aria-label={group}>
            <h2>{group}</h2>
            <div className="mobile-settings-list">
              {items.map(label => <button key={label} type="button" className="mobile-settings-item"
                onClick={() => onOpen(label)}>
                <SettingsNavigationIcon group={group} label={label} className="mobile-settings-icon" />
                <span className="mobile-settings-item-label">{label === 'Tenant Management' && !rights.manageTenants ? 'My Tenant Management' : label}</span>
                <ChevronRight size={17} aria-hidden="true" className="mobile-settings-chevron" />
              </button>)}
            </div>
          </section>;
        })}</div>}
  </div>;
}
