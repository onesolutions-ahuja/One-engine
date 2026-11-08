import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, ArrowRight, ChevronRight, ShieldCheck, AlertCircle, ExternalLink, CircleHelp, Command } from 'lucide-react';
import { setupShortcuts, type WorkspaceId } from '../../metadata/Definitions/metadata';
type HeadingProps = { eyebrow?: string; title: string; description?: string; actions?: ReactNode };
function relativeSecurityTime(iso:string,now:number):string{
  const offset=Date.parse(iso)-now;
  if(!Number.isFinite(offset))return 'Date unavailable';
  const amount=Math.abs(offset);
  const seconds=amount/1000;
  const [interval,unit]:[number,Intl.RelativeTimeFormatUnit]=seconds<60?[1_000,'second']:
    seconds<3600?[60_000,'minute']:seconds<86_400?[3_600_000,'hour']:
    seconds<604_800?[86_400_000,'day']:[604_800_000,'week'];
  return new Intl.RelativeTimeFormat(undefined,{numeric:'auto'}).format(Math.round(offset/interval),unit);
}
function securityActivityType(action:string):string{
  if(/login|sign.?in|session|auth/i.test(action))return 'Authentication activity';
  if(/password|recovery|credential/i.test(action))return 'Account recovery';
  if(/permission|role|access|policy/i.test(action))return 'Access control';
  if(/failed|denied|blocked|rejected/i.test(action))return 'Security alert';
  return 'Workspace security';
}
export function createSetupHome(Heading: (props: HeadingProps) => ReactNode) {
function SetupHome({ onNavigate, request, onShowShortcuts, onOpenAuditTrail }: { onNavigate: (workspace: WorkspaceId) => void; request: <T>(path:string)=>Promise<T>; onShowShortcuts:()=>void; onOpenAuditTrail?:()=>void }) {
  type SecurityEvent = {id:string;at:string;action:string};
  const [events,setEvents] = useState<SecurityEvent[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [helpOpen,setHelpOpen] = useState(false);
  const [lastUpdated,setLastUpdated]=useState<number|null>(null);
  const refreshInFlight=useRef(false);
  const refreshGeneration=useRef(0);
  const reload = useCallback(() => {
    // A double click must not start overlapping SQL requests or overwrite newer data.
    if(refreshInFlight.current)return () => {};
    refreshInFlight.current=true;
    const generation=++refreshGeneration.current;
    let active = true;
    setLoading(true);setError('');
    // Load enough events to show three distinct activities even when raw rows repeat.
    void request<{events:SecurityEvent[]}>('/auth/security-events?limit=15')
      .then(result => {if(active){setEvents(result.events ?? []);setLastUpdated(Date.now());}})
      .catch(() => {if(active){setError('Security activity unavailable for this user.');setEvents([]);setLastUpdated(null);}})
      .finally(() => {if(refreshGeneration.current===generation){refreshInFlight.current=false;if(active)setLoading(false);}});
    // React StrictMode replays effects. Invalidate the previous call so a new
    // effect can refresh rather than inheriting a permanently busy state.
    return () => {active=false;if(refreshGeneration.current===generation){refreshGeneration.current++;refreshInFlight.current=false;}};
  },[request]);
  useEffect(() => reload(), [reload]);
  return (
    <div className="home-content">
      <Heading title="Setup Home" description="Configure objects, pages, flows and access permissions for your organisation."
        actions={<div className="setup-home-refresh"><button type="button" className="btn" onClick={reload} disabled={loading} aria-busy={loading}><RefreshCw size={14} className={loading?'setup-refresh-spinning':undefined} aria-hidden="true" />{loading?'Refreshing…':'Refresh'}</button>
          {lastUpdated&&<small role="status">Updated {new Date(lastUpdated).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</small>}</div>} />
      <div className="welcome-banner setup-home-summary">
        <div className="welcome-copy">
          <h2>Workspace overview</h2>
          <p>Open a tool below to manage metadata, automation, access and your applications.</p>
        </div>
      </div>
      <div className="home-section-title"><div><h2>Quick access</h2><p>Open setup tools for this organisation.</p></div></div>
      <div className="shortcut-grid">
        {setupShortcuts.map(({ title, description, workspace, icon: Icon }) => (
          <button key={title} className="shortcut-card" onClick={() => onNavigate(workspace)}>
            <span className="shortcut-icon"><Icon size={19} /></span><span className="shortcut-title">{title}</span><span className="shortcut-description">{description}</span><ArrowRight className="shortcut-arrow" size={15} />
          </button>
        ))}
      </div>
      <div className="home-lower-grid">
        <section className="surface recent-surface"><div className="section-heading"><h2>Recent security activity</h2></div>
          {loading ? <p role="status">Loading security activity…</p> : error ? <p role="status">{error}</p> : events.length === 0 ? <p>No security activity recorded.</p> :
            events.filter((event,index,list)=>list.findIndex(candidate=>candidate.action===event.action&&candidate.at===event.at)===index).slice(0,3).map(event => {
              const failed=/(failed|denied|blocked|rejected)/i.test(event.action);
              return <div className="recent-row" key={event.id}>
                <span className={'recent-icon '+(failed?'red':'green')}>{failed?<AlertCircle size={16}/>:<ShieldCheck size={16}/>}</span>
                <div><strong>{event.action.replace(/([a-z])([A-Z])/g,'$1 $2')}</strong><small>{securityActivityType(event.action)}</small></div>
                <time dateTime={event.at} title={new Date(event.at).toLocaleString()}>{relativeSecurityTime(event.at,Date.now())}</time>
              </div>;
            })}
          {onOpenAuditTrail && <button type="button" className="text-action" onClick={onOpenAuditTrail}>View full audit trail <ArrowRight size={14}/></button>}
        </section>
        <section className="surface help-surface"><div className="section-heading"><h2>Resources</h2><ExternalLink size={15} /></div><button type="button" className="resource-row" aria-expanded={helpOpen} aria-controls="md-setup-help-details" onClick={()=>setHelpOpen(open=>!open)}><span><CircleHelp size={16} /></span><div><strong>Setup help</strong><small>Learn how to configure your org</small></div><ChevronRight size={15} /></button>
          {helpOpen && <div id="md-setup-help-details" className="resource-help-details"><p>Use Object Manager to configure records and fields, Page Builder to arrange screens, Flows to automate work, and Permission Sets to control access.</p></div>}
          <button type="button" className="resource-row" onClick={onShowShortcuts}><span><Command size={16} /></span><div><strong>Keyboard shortcuts</strong><small>Work faster in Setup</small></div><ChevronRight size={15} /></button></section>
      </div>
    </div>
  );
}


return SetupHome;
}

