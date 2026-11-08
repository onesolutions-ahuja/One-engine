import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink } from 'lucide-react';
import { assessApplicationSetup, type SetupDestination } from './appSetupReadiness';
import type {
  DashboardMetadata, FlowDefinitionMetadata, LibraryComponentMetadata,
  LightningAppMetadata, LightningPageMetadata, ObjectMetadata, ReportMetadata
} from '../../metadata/Definitions/metadata';
import './AppSetupGuide.css';

type Props = {
  app: LightningAppMetadata;
  apps: LightningAppMetadata[];
  objects: ObjectMetadata[];
  pages: LightningPageMetadata[];
  flows?: FlowDefinitionMetadata[];
  libraryComponents?: LibraryComponentMetadata[];
  reports?: ReportMetadata[];
  dashboards?: DashboardMetadata[];
  creating?: boolean;
  request?: <T>(path: string) => Promise<T>;
  onOpenWorkspace?: (destination: SetupDestination) => void;
};

export default function AppSetupGuide(props: Props) {
  const [loaded, setLoaded] = useState<{
    flows?: FlowDefinitionMetadata[]; reports?: ReportMetadata[]; dashboards?: DashboardMetadata[];
    error: string;
  }>({error:''});
  useEffect(() => {
    const request = props.request;
    if (!request) return;
    const linked = new Set([
      ...props.app.navigationPageApiNames,
      ...props.pages.filter(page => page.activationAssignments?.some(rule => rule.appId === props.app.apiName))
        .map(page => page.apiName)
    ]);
    const components = props.pages.filter(page => linked.has(page.apiName))
      .flatMap(page => page.components);
    const flowNeeded = components.some(component => {
      const p = component.properties ?? {};
      return Boolean(p.actionFlows || p.stateReadFlowApiName || p.stateWriteFlowApiName);
    });
    const reportNeeded = components.some(component => component.type === 'Report Chart');
    const dashboardNeeded = components.some(component => component.type === 'Dashboard');
    let active = true;
    setLoaded({error:''}); // Do not compare the next app against a previous app's optional metadata.
    const load = async () => {
      const [flows, reports, dashboards] = await Promise.allSettled([
        flowNeeded ? request<{flows: FlowDefinitionMetadata[]}>('/metadata/flows') : Promise.resolve({flows:[]}),
        reportNeeded ? request<{reports: ReportMetadata[]}>('/metadata/reports') : Promise.resolve({reports:[]}),
        dashboardNeeded ? request<{dashboards: DashboardMetadata[]}>('/metadata/dashboards') : Promise.resolve({dashboards:[]})
      ]);
      if (!active) return;
      setLoaded({
        flows: flows.status === 'fulfilled' ? flows.value.flows ?? [] : undefined,
        reports: reports.status === 'fulfilled' ? reports.value.reports ?? [] : undefined,
        dashboards: dashboards.status === 'fulfilled' ? dashboards.value.dashboards ?? [] : undefined,
        error: [flows, reports, dashboards].some(result => result.status === 'rejected')
          ? 'Some optional metadata could not be loaded; those references are marked for verification.' : ''
      });
    };
    void load();
    return () => { active = false; };
  }, [props.request, props.app.apiName, props.app.navigationPageApiNames, props.pages]);
  const knownFlows = props.request ? loaded.flows : props.flows;
  const knownReports = props.request ? loaded.reports : props.reports;
  const knownDashboards = props.request ? loaded.dashboards : props.dashboards;
  const checks = useMemo(() => assessApplicationSetup({
    app: props.app, apps: props.apps, creating: props.creating,
    objects: props.objects, pages: props.pages,
    flows: knownFlows, libraryComponents: props.libraryComponents,
    reports: knownReports, dashboards: knownDashboards
  }), [props.app, props.apps, props.creating, props.objects, props.pages,
    knownFlows, props.libraryComponents, knownReports, knownDashboards]);
  const configured = checks.filter(item => item.level === 'configured').length;
  const actions = checks.filter(item => item.level === 'action').length;
  const review = checks.filter(item => item.level === 'review').length;
  return <section className="app-setup-guide" aria-label="Application setup review">
    <div className="app-setup-guide-heading">
      <div>
        <h2>Application setup review</h2>
        <p>Build with shared Objects, Pages, Components and Flows. Configuration checks are not runtime tests.</p>
      </div>
      <div className="app-setup-guide-counts" aria-label="Configuration check totals">
        <span>{configured} configured</span>
        <span>{actions} need action</span>
        <span>{review} need verification</span>
      </div>
    </div>
    {loaded.error && <p className="app-setup-guide-note" role="status">{loaded.error}</p>}
    <ol className="app-setup-guide-list">
      {checks.map((check, index) => <li key={check.id} className={'app-setup-guide-item app-setup-guide-' + check.level}>
        <div className="app-setup-guide-icon" aria-hidden="true">
          {check.level === 'configured' ? <CheckCircle2 size={17}/> :
            check.level === 'action' ? <AlertTriangle size={17}/> : <CircleHelp size={17}/>}
        </div>
        <div className="app-setup-guide-content">
          <div className="app-setup-guide-item-heading">
            <strong>{index + 1}. {check.title}</strong>
            <span>{check.level === 'configured' ? 'Configured' : check.level === 'action' ? 'Action needed' : 'Not verified'}</span>
          </div>
          <p>{check.detail}</p>
          {check.findings.length > 0 && <ul>{check.findings.map((finding, position) =>
            <li key={position}>{finding}</li>)}</ul>}
        </div>
        {check.destination && props.onOpenWorkspace &&
          <button type="button" className="btn btn-small" onClick={() => props.onOpenWorkspace?.(check.destination!)}>
            Open <ExternalLink size={13} aria-hidden="true"/>
          </button>}
      </li>)}
    </ol>
    <p className="app-setup-guide-note">Launching or installing an app does not validate payments, legal checks, stock, permissions, or cross-device operation. Verify those independently in the runtime before use.</p>
  </section>;
}
