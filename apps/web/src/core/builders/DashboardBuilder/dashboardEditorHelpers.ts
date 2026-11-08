import {generateMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import type { ActiveDashboardCrossFilter } from '../../pages/EmbeddedDashboard/dashboardFilters';
import type { DashboardComponentMetadata, DashboardFilterMetadata, DashboardMetadata, FieldMetadata, ObjectMetadata } from '../../metadata/Definitions/metadata';
export type RecordData = Record<string, unknown>;
export type Aggregation = DashboardComponentMetadata['aggregation'];
export type ComponentType = DashboardComponentMetadata['type'];
export type ActiveCrossFilter = ActiveDashboardCrossFilter;
export type RelationshipPathStep = { sourceObjectApiName: string; targetObjectApiName: string; fieldApiName: string; direction: 'forward' | 'reverse' };
export const defaultComponentTitles: Record<ComponentType, string> = {
  Metric: 'New Metric',
  Chart: 'New Chart',
  Table: 'New Table',
  'Rich Text': 'Rich Text',
  Image: 'Image',
  Custom: 'Custom Component'
};

export function relationshipPaths(
  objects: ObjectMetadata[],
  sourceObjectApiName: string,
  targetObjectApiName: string,
  maxDepth = 3
): RelationshipPathStep[][] {
  if (sourceObjectApiName === targetObjectApiName) return [[]];
  const paths: RelationshipPathStep[][] = [];
  const queue: Array<{ objectApiName: string; path: RelationshipPathStep[]; visited: Set<string> }> = [
    { objectApiName: sourceObjectApiName, path: [], visited: new Set([sourceObjectApiName]) }
  ];
  while (queue.length) {
    const current = queue.shift()!;
    if (current.path.length >= maxDepth) continue;
    const object = objects.find((item) => item.apiName === current.objectApiName);
    if (!object) continue;
    const edges: RelationshipPathStep[] = [
      ...object.fields.filter((field) => field.relationship).map((field) => ({
        sourceObjectApiName: object.apiName,
        targetObjectApiName: field.relationship!.targetObject,
        fieldApiName: field.apiName,
        direction: 'forward' as const
      })),
      ...objects.flatMap((relatedObject) => relatedObject.fields
        .filter((field) => field.relationship?.targetObject === object.apiName)
        .map((field) => ({
          sourceObjectApiName: object.apiName,
          targetObjectApiName: relatedObject.apiName,
          fieldApiName: field.apiName,
          direction: 'reverse' as const
        })))
    ];
    for (const edge of edges) {
      if (current.visited.has(edge.targetObjectApiName)) continue;
      const path = [...current.path, edge];
      if (edge.targetObjectApiName === targetObjectApiName) paths.push(path);
      else queue.push({ objectApiName: edge.targetObjectApiName, path, visited: new Set([...current.visited, edge.targetObjectApiName]) });
    }
  }
  return paths;
}

export function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename: string, headers: string[], rows: Record<string, unknown>[], fieldApiNames: string[]): void {
  const content = [headers.map(csvValue), ...rows.map((row) =>
    fieldApiNames.map((fieldApiName) => csvValue(row[fieldApiName])))]
    .map((row) => row.join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const filterOperators: DashboardFilterMetadata['operator'][] = [
  'Equals', 'Not Equal To', 'Contains', 'Starts With', 'Greater Than', 'Less Than', 'Is Null', 'Is Not Null'
];
export function dashboardFilterValueType(field: FieldMetadata | undefined): string {
  return field?.formula?.returnType ?? field?.dataType ?? 'Text';
}
export function dashboardFilterOperatorsFor(field: FieldMetadata | undefined): DashboardFilterMetadata['operator'][] {
  const type = dashboardFilterValueType(field);
  if (type === 'Checkbox' || type === 'Picklist') {
    return ['Equals', 'Not Equal To', 'Is Null', 'Is Not Null'];
  }
  if (type === 'Multi-Select Picklist') {
    return ['Equals', 'Not Equal To', 'Contains', 'Includes', 'Excludes', 'Is Null', 'Is Not Null'];
  }
  if (/^(Number|Currency|Percent)$/.test(type)) {
    return ['Equals', 'Not Equal To', 'Greater Than', 'Less Than', 'Is Null', 'Is Not Null'];
  }
  if (/^(Date|DateTime)$/.test(type)) {
    return ['Equals', 'Not Equal To', 'Greater Than', 'Less Than', 'Is Null', 'Is Not Null'];
  }
  return filterOperators;
}
export function dashboardFilterInputType(field: FieldMetadata | undefined): 'text' | 'number' | 'date' | 'datetime-local' {
  const type = dashboardFilterValueType(field);
  if (/^(Number|Currency|Percent)$/.test(type)) return 'number';
  if (type === 'Date') return 'date';
  if (type === 'DateTime') return 'datetime-local';
  return 'text';
}
export function dashboardFilterInputValue(field: FieldMetadata | undefined, value: string): string {
  if (dashboardFilterValueType(field) === 'Date') return value.slice(0, 10);
  if (dashboardFilterValueType(field) !== 'DateTime' || !value) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function dashboardFilterStoredValue(field: FieldMetadata | undefined, value: string): string {
  if (dashboardFilterValueType(field) !== 'DateTime' || !value) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}
export const chartPalette = ['#0176d3', '#2e844a', '#fe9339', '#ba0517', '#9050e9', '#0b827c', '#dd7a01', '#706e6b'];
export const chartPalettes = {
  Salesforce: chartPalette,
  'Colorblind Safe': ['#0176d3', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#56b4e9', '#f0e442', '#332288'],
  Monochrome: ['#032d60', '#014486', '#0176d3', '#1b96ff', '#78b0fd', '#a8cbff', '#c9e0ff', '#eaf5fe']
} as const;
export function chartPaletteFor(name: DashboardComponentMetadata['chartColorPalette']): readonly string[] {
  return chartPalettes[name ?? 'Salesforce'];
}
export const dashboardWidthSpans = { Quarter: 3, Half: 6, ThreeQuarter: 9, Full: 12 } as const;
export const dashboardHeightSpans = { Short: 1, Medium: 2, Tall: 3 } as const;

export function dashboardWidthForSpan(span: number): NonNullable<DashboardComponentMetadata['width']> {
  return span <= 3 ? 'Quarter' : span <= 6 ? 'Half' : span <= 9 ? 'ThreeQuarter' : 'Full';
}

export function dashboardHeightForSpan(span: number): NonNullable<DashboardComponentMetadata['height']> {
  return span <= 1 ? 'Short' : span <= 2 ? 'Medium' : 'Tall';
}

export function apiNameFor(label: string): string {
  return generateMetadataApiName(label) || 'Dashboard_New';
}

export function newDashboard(label: string): DashboardMetadata {
  const apiName = apiNameFor(label);
  return {
    apiName,
    label: label.trim(),
    description: '',
    folderName: 'Private Reports',
    ownerUserId: '',
    runningUserId: null,
    allowViewerToSelectRunningUser: false,
    visibility: 'Private',
    sharedUserIds: [],
    sharedPermissionSetGroupIds: [],
    filterLogic: 'All',
    refreshIntervalMinutes: 0,
    status: 'Draft',
    components: [],
    filters: []
  };
}

export function newComponent(type: ComponentType, objectApiName: string, firstField: string): DashboardComponentMetadata {
  return {
    id: crypto.randomUUID(),
    title: defaultComponentTitles[type],
    type,
    objectApiName,
    width: type === 'Table' ? 'Full' : 'Half',
    height: 'Medium',
    aggregation: 'Count',
    measureFieldApiName: null,
    groupByFieldApiName: firstField || null,
    seriesFieldApiName: null,
    gaugeMin: 0,
    gaugeMax: 100,
    gaugeRange1EndPercent: 33,
    gaugeRange2EndPercent: 67,
    showLegend: true,
    showValues: true,
    chartDataLabelPosition: 'Auto',
    chartSortOrder: 'Descending',
    chartLimit: 8,
    chartXAxisMinimum: null,
    chartXAxisMaximum: null,
    chartYAxisMinimum: null,
    chartYAxisMaximum: null,
    chartValueFormat: 'Number',
    chartCurrencyCode: 'USD',
    chartDecimalPlaces: 2,
    chartColorPalette: 'Salesforce',
    xAxisFieldApiName: null,
    xAxisTitle: '',
    yAxisTitle: '',
    showGridlines: true,
    legendPosition: 'Bottom',
    chartType: 'Bar',
    richTextContent: '',
    imageUrl: '',
    imageAltText: '',
    displayFieldApiNames: firstField ? [firstField] : []
  };
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatChartValue(
  value: number,
  component: Pick<DashboardComponentMetadata, 'chartValueFormat' | 'chartCurrencyCode' | 'chartDecimalPlaces'>
): string {
  const decimals = component.chartDecimalPlaces ?? 2;
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...(component.chartValueFormat === 'Currency'
      ? { style: 'currency', currency: component.chartCurrencyCode ?? 'USD' }
      : component.chartValueFormat === 'Percent' ? { style: 'percent' } : {})
  };
  return new Intl.NumberFormat(undefined, options).format(
    component.chartValueFormat === 'Percent' ? value / 100 : value
  );
}

export function chartAxisRange(
  values: number[],
  minimum: number | null | undefined,
  maximum: number | null | undefined
): { minimum: number; maximum: number } | null {
  const finiteValues = values.filter(Number.isFinite);
  let lower = minimum ?? Math.min(0, ...finiteValues);
  let upper = maximum ?? Math.max(0, ...finiteValues);
  if (minimum === null || minimum === undefined) lower = Number.isFinite(lower) ? lower : 0;
  if (maximum === null || maximum === undefined) upper = Number.isFinite(upper) ? upper : 1;
  if (lower >= upper) {
    if (minimum !== null && minimum !== undefined && maximum !== null && maximum !== undefined) return null;
    const step = Math.max(Math.abs(lower || upper) * 0.1, 1);
    if (minimum !== null && minimum !== undefined) upper = lower + step;
    else lower = upper - step;
  }
  return { minimum: lower, maximum: upper };
}

export function chartAxisTicks(range: { minimum: number; maximum: number }): number[] {
  return Array.from({ length: 5 }, (_, index) =>
    range.minimum + (range.maximum - range.minimum) * index / 4
  );
}

export function aggregate(records: RecordData[], component: DashboardComponentMetadata): number {
  if (component.aggregation === 'Count') return records.length;
  const values = records
    .map((record) => record[component.measureFieldApiName ?? ''])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite);
  if (!values.length) return 0;
  if (component.aggregation === 'Sum') return values.reduce((total, value) => total + value, 0);
  if (component.aggregation === 'Average') return values.reduce((total, value) => total + value, 0) / values.length;
  return component.aggregation === 'Minimum' ? Math.min(...values) : Math.max(...values);
}

export function aggregateReportSummary(
  summary: { rowCount: number; sums: Record<string, number>; counts: Record<string, number>; minimums: Record<string, number>; maximums: Record<string, number> },
  component: DashboardComponentMetadata
): number {
  if (component.aggregation === 'Count') return summary.rowCount;
  const fieldApiName = component.measureFieldApiName ?? '';
  const count = summary.counts[fieldApiName] ?? 0;
  if (!count) return 0;
  if (component.aggregation === 'Sum') return summary.sums[fieldApiName] ?? 0;
  if (component.aggregation === 'Average') return (summary.sums[fieldApiName] ?? 0) / count;
  return component.aggregation === 'Minimum'
    ? summary.minimums[fieldApiName] ?? 0
    : summary.maximums[fieldApiName] ?? 0;
}

