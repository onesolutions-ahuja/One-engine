import type { ObjectMetadata, PageLayoutMetadata, RelatedLookupFilterMetadata } from '../../metadata/Definitions/metadata';
export type RecordData = { Id: string; [fieldApiName: string]: unknown };

export function pageLayoutForRecord(object: ObjectMetadata, recordTypeId: string, profileId: string): PageLayoutMetadata | undefined {
  const assignments = object.pageLayoutAssignments ?? [];
  const effectiveType = recordTypeId || object.recordTypes?.find(type => type.isDefault)?.id || '';
  const priority = [
    [profileId, effectiveType], ['*', effectiveType], [profileId, '*'], ['*', '*']
  ];
  const assignment = priority.map(([profile, type]) =>
    assignments.find(item => item.profileId === profile && item.recordTypeId === type)
  ).find(Boolean);
  return object.pageLayouts?.find((layout) => layout.id === assignment?.pageLayoutId) ?? object.pageLayouts?.[0];
}

export function compactLayoutForRecord(object: ObjectMetadata, recordTypeId: string, profileId: string) {
  const layouts = object.compactLayouts ?? [];
  const assignments = object.compactLayoutAssignments ?? [];
  const effectiveType = recordTypeId || object.recordTypes?.find(type => type.isDefault)?.id || '';
  const priority = [
    [profileId, effectiveType], ['*', effectiveType], [profileId, '*'], ['*', '*']
  ];
  const assignment = priority.map(([profile, type]) =>
    assignments.find(item => item.profileId === profile && item.recordTypeId === type)
  ).find(Boolean);
  return layouts.find((layout) => layout.id === assignment?.compactLayoutId)
    ?? layouts[0]
    ?? (object.compactLayout ? { id: `${object.apiName}-legacy-compact`, ...object.compactLayout } : undefined);
}

export const relatedLookupFilterOperators: RelatedLookupFilterMetadata['operator'][] = [
  'Equals', 'Not Equal To', 'Contains', 'Starts With', 'Greater Than', 'Less Than', 'Is Null', 'Is Not Null'
];

export function matchesLookupFilter(record: RecordData, filter: RelatedLookupFilterMetadata, sourceRecord: Record<string, unknown>): boolean {
  const rawValue = record[filter.relatedFieldApiName];
  const actual = rawValue === undefined || rawValue === null ? '' : String(rawValue);
  const expectedValue = filter.valueFieldApiName ? sourceRecord[filter.valueFieldApiName] : filter.value;
  const expected = expectedValue === undefined || expectedValue === null ? '' : String(expectedValue);
  if (filter.operator === 'Is Null') return rawValue === undefined || rawValue === null || rawValue === '';
  if (filter.operator === 'Is Not Null') return rawValue !== undefined && rawValue !== null && rawValue !== '';
  if (filter.operator === 'Equals') return actual === expected;
  if (filter.operator === 'Not Equal To') return actual !== expected;
  if (filter.operator === 'Contains') return actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
  if (filter.operator === 'Starts With') return actual.toLocaleLowerCase().startsWith(expected.toLocaleLowerCase());
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return filter.operator === 'Greater Than' ? actualNumber > expectedNumber : actualNumber < expectedNumber;
  }
  return filter.operator === 'Greater Than'
    ? actual.localeCompare(expected) > 0
    : actual.localeCompare(expected) < 0;
}

export function matchesLookupFilterGroup(
  record: RecordData,
  filters: RelatedLookupFilterMetadata[],
  sourceRecord: Record<string, unknown>,
  logic: 'All' | 'Any'
): boolean {
  if (filters.length === 0) return true;
  const results = filters.map((filter) => matchesLookupFilter(record, filter, sourceRecord));
  return logic === 'Any' ? results.some(Boolean) : results.every(Boolean);
}


