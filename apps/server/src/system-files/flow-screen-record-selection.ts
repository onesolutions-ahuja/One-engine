/** Shared, tenant-neutral Screen Flow record-selection contract.
 * Screens receive only collections explicitly bound to Data Table fields; submitted IDs
 * are resolved to typed Record Collections from server-held records, never client objects.
 */
/** Correctable screen submission error: a transactional rollback must leave the
 * caller's interview pending so they can change the selection and submit again.
 * Authorization errors from the record engine deliberately do not use this class.
 */
export class ScreenSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScreenSelectionError';
  }
}

export type FlowScreenRecord = Record<string, unknown>;
export type FlowScreenResource = { name: string; type: string; dataType: string };
export type FlowScreenField = Record<string, unknown>;

const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
const recordId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fields(screen: { config: Record<string, unknown> }): FlowScreenField[] {
  return Array.isArray(screen.config.fields)
    ? screen.config.fields.filter((item): item is FlowScreenField =>
      !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}
function target(field: FlowScreenField): string {
  return typeof field.selectedRowsResource === 'string' && field.selectedRowsResource
    ? field.selectedRowsResource : String(field.apiName ?? '');
}
function selectedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' && value ? [value] : [];
  return value.filter((item): item is string => typeof item === 'string');
}
function visibleRecord(value: unknown): value is FlowScreenRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as FlowScreenRecord).Id === 'string';
}

/** Only expose explicitly screen-bound collections, not every Flow variable. */
export function screenRecordPayload(screen: { config: Record<string, unknown> },
  vars: Record<string, unknown>, resources: FlowScreenResource[]) {
  const result: Record<string, unknown> = {};
  const screenResources: Record<string, FlowScreenRecord[]> = {};
  for (const field of fields(screen)) {
    const key = field.apiName;
    if (typeof key !== 'string' || !identifier.test(key)) continue;
    const type = field.type;
    if (type === 'Data Table') {
      const source = field.collection;
      if (typeof source === 'string' && resources.some(item =>
        item.name === source && item.type === 'Record Collection')
        && Array.isArray(vars[source])) {
        screenResources[source] = (vars[source] as unknown[]).filter(visibleRecord);
      }
    }
    const multi = type === 'Data Table' ? field.multiselect === true
      : type === 'Choice Lookup' && field.multipleSelections === true;
    const destination = resources.find(item => item.name === target(field)
      && item.type === 'Record Collection');
    if ((multi || destination) && destination && Array.isArray(vars[destination.name])) {
      result[key] = (vars[destination.name] as unknown[]).filter(visibleRecord)
        .map(item => item.Id);
    } else if (Object.hasOwn(vars, key)) result[key] = vars[key];
  }
  return { values: result, screenResources };
}

/** Return true if a typed selection was handled. Other scalar fields use the
 * existing Screen value path. Reader must enforce OneEngine Object/Record/FLS.
 */
export async function acceptScreenRecordSelection(
  field: FlowScreenField, value: unknown, vars: Record<string, unknown>,
  resources: FlowScreenResource[],
  readRecord: (objectApi: string, id: string) => Promise<FlowScreenRecord>
): Promise<boolean> {
  const type = field.type;
  if (type !== 'Data Table' && type !== 'Choice Lookup') return false;
  const multi = type === 'Data Table' ? field.multiselect === true
    : field.multipleSelections === true;
  const key = String(field.apiName ?? '');
  const output = target(field);
  const destination = resources.find(item => item.name === output
    && item.type === 'Record Collection');
  if (!multi && !destination) return false;
  if (!destination || !identifier.test(destination.dataType))
    throw new ScreenSelectionError('Screen selected rows require a typed Record Collection resource: ' + key);
  if (!multi && Array.isArray(value))
    throw new ScreenSelectionError('Single-select Screen field cannot accept multiple records: ' + key);
  if (!Array.isArray(value) && typeof value !== 'string' && value !== null
    && value !== undefined)
    throw new ScreenSelectionError('Invalid Screen selection: ' + key);
  const ids = selectedIds(value);
  if (Array.isArray(value) && ids.length !== value.length)
    throw new ScreenSelectionError('Invalid Screen selection entries: ' + key);
  if (ids.length > 200 || new Set(ids).size !== ids.length
    || ids.some(id => !recordId.test(id)))
    throw new ScreenSelectionError('Invalid or duplicate Screen selected record IDs: ' + key);
  const min = Math.max(field.required === true ? 1 : 0,
    typeof field.minimumSelections === 'number' ? field.minimumSelections : 0);
  const max = typeof field.maximumSelections === 'number' && field.maximumSelections > 0
    ? field.maximumSelections : 200;
  if (ids.length < min || ids.length > max || (!multi && ids.length > 1))
    throw new ScreenSelectionError('Screen selection count is outside the configured limits: ' + key);
  let records: FlowScreenRecord[];
  if (type === 'Data Table') {
    const source = field.collection;
    if (typeof source !== 'string' || source === output || !resources.some(item =>
      item.name === source && item.type === 'Record Collection'
      && item.dataType === destination.dataType) || !Array.isArray(vars[source]))
      throw new ScreenSelectionError('Screen source collection is unavailable or has an incompatible Object: ' + key);
    const available = new Map((vars[source] as unknown[]).filter(visibleRecord)
      .map(item => [item.Id as string, item]));
    for (const id of ids) {
      if (!available.has(id))
        throw new ScreenSelectionError('Screen selection is not in the permitted record collection: ' + key);
    }
    // Recheck record and field permissions at submission time: a record may have
    // changed or been revoked since Get Records originally populated the screen.
    records = [];
    for (const id of ids) records.push(await readRecord(destination.dataType, id));
  } else {
    if (field.objectApiName !== destination.dataType)
      throw new ScreenSelectionError('Screen selected rows Object does not match the lookup: ' + key);
    records = [];
    for (const id of ids) records.push(await readRecord(destination.dataType, id));
  }
  vars[output] = records;
  if (output !== key && !multi) vars[key] = ids[0] ?? '';
  return true;
}

/** Validate the visual Screen Flow binding at publish time, before an interview opens. */
export function validateScreenRecordBindings(
  screen: { config: Record<string, unknown> }, declared: FlowScreenResource[],
  elements: Array<{ id?: unknown; type?: unknown; config?: unknown }>
): string[] {
  const issues: string[] = [];
  const resources = [...declared];
  for (const element of elements) {
    if (element.type !== 'Get Records' || !element.config
      || typeof element.config !== 'object' || Array.isArray(element.config)) continue;
    const config = element.config as Record<string, unknown>;
    const limit = config.recordLimit ?? 1;
    if (limit !== 'all' && !(Number(limit) > 1)) continue;
    const name = typeof config.outputVariable === 'string' && config.outputVariable
      ? config.outputVariable : 'record' + String(element.id ?? '');
    if (identifier.test(name) && typeof config.object === 'string'
      && identifier.test(config.object) && !resources.some(item => item.name === name))
      resources.push({ name, type: 'Record Collection', dataType: config.object });
  }
  for (const field of fields(screen)) {
    if (field.type !== 'Data Table' && field.type !== 'Choice Lookup') continue;
    const key = String(field.apiName ?? '');
    const multi = field.type === 'Data Table'
      ? field.multiselect === true : field.multipleSelections === true;
    const output = typeof field.selectedRowsResource === 'string'
      ? field.selectedRowsResource : '';
    const min = field.minimumSelections ?? 0;
    const max = field.maximumSelections ?? 0;
    if (!Number.isInteger(min) || Number(min) < 0 || Number(min) > 200
      || !Number.isInteger(max) || Number(max) < 0 || Number(max) > 200
      || (max !== 0 && Number(min) > Number(max))
      || (!multi && Number(min) > 1))
      issues.push('Invalid Screen selection limits: ' + key);
    if (multi && !output) issues.push('Screen multiple selection requires a selected rows Record Collection: ' + key);
    if (!output) continue;
    const destination = declared.find(item => item.name === output && item.type === 'Record Collection');
    if (!destination) {
      issues.push('Screen selected rows output must be a declared Record Collection: ' + key);
      continue;
    }
    if (field.type === 'Data Table') {
      const source = resources.find(item => item.name === field.collection && item.type === 'Record Collection');
      if (!source || source.dataType !== destination.dataType || source.name === destination.name)
        issues.push('Screen Data Table source and selected output must be separate matching Record Collections: ' + key);
    } else if (field.objectApiName !== destination.dataType)
      issues.push('Screen Choice Lookup Object must match selected rows output: ' + key);
  }
  return issues;
}
