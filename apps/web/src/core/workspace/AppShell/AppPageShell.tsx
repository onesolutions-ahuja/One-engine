// A published app page (/une/apps/<APP>/pages/<page> or /home) runs here: the page runtime,
// its page file and its data only. The Setup shell (admin chunks, ~350 KB landing bootstrap)
// is not loaded. Anything outside the app runtime (records, Setup, builders) hands over to
// the full workspace, which then loads as before.
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, currentSessionUserId, setSessionUserId } from '../../authentication/Client/authClient';
import { setAuthenticatedFormulaBindingContext } from '../../components/RegisteredComponent/fieldExpressionRuntime';
import { resolveSqlComponentLibrary, prefetchSqlComponentIndex } from '../../components/Registry/bundledRegistryClient';
import WorkspaceFormulaScreen from '../../pages/PageRuntime/WorkspaceFormulaScreen';
import { parseAppRoute, appRoutePath, keepScreenParams, type AppRoute } from '../Navigation/appRouting';
import { standaloneEntryForAppId } from '../Standalone/standaloneEntries';
import { useRuntimeFormFactor } from '../Responsive/useFormFactor';
import type { LibraryComponentMetadata } from '../../metadata/Definitions/metadata';
import { cachedAppRuntimeMetadata, pageCanvasOf, readAppRuntimeMetadata, rememberAppRuntimeMetadata,
  type AppRuntimeMetadata } from './appRuntimeMetadata';
import { takeBootAppRuntime } from './bootAppRuntime';

type AppRuntimeRoute = Extract<AppRoute, { kind: 'app-page' | 'app-home' }>;
const isAppRuntimeRoute = (route: AppRoute): route is AppRuntimeRoute => route.kind === 'app-page' || route.kind === 'app-home';
const storage = () => { try { return window.localStorage; } catch { return undefined; } };

const sameJson = (a: unknown, b: unknown) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
type Shown = { data: AppRuntimeMetadata; fresh: boolean };
function initialMetadata(appId: string): Shown | undefined {
  const boot = takeBootAppRuntime(appId);
  if (boot) {
    rememberAppRuntimeMetadata(storage(), boot.user.id ?? currentSessionUserId(), boot);
    return { data: boot, fresh: true };
  }
  const saved = cachedAppRuntimeMetadata(storage(), currentSessionUserId(), appId);
  return saved ? { data: saved, fresh: false } : undefined;
}
function useAppRuntimeMetadata(appId: string) {
  const [shown, setShown] = useState<Shown | undefined>(() => appId ? initialMetadata(appId) : undefined);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [error, setError] = useState('');
  useEffect(() => {
    if (!appId) return;
    let active = true;
    setError('');
    let now = shownRef.current;
    if (now?.data.appId !== appId) { now = initialMetadata(appId); setShown(now); }
    // The sign-in refresh brought it fresh: no second request. Otherwise ask the server;
    // a copy from this browser stays on screen until the fresh answer replaces it.
    if (now?.fresh) return () => { active = false; };
    void apiRequest<unknown>('/apps/' + encodeURIComponent(appId) + '/runtime-metadata').then(payload => {
      const fresh = readAppRuntimeMetadata(payload, appId);
      if (!fresh) throw new Error('Unable to load the app');
      // A sign-in by form (not a refresh) learns the user here: the browser's local copies are theirs.
      if (fresh.user.id) setSessionUserId(fresh.user.id);
      rememberAppRuntimeMetadata(storage(), fresh.user.id ?? currentSessionUserId(), fresh);
      // Unchanged since this browser's copy: keep the same objects so nothing on screen reloads.
      if (active) setShown(current => current?.data.appId === appId && sameJson(current.data, fresh)
        ? { data: current.data, fresh: true } : { data: fresh, fresh: true });
    }).catch((failure: unknown) => {
      if (active && !shownRef.current) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => { active = false; };
  }, [appId]);
  const metadata = shown?.data.appId === appId ? shown.data : undefined;
  useEffect(() => { if (metadata) setAuthenticatedFormulaBindingContext(metadata.user); }, [metadata]);
  return { metadata, error };
}

function useLibraryComponents() {
  const [library, setLibrary] = useState<LibraryComponentMetadata[]>([]);
  useEffect(() => {
    let active = true;
    prefetchSqlComponentIndex();
    void apiRequest<{ components: LibraryComponentMetadata[]; registered?: { apiName: string; rendererKey: string }[] }>('/component-library')
      .then(async payload => [...payload.components, ...await resolveSqlComponentLibrary(payload.registered ?? [])])
      .then(components => { if (active) setLibrary(components); })
      .catch(() => undefined); // the runtime shows its missing-component notice after its wait
    return () => { active = false; };
  }, []);
  return library;
}

function DelayedLoading({ label }: { label: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setVisible(true), 600); return () => window.clearTimeout(timer); }, []);
  return <div className="records-page" aria-busy="true">{visible && <div className="records-loading">{label}</div>}</div>;
}

export default function AppPageShell({ LightningAppRuntime, onLeave }: {
  LightningAppRuntime: React.ComponentType<any>;
  /** The address left the app runtime (a record list, Setup...): the full workspace takes over. */
  onLeave: () => void;
}) {
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(window.location.pathname, window.location.search));
  const appRoute = isAppRuntimeRoute(route) ? route : undefined;
  const appId = appRoute?.appId ?? '';
  const { metadata, error } = useAppRuntimeMetadata(appId);
  const libraryComponents = useLibraryComponents();
  const formFactor = useRuntimeFormFactor();
  const pageDefinitionCache = useRef(new Map()).current;
  const [standalonePageMode, setStandalonePageMode] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!appRoute) onLeave(); }, [appRoute, onLeave]);
  // Same address tidying as the Setup shell (keeps ?mirror=, ?screenSession=, ?layer=).
  useEffect(() => {
    const canonical = keepScreenParams(appRoutePath(route), window.location.search);
    if (window.location.pathname + window.location.search !== canonical) window.history.replaceState({}, '', canonical);
  }, []);
  useEffect(() => {
    const sync = () => setRoute(parseAppRoute(window.location.pathname, window.location.search));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const navigate = useCallback((next: AppRoute) => {
    const target = next.kind === 'setup' ? next : { ...next, appId: (next as { appId?: string }).appId ?? appId };
    if (isAppRuntimeRoute(target)) {
      const standalone = standaloneEntryForAppId(target.appId);
      if (standalone) { window.location.assign(appRoutePath(target)); return true; }
    }
    const path = appRoutePath(target);
    if (window.location.pathname + window.location.search !== path) window.history.pushState({}, '', path);
    setRoute(target);
    return true;
  }, [appId]);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2400);
  }, []);
  // Flow definitions are a Builder concern (the Setup shell has none loaded on app pages either).
  const launchFlow = useCallback((apiName: string) => notify(`Flow "${apiName}" was not found`), [notify]);
  if (!appRoute) return <DelayedLoading label="Loading workspace…" />;
  if (!metadata) return error
    ? <div className="records-page"><div className="records-message" role="alert">{error}</div></div>
    : <DelayedLoading label="Loading app…" />;
  const summary = appRoute.kind === 'app-page' ? metadata.pages.find(page => page.apiName === appRoute.pageApiName) : undefined;
  const standalone = standalonePageMode || summary?.standalonePresentation === true;
  const shared = {
    objects: metadata.objects, apps: metadata.apps, pages: metadata.pages, reports: [],
    libraryComponents, availableFlows: [], profileId: metadata.user.profileId, pageDefinitionCache,
    onNavigate: navigate, onLaunchFlow: launchFlow
  };
  return <div className={(standalone ? 'lightning standalone-page-mode' : 'lightning md-setup-light md-app-runtime')}>
    <div className="setup-layout">
      <main className="workspace workspace-records">
        <React.Suspense fallback={<DelayedLoading label="Loading Lightning page…" />}>
          <LightningAppRuntime key={appRoute.appId} appId={appRoute.appId}
            pageApiName={appRoute.kind === 'app-page' ? appRoute.pageApiName : undefined}
            formFactor={formFactor} onStandaloneModeChange={setStandalonePageMode} {...shared} />
        </React.Suspense>
      </main>
    </div>
    <WorkspaceFormulaScreen key={JSON.stringify(route)} canvasOf={name => pageCanvasOf(metadata.pages, name)}
      render={({ appId: popupApp, screen, frameDevice }) => <LightningAppRuntime
        appId={popupApp} pageApiName={screen.page} instanceKey={screen.instance} inScreenPage={screen.inScreen || Boolean(screen.print)}
        printPreview={screen.print ? screen : undefined} inScreenContext={{ sessionId: screen.sessionId, values: { recordId: screen.recordId } }}
        formFactor={frameDevice === 'Phone' || frameDevice === 'Tablet' ? frameDevice : formFactor}
        onStandaloneModeChange={() => {}} {...shared} />} />
    {toast && <div className="toast" role="status"><span className="toast-message">{toast}</span>
      <button type="button" className="toast-dismiss" aria-label="Dismiss notification" onClick={() => setToast('')}>×</button></div>}
  </div>;
}
