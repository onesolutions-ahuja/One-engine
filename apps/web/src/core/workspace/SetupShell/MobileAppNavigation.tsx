import * as React from 'react';
import { ChevronRight, Grid2X2, House, List, MoreHorizontal } from 'lucide-react';
import './MobileAppNavigation.css';
import {MobileSheet} from './MobileSheet';

type Page = { apiName: string; label: string };
type PageAction = { componentId: string; label: string; event: string };

export function MobileAppNavigation({ pages, appId, activePageApiName, actions, onNavigate, onAction }: {
  pages: Page[];
  appId: string;
  activePageApiName?: string;
  actions: PageAction[];
  onNavigate: (pageApiName: string) => void;
  onAction: (action: PageAction) => void;
}) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const visiblePages = pages.slice(0, 2);
  const overflowPages = pages.slice(2);
  const showMore = overflowPages.length > 0 || actions.length > 0;
  const icons = [House, Grid2X2, List, Grid2X2];
  if (!pages.length && !actions.length) return null;
  const openPage = (apiName: string) => { setMoreOpen(false); onNavigate(apiName); };
  return <>
    <nav className="md-mobile-app-tabs" aria-label={appId + ' pages'}>
      {visiblePages.map((page, index) => {
        const Icon = icons[index];
        return <button type="button" key={page.apiName} className={activePageApiName === page.apiName ? 'active' : ''}
          aria-label={page.label} title={page.label} aria-current={activePageApiName === page.apiName ? 'page' : undefined} onClick={() => openPage(page.apiName)}>
          <Icon size={23} aria-hidden="true" />
          <span>{page.label}</span>
        </button>;
      })}
      {showMore && <button type="button" className={overflowPages.some(page => page.apiName === activePageApiName) ? 'active' : ''}
        aria-label="More pages and actions" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
        <MoreHorizontal size={24} aria-hidden="true" /><span>More</span>
      </button>}
    </nav>
    {moreOpen && <MobileSheet title={appId + ' menu'} onClose={() => setMoreOpen(false)}>
      {overflowPages.length > 0 && <div className="md-mobile-sheet-group">
        <p>More pages</p>{overflowPages.map(page => <button key={page.apiName} type="button"
          onClick={() => openPage(page.apiName)}>{page.label}<ChevronRight size={18} aria-hidden="true" /></button>)}
      </div>}
      {actions.length > 0 && <div className="md-mobile-sheet-group">
        <p>Page actions</p>{actions.map(action => <button key={action.componentId} type="button"
          onClick={() => { setMoreOpen(false); onAction(action); }}>
          {action.label}<ChevronRight size={18} aria-hidden="true" /></button>)}
      </div>}
    </MobileSheet>}
  </>;
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
