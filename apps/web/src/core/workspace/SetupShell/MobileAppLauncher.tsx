import * as React from 'react';
import { ChevronRight, Grid2X2, MoreHorizontal } from 'lucide-react';
import './MobileAppLauncher.css';
import { MobileSheet } from './MobileSheet';

type PageAction = { componentId: string; label: string; event: string };

// Preserve authored page actions on phones without adding automatic page navigation.
export function MobilePageActions({ actions, onAction }: {
  actions: PageAction[];
  onAction: (action: PageAction) => void;
}) {
  const [open, setOpen] = React.useState(false);
  if (!actions.length) return null;
  return <div className="md-mobile-page-actions">
    <button type="button" aria-label="Page actions" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}><MoreHorizontal size={22} aria-hidden="true" /></button>
    {open && <MobileSheet title="Page actions" onClose={() => setOpen(false)}>
      <div className="md-mobile-sheet-group">
        {actions.map(action => <button key={action.componentId} type="button"
          onClick={() => { setOpen(false); onAction(action); }}>
          {action.label}<ChevronRight size={18} aria-hidden="true" />
        </button>)}
      </div>
    </MobileSheet>}
  </div>;
}

export function MobileAppLauncher({ apps, showRecords, onOpenApp }: {
  apps: { apiName: string; label: string }[];
  showRecords: boolean;
  onOpenApp: (apiName: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return <div className="md-mobile-launcher">
    <button type="button" aria-label="Open apps" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}><Grid2X2 size={22} aria-hidden="true" /></button>
    {open && <MobileSheet title="Apps" onClose={() => setOpen(false)}>
      <div className="md-mobile-app-grid">
        {[{ apiName: '__home__', label: 'Home' },
          ...(showRecords ? [{apiName:'__records__',label:'Records'}] : []),
          ...apps.filter(app => app.apiName !== 'Records')].map(app => <button type="button"
            key={app.apiName} onClick={() => { setOpen(false); onOpenApp(app.apiName); }}>
            <span className="md-mobile-app-symbol"><Grid2X2 size={22} aria-hidden="true" /></span>
            <span>{app.label}</span>
          </button>)}
      </div>
    </MobileSheet>}
  </div>;
}
