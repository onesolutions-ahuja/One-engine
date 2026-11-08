import { useEffect, useId, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { reconcileNavigationOrder } from './appNavigation';
import {productionReleaseAlignment,isSupersededDirectOciFailure} from './productionReleaseStatus';
import {mergeConsoleSnapshot,terminalLines} from './deploymentConsole';
import type {ConsoleHistory} from './deploymentConsole';
import type { LightningAppMetadata } from '../../metadata/Definitions/metadata';

export function resolveCurrentAppNavigation(app: LightningAppMetadata | undefined) {
  return app ? reconcileNavigationOrder(app.navigationItems ?? [], app.navigationPageApiNames ?? [], app.navigationOrder ?? []) : [];
}


/** Build identity is embedded in the served JavaScript, never inferred from current GitHub main. */
declare const __METADRIVE_WEB_RELEASE__: { commit: string | null; builtAt: string };

type ProductionStatus = {
 configured: boolean; canDeploy: boolean; latestCommit: string | null;
 error?: string;
 permission?: {hasOneEngine:boolean;hasPlatformTenant:boolean;hasOperationsManage:boolean};
 oci?: {
  state:'idle'|'running'|'succeeded'|'failed';
  sha:string|null;
  stage:string|null;
  updatedAt:string|null;
  error?:string|null;
  trail?:string[];
  buildLog?:string[];
  journal?:string[];
  logCollector?:'ready'|'missing'|'outdated';
  buildLogState?:'available'|'empty'|'missing'|'unreadable'|'unknown';
 }|null;
 deployedCommit: string | null; active: boolean;
};
type LiveDeploymentStatus = Pick<ProductionStatus,'configured'|'active'|'oci'|'error'> & {checkedAt:string};
type DeploymentRequest = <T>(path:string,init?:RequestInit)=>Promise<T>;

type OracleRelease = { commit: string; deployedAt: string };
type OracleStatus = 'idle' | 'loading' | 'ready' | 'error';

function utcDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hourCycle: 'h23'
  }).format(new Date(value)) + ' UTC';
}

export function NavigationLoadTime({ routeKey, startedAt, ready, kind, authMs, request }: {
  routeKey: string;
  startedAt: number;
  ready: boolean;
  kind: 'login' | 'restore' | 'navigation';
  authMs: number | null;
  request?: DeploymentRequest;
}) {
  const [result, setResult] = useState<{ routeKey: string; milliseconds: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [newFrontendAvailable, setNewFrontendAvailable] = useState(false);
  const [deployment, setDeployment] = useState<ProductionStatus | null>(null);
  const [deploymentError, setDeploymentError] = useState('');
  const [deploymentBusy, setDeploymentBusy] = useState(false);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deploymentRequested, setDeploymentRequested] = useState(false);
  const [requestedCommit, setRequestedCommit] = useState<string | null>(null);
  const [consoleHistory, setConsoleHistory] = useState<ConsoleHistory|null>(null);
  const [liveConnectionError, setLiveConnectionError] = useState('');
  const [lastLiveCheck, setLastLiveCheck] = useState<string|null>(null);
  const [oracle, setOracle] = useState<{ status: OracleStatus; release: OracleRelease | null }>({ status: 'idle', release: null });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const trailScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const popoverId = useId();

  useEffect(() => {
    const loaded = typeof __METADRIVE_WEB_RELEASE__ === 'undefined'
      ? null : __METADRIVE_WEB_RELEASE__?.commit;
    if (!loaded) return;
    let stopped = false;
    const checkRelease = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/frontend-release.json', {cache:'no-store'});
        if (!response.ok) return;
        const release:unknown = await response.json();
        if (!stopped && release && typeof release === 'object'
          && 'commit' in release && typeof release.commit === 'string'
          && /^[a-f0-9]{40}$/.test(release.commit) && release.commit !== loaded)
          setNewFrontendAvailable(true);
      } catch { /* Offline clients continue working without a forced refresh. */ }
    };
    void checkRelease();
    const interval = window.setInterval(() => {void checkRelease();},60_000);
    document.addEventListener('visibilitychange',checkRelease);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange',checkRelease);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    setOracle({ status: 'loading', release: null });
    // The Oracle API supplies the running server release; the bundled client SHA
    // below identifies the frontend actually loaded in this browser tab.
    const loadRelease = () => void fetch('/api/health', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Oracle health unavailable');
        return response.json() as Promise<{ release?: { commit?: unknown; deployedAt?: unknown } | null }>;
      })
      .then(data => {
        if (!active) return;
        const candidate = data?.release;
        const release = typeof candidate?.commit === 'string'
          && /^[a-f0-9]{40}$/.test(candidate.commit)
          && typeof candidate.deployedAt === 'string'
          && Number.isFinite(Date.parse(candidate.deployedAt))
          ? { commit: candidate.commit, deployedAt: candidate.deployedAt } : null;
        setOracle({ status: 'ready', release });
      })
      .catch(() => {
        if (active) setOracle({ status: 'error', release: null });
      });
    loadRelease();
    // API activation may restart the service mid-release. Recheck automatically.
    const timer = window.setInterval(loadRelease,20_000);
    return () => { active = false; window.clearInterval(timer); controller.abort(); };
  }, [open]);

  const isLiveDeploy = Boolean(
    deployment?.active || deploymentRequested || deployment?.oci?.state === 'running'
  );

  useEffect(() => {
    if (!open || !request) return;
    let cancelled = false;
    let timer:number|undefined;
    setDeploymentLoading(true);
    const checkSource = async () => {
      try {
        const status = await request<ProductionStatus>('/platform/production-deployment');
        if (!cancelled) {
          // This slower request includes GitHub lookups. Never replace a fresher
          // live OCI snapshot returned from the separate telemetry endpoint.
          setDeployment(current => ({
            ...status,
            oci:current?.oci??status.oci,
            active:current?.oci?current.active:status.active,
            configured:current?.oci?current.configured:status.configured
          }));
          setDeploymentError('');
          setDeploymentLoading(false);
          if (status.oci) setConsoleHistory(previous =>
            previous?previous:mergeConsoleSnapshot(null,status.oci!,new Date().toISOString()));
        }
      } catch (error) {
        if (!cancelled) {
          setDeploymentLoading(false);
          setDeploymentError(error instanceof Error ? error.message : 'Release metadata unavailable');
        }
      } finally {
        if (!cancelled) timer=window.setTimeout(()=>{void checkSource();},60_000);
      }
    };
    void checkSource();
    return () => {cancelled = true;window.clearTimeout(timer);};
  }, [open, request]);

  useEffect(() => {
    if (!open || !request) return;
    let cancelled=false;
    let timer:number|undefined;
    const checkLive = async () => {
      try {
        const status=await request<LiveDeploymentStatus>('/platform/production-deployment/live');
        if (cancelled) return;
        setLastLiveCheck(status.checkedAt);
        setLiveConnectionError(status.error || (!status.configured?'OCI log collector is unreachable.':''));
        setDeployment(current=>current?{
          ...current,configured:status.configured,active:status.active,oci:status.oci
        }:current);
        // A queued request must not display the previous job as the new job.
        if (status.oci && (!requestedCommit || status.oci.sha===requestedCommit)) {
          setConsoleHistory(previous=>mergeConsoleSnapshot(previous,status.oci!,status.checkedAt));
          if (requestedCommit && status.oci.sha===requestedCommit &&
            ['running','succeeded','failed'].includes(status.oci.state)) {
            setDeploymentRequested(false);
            setRequestedCommit(null);
          }
        }
      } catch (error) {
        if (!cancelled) setLiveConnectionError(
          (error instanceof Error?error.message:'OCI connection unavailable')+' — reconnecting automatically');
      } finally {
        // Never overlap polls. Schedule after completion and retry transient
        // API restarts without requiring the operator to click Refresh.
        if (!cancelled) timer=window.setTimeout(()=>{void checkLive();},2_000);
      }
    };
    void checkLive();
    return ()=>{cancelled=true;window.clearTimeout(timer);};
  }, [open, request, requestedCommit]);

  const handleConsoleScroll = () => {
    const viewport=trailScrollRef.current;
    if (!viewport) return;
    stickToBottomRef.current=viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight < 32;
  };
  const consoleLines=terminalLines(consoleHistory);
  useEffect(() => {
    if (!open || !stickToBottomRef.current || !trailScrollRef.current) return;
    trailScrollRef.current.scrollTop=trailScrollRef.current.scrollHeight;
  }, [open, consoleLines.length, consoleLines.at(-1)?.text, liveConnectionError]);

  const deployLatest = async () => {
    if (!request || !deployment?.canDeploy || !deployment.latestCommit ||
      deployment.active || deploymentBusy || deploymentRequested) return;
    if (!window.confirm('Deploy latest main commit ' + deployment.latestCommit.slice(0,12) +
      ' to OCI production? OCI will validate, build, back up SQL, deploy and verify the release.')) return;
    setDeploymentBusy(true);
    setDeploymentError('');
    try {
      await request('/platform/production-deployment', {method:'POST',
        body:JSON.stringify({expectedCommit:deployment.latestCommit})});
      setRequestedCommit(deployment.latestCommit);
      setDeploymentRequested(true);
      stickToBottomRef.current=true;
      setConsoleHistory({sha:deployment.latestCommit,trail:[],buildLog:[],journal:[]});
    } catch (error) {
      setDeploymentError(error instanceof Error ? error.message : 'Deployment request failed');
    } finally {
      setDeploymentBusy(false);
    }
  };

  useEffect(() => {
    // Never declare a screen loaded while its essential metadata is outstanding.
    if (!ready) return;
    let idleTimer: number | undefined;
    let observer: MutationObserver | undefined;
    let cancelled = false;
    let animation: number | undefined;
    const complete = () => {
      if (cancelled) return;
      cancelled = true;
      observer?.disconnect();
      window.clearTimeout(idleTimer);
      setResult({ routeKey, milliseconds: Math.max(0, performance.now() - startedAt) });
    };
    const schedule = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        const content = document.querySelector('.lightning');
        const stillLoading = content?.querySelector('[aria-busy="true"], [role="progressbar"], .records-loading, .loading-spinner');
        if (stillLoading) schedule();
        else complete();
      }, 120);
    };
    animation = window.requestAnimationFrame(() => {
      const content = document.querySelector('.lightning');
      if (content) {
        // Background notifications, header health and editor loads are not
        // landing-page blockers. Only extend the timer for a real busy UI.
        observer = new MutationObserver(() => {
          if (content.querySelector('[aria-busy="true"], [role="progressbar"], .records-loading, .loading-spinner')) schedule();
        });
        observer.observe(content, { childList: true, subtree: true, characterData: true });
      }
      schedule();
    });
    return () => {
      cancelled = true;
      if (animation !== undefined) window.cancelAnimationFrame(animation);
      observer?.disconnect();
      window.clearTimeout(idleTimer);
    };
  }, [routeKey, startedAt, ready]);
  const isEntry = kind !== 'navigation';
  const label = kind === 'login' ? 'Login → Landing' : kind === 'restore' ? 'Session → Landing' : 'Page navigation';
  const completed = result?.routeKey === routeKey;
  const requestSeconds = authMs === null ? null : (authMs / 1000).toFixed(2);
  const showTimings = import.meta.env.VITE_SHOW_NAV_TIMINGS !== 'false';
  const timing = completed ? `${label}: ${(result!.milliseconds / 1000).toFixed(2)}s` : `${label}: Loading…`;
  const webRelease = typeof __METADRIVE_WEB_RELEASE__ === 'undefined' ? null : __METADRIVE_WEB_RELEASE__;
  // Compare the *live* API health release with the loaded frontend. The
  // deployment environment marker may lag the actual running API service.
  const releaseAlignment = productionReleaseAlignment(
    deployment?.latestCommit ?? null,oracle.release?.commit ?? null,webRelease?.commit ?? null);
  const supersededDirectFailure = isSupersededDirectOciFailure(
    deployment?.oci,deployment?.latestCommit ?? null,oracle.release?.commit ?? null,
    webRelease?.commit ?? null,oracle.release?.deployedAt ?? null);
  const oracleValue = oracle.status === 'loading' ? 'Checking…' : oracle.release?.commit.slice(0, 12) ?? 'Not available';
  const ociError = deployment?.oci?.error;
  const collector = deployment?.oci?.logCollector;
  const buildState = deployment?.oci?.buildLogState;
  const showLiveTrail = consoleLines.length>0 || isLiveDeploy || Boolean(liveConnectionError) ||
    (deployment?.oci?.state === 'failed' && !supersededDirectFailure);
  const lastCheckedAt = lastLiveCheck ? new Date(lastLiveCheck).toISOString().slice(11,19)+' UTC' : null;

  return <div className="navigation-diagnostics" ref={containerRef}>
    {newFrontendAvailable && <button type="button" className="btn btn-small"
      style={{marginRight:8,whiteSpace:'nowrap'}}
      title="A newer frontend is deployed. Save any Page Builder changes before reloading."
      onClick={() => window.location.reload()}>Update available — reload</button>}
    <button ref={buttonRef} type="button" className="icon-button navigation-diagnostics-trigger"
      aria-label="System and release information" title="System and release information"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popoverId : undefined}
      onClick={() => setOpen(current => !current)}>
      <Settings size={17} aria-hidden="true" />
    </button>
    {open && <section id={popoverId} className="navigation-diagnostics-popover" role="dialog"
      aria-label="System and release information">
      <div className="navigation-diagnostics-grid">
      <div className="navigation-diagnostics-system">
      <strong className="navigation-diagnostics-heading">System information</strong>
      <dl className="navigation-diagnostics-details">
        {showTimings && <>
          <div><dt>Screen load</dt><dd role="status" title={isEntry
            ? `From ${kind === 'login' ? 'Sign in click' : 'session restoration'} until landing content is ready. session request: ${requestSeconds ?? 'unknown'}s.`
            : 'From route navigation until page content is ready.'}>{timing}</dd></div>
          {isEntry && requestSeconds !== null && <div><dt>Authentication</dt><dd>{requestSeconds}s</dd></div>}
        </>}
        <div><dt>Oracle API release</dt><dd title={oracle.release?.commit}>{oracleValue}</dd></div>
        <div><dt>Oracle deployed</dt><dd>{oracle.status === 'loading' ? 'Checking…' : utcDate(oracle.release?.deployedAt)}</dd></div>
        <div><dt>Frontend commit</dt><dd title={webRelease?.commit ?? undefined}>{webRelease?.commit?.slice(0, 12) ?? 'Not available'}</dd></div>
        <div><dt>Frontend built</dt><dd>{utcDate(webRelease?.builtAt)}</dd></div>
      </dl>
      </div>
      <div className="navigation-deployment-control" aria-label="Production deployment">
        <strong className="navigation-deployment-heading">OCI production deployment</strong>
        <dl className="navigation-diagnostics-details">
          <div><dt>Latest main commit (source only)</dt><dd title={deployment?.latestCommit ?? undefined}>
            {deploymentLoading && !deployment ? 'Checking…' :
             deployment?.latestCommit?.slice(0,12) ?? 'Unavailable'}</dd></div>
          <div><dt>Live OCI API</dt><dd title={oracle.release?.commit ?? undefined}>
            {oracle.release?.commit?.slice(0,12) ?? 'Unavailable'}</dd></div>
          <div><dt>Live production status</dt><dd>
            {releaseAlignment === 'current' ? 'Up to date — API and frontend match main' :
             releaseAlignment === 'synced' ? 'API and frontend match; main unavailable' :
             releaseAlignment === 'behind' ? 'Newer main commit available' :
             releaseAlignment === 'mismatch' ? 'API / frontend release mismatch' :
             'Release verification unavailable'}</dd></div>
          <div><dt>Direct OCI job (separate)</dt><dd>
            {!deployment?.configured ? 'Unavailable' :
             deployment.oci?.state === 'running' ? 'Running: '+(deployment.oci.stage ?? 'preparing') :
             deployment.oci?.state === 'succeeded' ? 'Last run succeeded' :
             deployment.oci?.state === 'failed' ? 'Failed: '+(deployment.oci.stage ?? 'unknown stage') :
             deploymentRequested ? 'Request accepted' : 'Idle'}</dd></div>
          {deployment?.oci?.sha && <div><dt>Last direct job commit</dt><dd title={deployment.oci.sha}>
            {deployment.oci.sha.slice(0,12)}</dd></div>}
          {deployment?.oci?.updatedAt && <div><dt>Direct job last updated</dt>
            <dd>{utcDate(deployment.oci.updatedAt)}</dd></div>}
        </dl>
        <div className="navigation-deployment-actions">
        <button type="button" className="btn btn-small navigation-deployment-button"
          disabled={!request || !deployment?.canDeploy || !deployment.configured ||
            !deployment.latestCommit || deploymentBusy || deployment.active || deploymentRequested ||
            (deployment.latestCommit === oracle.release?.commit &&
             deployment.latestCommit === webRelease?.commit)}
          title={!deployment?.canDeploy ? 'Platform OneEngine deployment permission required'
            : !deployment.configured ? 'The OCI deployment helper is unavailable'
            : deployment.active ? 'An OCI deployment is running'
            : undefined}
          onClick={() => {void deployLatest();}}>
          {deploymentBusy ? 'Requesting…' : deployment?.active ? 'OCI deployment running' :
           deploymentRequested ? 'OCI deployment requested' : 'Deploy latest to OCI'}
        </button>
        </div>
        {deployment && !deployment.canDeploy && <p className="navigation-diagnostics-note" role="alert">
          Deployment blocked: {!deployment.permission?.hasPlatformTenant
            ? 'Deployment is restricted to the platform tenant. '
            : ''}{!deployment.permission?.hasOneEngine
            ? 'OneEngine permission set is not assigned to your account. '
            : ''}{!deployment.permission?.hasOperationsManage
            ? 'PlatformOperations manage permission is missing or denied in OneEngine RBAC. '
            : ''}An authorised administrator can manage these grants through OneEngine.
        </p>}
        {deployment && !deployment.configured && <p className="navigation-diagnostics-note" role="alert">
          OCI deployment helper unavailable. Check the OCI operations socket, API configuration and installed helper.
        </p>}
        {supersededDirectFailure && <p className="navigation-diagnostics-note">
          An older direct OCI job failed, but the currently deployed API and frontend match the latest main commit.
          That job's failure is historical, not the status of the live release.
        </p>}
        {deployment?.oci?.state === 'failed' && !supersededDirectFailure && <p className="navigation-diagnostics-note" role="alert">
          OCI deployment failed at stage: {deployment.oci.stage ?? 'unknown'}.
          {ociError
            ? ` ${ociError}`
            : deployment.oci.stage === 'outdated-request'
            ? ' Main changed during deployment; refresh the source commit and retry.'
            : deployment.oci.stage === 'validating'
            ? ' Build checks failed on OCI; inspect the deployment console below.'
            : deployment.oci.stage === 'building'
            ? ' The build failed on OCI; inspect the deployment trail and journal above.'
            : deployment.oci.stage === 'verifying'
            ? ' Release verification failed; inspect OCI API, worker and frontend health.'
            : ' Inspect the deployment console below for the failure details.'}
        </p>}
        {deployment && releaseAlignment === 'current' &&
          <p className="navigation-diagnostics-note">OCI production is up to date.</p>}
        {deployment?.error && <p className="navigation-diagnostics-note" role="alert">
          {deployment.error}</p>}
        {deploymentError && <p className="navigation-diagnostics-note" role="alert">
          {deploymentError}</p>}
        {deployment?.active && <p className="navigation-diagnostics-note">
          An OCI production release is in progress — trail updates every few seconds.</p>}
        {deployment?.latestCommit && deployment.latestCommit !== webRelease?.commit &&
          <p className="navigation-diagnostics-note">
            Save changes before refreshing after deployment.</p>}
      </div>
      </div>
      {showLiveTrail && (
        <section className="navigation-deployment-console" aria-label="OCI deployment console">
          <div className="navigation-deployment-console-header">
            <strong>{isLiveDeploy ? 'Live deployment console' : 'Last deployment console'}</strong>
            <span className="navigation-deployment-console-status" role="status">
              <span className={liveConnectionError ? 'navigation-deployment-status-dot is-failed' :
                isLiveDeploy ? 'navigation-deployment-status-dot is-running' :
                deployment?.oci?.state === 'failed' && !supersededDirectFailure
                  ? 'navigation-deployment-status-dot is-failed' : 'navigation-deployment-status-dot'} aria-hidden="true" />
              {liveConnectionError ? 'Connection interrupted · retrying every 2s' :
                (isLiveDeploy ? 'Running' : deployment?.oci?.state === 'failed' &&
                  !supersededDirectFailure ? 'Failed' :
                  deployment?.oci?.state === 'succeeded' ? 'Completed' : 'Idle')+
                ' · auto-update 2s'+(lastCheckedAt?' · checked '+lastCheckedAt:' · connecting')}
            </span>
          </div>
          <div className="navigation-deployment-trail" ref={trailScrollRef}
            onScroll={handleConsoleScroll} role="log" aria-live="off"
            aria-label="Timestamped OCI build and deployment output" tabIndex={0}>
            {consoleLines.map((line,index)=><div className="navigation-deployment-log-line"
              key={line.key+':'+index}>{line.text}</div>)}
            {consoleLines.length===0 && isLiveDeploy && !liveConnectionError &&
              <div className="navigation-deployment-log-muted">
                Awaiting the first OCI log line · checking automatically every 2 seconds…
              </div>}
            {collector==='outdated' && <div className="navigation-deployment-log-error">
              Installed OCI agent is outdated and does not report log health. Install the latest OCI deployment control on the server.
            </div>}
            {collector==='missing' && <div className="navigation-deployment-log-error">
              OCI log collector is unavailable. Verify the installed operations broker.
            </div>}
            {buildState==='missing' && isLiveDeploy &&
              <div className="navigation-deployment-log-error">
                Build output file is missing on OCI. Check the deployment worker and log collector.
              </div>}
            {buildState==='unreadable' &&
              <div className="navigation-deployment-log-error">
                Build output file is unreadable by the OCI collector.
              </div>}
            {liveConnectionError &&
              <div className="navigation-deployment-log-error">{liveConnectionError}</div>}
            {deploymentError &&
              <div className="navigation-deployment-log-error">Release metadata: {deploymentError}</div>}
            {ociError && !supersededDirectFailure &&
              <div className="navigation-deployment-log-error">OCI deployment: {ociError}</div>}
          </div>
          <p className="navigation-deployment-console-caption">
            Read-only UTC timeline from OCI: stages, npm build output and service journal.
            New lines follow automatically; scrolling up pauses auto-scroll until you return to the bottom.
          </p>
        </section>
      )}
      {oracle.status === 'error' && <p className="navigation-diagnostics-note">Oracle API could not be reached.</p>}
      {oracle.status === 'ready' && !oracle.release && <p className="navigation-diagnostics-note">This API does not report release details yet.</p>}
    </section>}
  </div>;
}
