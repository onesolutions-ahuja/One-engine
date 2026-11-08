import {findRegisteredComponent} from '../../components/Registry/componentRegistryLookup';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DashboardComponentMetadata, DashboardMetadata, LibraryComponentMetadata, ReportRunMetadata
} from '../../metadata/Definitions/metadata';
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type TileData = { rows: Record<string, unknown>[]; total: number; run?: ReportRunMetadata };
type Result = { value: TileData | null; error: string };

export function dashboardComponentValue(component: DashboardComponentMetadata, result: TileData): number {
  const key = component.measureFieldApiName ?? '';
  const numeric = result.rows.map(row => Number(row[key])).filter(Number.isFinite);
  if (component.aggregation === 'Count') return result.run?.summaryTotals.rowCount ?? result.total;
  if (component.aggregation === 'Sum') return result.run?.summaryTotals.sums[key] ?? numeric.reduce((sum, n) => sum + n, 0);
  if (component.aggregation === 'Average') {
    const sum = result.run?.summaryTotals.sums[key] ?? numeric.reduce((value, n) => value + n, 0);
    const count = result.run?.summaryTotals.counts[key] ?? numeric.length;
    return count ? sum / count : 0;
  }
  if (component.aggregation === 'Minimum')
    return result.run?.summaryTotals.minimums[key] ?? (numeric.length ? Math.min(...numeric) : 0);
  return result.run?.summaryTotals.maximums[key] ?? (numeric.length ? Math.max(...numeric) : 0);
}

const safeImage = (url: string) => {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
};
const title = (entry: DashboardComponentMetadata) => entry.title || entry.type;

export default function EmbeddedDashboard({
  dashboardApiName, request, libraryComponents
}: {
  dashboardApiName: string;
  request: Request;
  libraryComponents: LibraryComponentMetadata[];
}) {
  const [dashboard, setDashboard] = useState<DashboardMetadata | null>(null);
  const [data, setData] = useState<Record<string, Result>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let active = true;
    setDashboard(null); setData({}); setStatus('loading'); setError('');
    if (!dashboardApiName) {
      setStatus('error'); setError('Select a published dashboard in Page Builder.'); return;
    }
    // The API returns dashboards filtered by folder sharing, tenant and user.
    void request<{ dashboards: DashboardMetadata[] }>('/metadata/dashboards')
      .then(async response => {
        const allowed = response.dashboards.find(item => item.apiName === dashboardApiName
          && item.status === 'Deployed');
        if (!allowed) throw Error('Dashboard is not published or you do not have access.');
        if (!active) return;
        setDashboard(allowed);
        const values = await Promise.all(allowed.components.map(async component => {
          if (['Rich Text', 'Image'].includes(component.type))
            return [component.id, { value: null, error: '' }] as const;
          try {
            let value: TileData;
            if (component.reportApiName) {
              // All saved-report operations carry the dashboard context for
              // current running-user, filter and report security enforcement.
              const run = await request<ReportRunMetadata>(
                '/reports/' + encodeURIComponent(component.reportApiName) + '/run', {
                  method: 'POST',
                  body: JSON.stringify({
                    dashboardApiName: allowed.apiName,
                    dashboardFilters: allowed.filters,
                    dashboardFilterLogic: allowed.filterLogic,
                    offset: 0, limit: 100
                  })
                }
              );
              value = { rows: run.rows, total: run.totalRows, run };
            } else {
              const response = await request<{ records: Record<string, unknown>[] }>(
                '/metadata/dashboards/' + encodeURIComponent(allowed.apiName)
                  + '/data/' + encodeURIComponent(component.objectApiName));
              value = { rows: response.records, total: response.records.length };
            }
            return [component.id, { value, error: '' }] as const;
          } catch (failure) {
            return [component.id, { value: null, error: failure instanceof Error
              ? failure.message : 'Dashboard data is unavailable' }] as const;
          }
        }));
        if (active) { setData(Object.fromEntries(values)); setStatus('ready'); }
      })
      .catch(failure => {
        if (active) { setStatus('error'); setError(failure instanceof Error ? failure.message : 'Unable to access dashboard'); }
      });
    return () => { active = false; };
  }, [dashboardApiName, request, revision]);

  const number = useMemo(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }), []);
  if (status === 'error') return <div className="records-message" role="alert">{error}</div>;
  if (status === 'loading' || !dashboard)
    return <div className="records-loading" role="status">Loading dashboard…</div>;
  return <section className="page-embedded-dashboard" aria-label={dashboard.label} data-dashboard={dashboard.apiName}>
    <header className="page-embedded-dashboard-header">
      <div><strong>{dashboard.label}</strong>{dashboard.description && <small>{dashboard.description}</small>}</div>
      <button type="button" className="btn btn-small" onClick={refresh}>Refresh</button>
    </header>
    <div className="page-embedded-dashboard-grid">
      {dashboard.components.map(component => {
        const tile = data[component.id];
        const values = tile?.value;
        const measure = values ? dashboardComponentValue(component, values) : 0;
        const grouped = new Map<string, number>();
        if (values && component.type === 'Chart') for (const row of values.rows) {
          const key = String(component.groupByFieldApiName ? row[component.groupByFieldApiName] ?? 'Unspecified' : 'Records');
          grouped.set(key, (grouped.get(key) ?? 0) + (component.aggregation === 'Count' ? 1
            : Number(row[component.measureFieldApiName ?? '']) || 0));
        }
        const series = [...grouped.entries()].slice(0, Math.max(1, Math.min(20, component.chartLimit ?? 12)));
        const max = Math.max(1, ...series.map(([, value]) => Math.abs(value)));
        const cls = component.width === 'Full' ? 'full' : component.width === 'Half' ? 'half'
          : component.width === 'ThreeQuarter' ? 'three-quarter' : 'quarter';
        return <article className={'page-embedded-dashboard-tile ' + cls} key={component.id}
          aria-label={title(component)}>
          <h3>{title(component)}</h3>
          {component.subtitle && <small>{component.subtitle}</small>}
          {tile?.error ? <p className="records-message" role="alert">{tile.error}</p>
            : component.type === 'Rich Text' ? <p>{component.richTextContent || ''}</p>
            : component.type === 'Image' ? (component.imageUrl && safeImage(component.imageUrl)
              ? <img src={component.imageUrl} alt={component.imageAltText || component.title} loading="lazy" style={{maxWidth:'100%'}}/>
              : <p className="records-empty">No secure image is configured.</p>)
            : component.type === 'Custom' ? (() => {
                const definition = findRegisteredComponent(libraryComponents,component.customComponentApiName,'dashboard');
                return definition ? <RegisteredComponent definition={definition} props={{
                  ...(component.properties ?? {}),
                  properties: component.properties ?? {},
                  title: component.title,
                  label: component.title,
                  object: undefined,
                  records: values?.rows ?? [],
                  filters: dashboard.filters.filter(filter => filter.objectApiName === component.objectApiName),
                  disabled: false
                }}/> : <p className="records-message">Published dashboard component is unavailable.</p>;
              })()
            : !values ? <p className="records-loading">Loading data…</p>
            : component.type === 'Metric' ? <strong className="page-embedded-dashboard-metric">{number.format(measure)}</strong>
            : component.type === 'Table'
              ? <div className="page-embedded-dashboard-table"><table className="records-table"><thead><tr>
                  {component.displayFieldApiNames.map(name => <th key={name}>{name}</th>)}
                </tr></thead><tbody>
                  {values.rows.slice(0, 25).map((row, i) => <tr key={String(row.Id ?? i)}>{
                    component.displayFieldApiNames.map(name => <td key={name}>{String(row[name] ?? '')}</td>)
                  }</tr>)}
                </tbody></table></div>
              : <div className="page-embedded-dashboard-bars" role="img"
                  aria-label={component.title + ' chart'}>
                  {series.map(([label,value]) => <div key={label} title={label + ': ' + number.format(value)}>
                    <span className="page-embedded-dashboard-bar" style={{height:Math.max(3,100 * Math.abs(value)/max)+'%'}}/>
                    <small>{label}</small>
                  </div>)}
                  {!series.length && <p>No matching records.</p>}
                </div>}
          {component.footer && <small>{component.footer}</small>}
        </article>;
      })}
    </div>
  </section>;
}
