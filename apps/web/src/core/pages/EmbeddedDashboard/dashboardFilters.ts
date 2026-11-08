import type { DashboardFilterMetadata, DashboardMetadata } from '../../metadata/Definitions/metadata';

export type ActiveDashboardCrossFilter = DashboardFilterMetadata & { componentId: string };

export function dashboardFilterValue(
  filter: DashboardFilterMetadata,
  viewValues?: Record<string, string>
): string {
  return viewValues?.[filter.id] ?? filter.value;
}

export function dashboardFiltersForObject(
  filters: DashboardFilterMetadata[],
  objectApiName: string | undefined,
  viewValues?: Record<string, string>
): DashboardFilterMetadata[] {
  if (!objectApiName) return [];
  return filters
    .filter((filter) => filter.objectApiName === objectApiName)
    .map((filter) => ({ ...filter, value: dashboardFilterValue(filter, viewValues) }))
    .filter((filter) => filter.value.trim() !== ''
      || filter.operator === 'Is Null' || filter.operator === 'Is Not Null');
}

export function matchesDashboardFilter(
  record: Record<string, unknown>,
  filter: DashboardFilterMetadata
): boolean {
  const raw = record[filter.fieldApiName];
  if (filter.operator === 'Is Null') return raw === null || raw === undefined || raw === '';
  if (filter.operator === 'Is Not Null') return raw !== null && raw !== undefined && raw !== '';
  if (!filter.value.trim()) return true;
  const actual = raw === null || raw === undefined ? '' : String(raw);
  const expected = filter.value;
  if (filter.operator === 'Includes' || filter.operator === 'Excludes') {
    const selectedValues = expected.split(';').map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
    const actualValues = actual.split(';').map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
    return filter.operator === 'Includes'
      ? selectedValues.some((value) => actualValues.includes(value))
      : selectedValues.every((value) => !actualValues.includes(value));
  }
  if (filter.operator === 'Equals') return actual.toLocaleLowerCase() === expected.toLocaleLowerCase();
  if (filter.operator === 'Not Equal To') return actual.toLocaleLowerCase() !== expected.toLocaleLowerCase();
  if (filter.operator === 'Contains') return actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
  if (filter.operator === 'Starts With') return actual.toLocaleLowerCase().startsWith(expected.toLocaleLowerCase());
  const left = Number(actual);
  const right = Number(expected);
  if (Number.isFinite(left) && Number.isFinite(right)) {
    return filter.operator === 'Greater Than' ? left > right : left < right;
  }
  return filter.operator === 'Greater Than' ? actual > expected : actual < expected;
}

export function matchesDashboardFilters(
  record: Record<string, unknown>,
  filters: DashboardFilterMetadata[],
  objectApiName: string,
  filterLogic: DashboardMetadata['filterLogic'],
  viewValues?: Record<string, string>
): boolean {
  const applicableFilters = dashboardFiltersForObject(filters, objectApiName, viewValues);
  if (!applicableFilters.length) return true;
  const matches = applicableFilters.map((filter) => matchesDashboardFilter(record, filter));
  return filterLogic === 'Any' ? matches.some(Boolean) : matches.every(Boolean);
}

export function toggleDashboardCrossFilter(
  active: ActiveDashboardCrossFilter[],
  componentId: string,
  objectApiName: string,
  fieldApiName: string,
  value: string
): ActiveDashboardCrossFilter[] {
  const existing = active.find((filter) =>
    filter.componentId === componentId
    && filter.fieldApiName === fieldApiName
    && filter.value === value);
  if (existing) return active.filter((filter) => filter.id !== existing.id);
  return [...active, {
    id: crypto.randomUUID(),
    componentId,
    objectApiName,
    fieldApiName,
    operator: 'Equals',
    value
  }];
}
