import type { LightningAppMetadata, LightningPageMetadata } from '../../../../metadata/Definitions/metadata';
import './AppPageBar.css';

const APP_PAGE_TYPES: ReadonlyArray<LightningPageMetadata['pageType']> = ['App Page', 'Home Page', 'In-Screen Page'];

/** Pages of one app (App, Home and In-Screen pages). Record pages and print templates are not app pages. */
export function appPagesOf(app: LightningAppMetadata | undefined, pages: readonly LightningPageMetadata[]): LightningPageMetadata[] {
  if (!app) return [];
  const listed = new Set(app.navigationPageApiNames ?? []);
  return pages.filter(item => APP_PAGE_TYPES.includes(item.pageType)
    && (listed.has(item.apiName) || item.activationAssignments?.some(a => a.appId === app.apiName)));
}

/** Bottom bar of Page Builder: switch between the pages of the app being edited. */
export default function AppPageBar({ app, pages, current, onPick }: {
  app: LightningAppMetadata;
  pages: readonly LightningPageMetadata[];
  current: string;
  onPick: (apiName: string) => void;
}) {
  const list = appPagesOf(app, pages);
  if (!list.length) return null;
  return <nav className="app-page-bar" aria-label={'Pages of ' + app.label}>
    <span className="app-page-bar-title">{app.label}</span>
    <div className="app-page-bar-tabs" role="tablist">
      {list.map(item => <button key={item.apiName} type="button" role="tab" aria-selected={item.apiName === current}
        className={'app-page-tab' + (item.apiName === current ? ' is-current' : '')}
        title={item.label + ' (' + item.pageType + ')'} onClick={() => item.apiName !== current && onPick(item.apiName)}>
        <span>{item.label}</span>{item.pageType === 'In-Screen Page' && <small>In-screen</small>}
      </button>)}
    </div>
  </nav>;
}
