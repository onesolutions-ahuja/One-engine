import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './core/workspace/WorkspaceTheme/design-system.css';
import MarketingSite, { PrivacyPolicyPage, TermsAccessPage } from './core/public/MarketingSite/MarketingSite';
import { UneBrandLogo } from './core/branding/UneBrandLogo';
import './core/workspace/WorkspaceTheme/bootSplash.css';
import { registerUniversalShell } from './core/workspace/Bootstrap/universalShell';
import { installPopoverDismissal } from './component-libraries/shared/popoverDismissal';
import { installKeyboardInset } from './core/workspace/Responsive/keyboardInset';
import { isMissingDynamicChunk, recoverMissingDynamicChunk, reloadLatestWorkspace } from './core/workspace/Bootstrap/dynamicChunkRecovery';

registerUniversalShell();
installPopoverDismissal();
installKeyboardInset();
// Normalise the dedicated login document's trailing-slash path.
if (window.location.pathname === '/login/') window.history.replaceState(window.history.state, '', '/login' + window.location.search + window.location.hash);

// Vite emits this event for a missing lazy JS/CSS module after Pages publishes
// a new content-hashed build. Fetch the fresh HTML once, never loop on 404s.
window.addEventListener('vite:preloadError', (event: Event) => {
  const payload = (event as Event & { payload?: unknown }).payload;
  if (recoverMissingDynamicChunk(payload)) event.preventDefault();
});

// Keep the authenticated workspace, including its large builder code and CSS,
// out of the initial public marketing bundle.
const MailWebmail = lazy(() => import('./core/mail/MailWebmail'));

const Workspace = lazy(async () => {
  // Start every stylesheet and the app chunk downloading at the same time. The imports are
  // still issued in the original order, so the CSS cascade order is unchanged; only the
  // one-after-another waiting (about 2.4 s on a normal connection) is gone.
  const themeStyles = [
    import('./core/workspace/WorkspaceTheme/styles.css'),
    import('./core/workspace/WorkspaceTheme/appleTheme.css'),
    import('./core/workspace/WorkspaceTheme/applicationPolish.css'),
    import('./core/workspace/WorkspaceTheme/operationalPolish.css'),
    import('./core/workspace/WorkspaceTheme/settingsAppearance.css'),
    import('./core/workspace/WorkspaceTheme/desktopDense.css'),
    import('./core/workspace/WorkspaceTheme/contrastRepair.css'),
    import('./core/workspace/WorkspaceTheme/setupUsability.css'),
    import('./core/workspace/WorkspaceTheme/workspaceContrastBaseline.css'),
    import('./core/workspace/WorkspaceTheme/grokUiPolish.css'),
    import('./core/workspace/WorkspaceTheme/phase2AdminLayout.css'),
    import('./core/workspace/TableUsability/tableResizing.css')
  ];
  const tableResizing = import('./core/workspace/TableUsability/installWorkspaceTableResizing');
  const app = import('./core/workspace/App/App');
  await Promise.all(themeStyles);
  const { installWorkspaceTableResizing } = await tableResizing;
  installWorkspaceTableResizing();
  return app;
});

function WorkspaceLoadingFallback() {
  const [slow,setSlow] = React.useState(false);
  React.useEffect(()=>{
    const timer=window.setTimeout(()=>setSlow(true),12000);
    return ()=>window.clearTimeout(timer);
  },[]);
  return <main role="status" aria-live="polite"
    style={{minHeight:'100dvh',display:'grid',placeItems:'center',padding:16,boxSizing:'border-box',fontFamily:'system-ui,sans-serif',background:'#f5f6fa',color:'#192230'}}>
    <section aria-label="Workspace starting" style={{boxSizing:'border-box',width:'min(480px,100%)',padding:'28px 24px',background:'#fff',borderRadius:16,border:'1px solid #d8e1ed',boxShadow:'0 10px 32px #15243c12'}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
        <UneBrandLogo className="md-boot-brand" decorative />
        <div><strong style={{fontSize:17}}>UNE Engine Workspace</strong><p style={{fontSize:13,color:'#526175',margin:'4px 0 0'}}>Preparing your secure workspace</p></div>
      </div>
      <p className="md-boot-progress-label" style={{fontSize:15,fontWeight:600}}><span className="md-boot-spinner" aria-hidden="true" /> Loading your workspace…</p>
      <div aria-hidden="true" style={{display:'grid',gap:10,marginTop:20}}>
        <div style={{height:18,width:'72%',borderRadius:7,background:'#e7ecf3'}}/>
        <div style={{height:36,width:'100%',borderRadius:7,background:'#e7ecf3'}}/>
        <div style={{height:36,width:'92%',borderRadius:7,background:'#e7ecf3'}}/>
      </div>
      {slow && <div style={{marginTop:24}}>
        <p>The workspace is taking longer than expected. Your saved data is unchanged.</p>
        <button type="button" onClick={reloadLatestWorkspace} style={{minHeight:44,padding:'8px 14px',borderRadius:9,border:'1px solid #0b57d0',color:'#fff',background:'#0b57d0'}}>Reload latest version</button>
      </div>}
    </section>
  </main>;
}

class WorkspaceFailureBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('MetaDrive workspace failed to render', error, info.componentStack);
    // Preserve the actual browser exception across the immediate login/logout
    // navigation, instead of losing its cause in a one-frame error boundary.
    // No credentials, URLs with queries, cookies, tokens or user records.
    try {
      window.sessionStorage.setItem('md_last_workspace_exception', JSON.stringify({
        route: window.location.pathname,
        errorName: error.name,
        message: error.message.slice(0, 1200),
        componentStack: (info.componentStack ?? '').slice(0, 1800),
        recordedAt: new Date().toISOString()
      }));
    } catch { /* Browsers can disable session storage. */ }
    recoverMissingDynamicChunk(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const missingChunk = isMissingDynamicChunk(this.state.error);
    return <main role="alert" style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 680, margin: '12vh auto' }}>
      <h1>{missingChunk ? 'A new MetaDrive version is available' : 'Workspace could not load'}</h1>
      <p>{missingChunk
        ? 'A previous version of this browser tab requested a JavaScript file that is no longer available. Reload the current page with the latest files. Your saved records are unaffected.'
        : 'The workspace encountered a JavaScript error. Your saved records have not been changed.'}</p>
      <details><summary>Technical details</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{this.state.error.message}</pre>
      </details>
      <button type="button" onClick={missingChunk ? reloadLatestWorkspace : () => window.location.reload()}>
        {missingChunk ? 'Load latest version' : 'Retry loading'}
      </button> <button type="button" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}une/setup/rbac/Users`)}>Back to user setup</button>
    </main>;
  }
}

// GitHub Pages /login fallback sends users to /?__spa=%2Flogin. Restore the
// same-origin SPA route before deciding between marketing and workspace.
if (window.location.pathname === '/' && new URLSearchParams(window.location.search).has('__spa')) {
  const route = new URLSearchParams(window.location.search).get('__spa');
  if (route && route.startsWith('/') && !route.startsWith('//') && !route.includes('\\')) {
    const target = new URL(route, window.location.origin);
    if (target.origin === window.location.origin) {
      window.history.replaceState(window.history.state, '', target.pathname + target.search + target.hash);
    }
  }
}

const isMailRoute = window.location.pathname === '/mail' || window.location.pathname === '/mail/';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const pathname = basePath && window.location.pathname.startsWith(basePath + '/')
  ? window.location.pathname.slice(basePath.length)
  : window.location.pathname;
// Browser regression and local metadata workspaces open the authenticated app at /.
// The public marketing homepage remains the production default.
const workspaceDevelopmentRoot = import.meta.env.DEV && Boolean(import.meta.env.VITE_API_BASE_URL);
const isMarketingHome = !workspaceDevelopmentRoot && (pathname === '/' || pathname === '/index.html' || (Boolean(basePath) && window.location.pathname === basePath));
const isPrivacyRoute = pathname === '/privacy' || pathname === '/privacy/' || pathname === '/privacy-policy' || pathname === '/privacy-policy/';
const isTermsRoute = pathname === '/terms' || pathname === '/terms/' || pathname === '/terms-of-service' || pathname === '/terms-of-service/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isMailRoute
      ? <Suspense fallback={<WorkspaceLoadingFallback />}><MailWebmail /></Suspense>
      : isPrivacyRoute
        ? <PrivacyPolicyPage />
        : isTermsRoute
        ? <TermsAccessPage />
        : isMarketingHome
        ? <MarketingSite />
        : <WorkspaceFailureBoundary><Suspense fallback={<WorkspaceLoadingFallback />}><Workspace /></Suspense></WorkspaceFailureBoundary>}
  </React.StrictMode>
);
