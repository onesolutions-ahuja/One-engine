import type { KeyboardEvent } from 'react';
import './PageManagerTabs.css';

type Tab = { value: string; label: string };
type AppTab = { apiName: string; label: string };

const pageTypes: ReadonlyArray<Tab> = [
  { value: 'Home Page', label: 'Home' },
  { value: 'App Page', label: 'App' },
  { value: 'Record Page', label: 'Record' },
  { value:'Print Template',label:'Print templates' },
  { value: 'In-Screen Page', label: 'In-Screen' },
];

function TabBar({ label, className, tabs, selected, onSelect }: {
  label: string;
  className: string;
  tabs: ReadonlyArray<Tab>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(tabs[next].value);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return <nav className={`md-admin-tabstrip ${className}`} role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button key={tab.value} type="button" role="tab"
      aria-selected={selected === tab.value} tabIndex={selected === tab.value ? 0 : -1}
      onKeyDown={event => onKeyDown(event, index)}
      onClick={() => onSelect(tab.value)}>{tab.label}</button>)}
  </nav>;
}

/** Page categories are primary. App ownership is a secondary filter of App Pages only. */
export default function PageManagerTabs({ type, app, apps, onTypeChange, onAppChange }: {
  type: string;
  app: string;
  apps: ReadonlyArray<AppTab>;
  onTypeChange: (type: string) => void;
  onAppChange: (app: string) => void;
}) {
  const appTabs: Tab[] = [
    { value: 'all', label: 'All Apps' },
    ...apps.map(item => ({ value: item.apiName, label: item.label })),
    { value: 'other', label: 'Other' },
  ];
  return <div className="page-manager-tab-groups">
    <div className="page-manager-tab-level">
      <span className="page-manager-filter-label">Page type</span>
      <TabBar label="Page types" className="page-manager-main-tabs" tabs={pageTypes}
        selected={type} onSelect={onTypeChange} />
    </div>
    {type === 'App Page' && <div className="page-manager-tab-level">
      <span className="page-manager-filter-label">Application</span>
      <TabBar label="Pages by application" className="page-manager-app-tabs"
        tabs={appTabs} selected={app} onSelect={onAppChange} />
    </div>}
  </div>;
}
