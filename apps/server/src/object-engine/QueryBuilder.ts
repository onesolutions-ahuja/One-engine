import {excelWildcardSqlLike} from '../expression-engine/FormulaWildcard.js';

export type RecordFilterOperator =
  | 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'
  | 'contains' | 'startsWith' | 'matches' | 'includes' | 'excludes' | 'in' | 'isBlank' | 'isNotBlank';

export type RecordFilter = {
  field: string;
  operator: RecordFilterOperator;
  value: string | string[];
};

export type QueryField = {
  api_name: string;
  data_type: string;
  rollup_source_data_type?: string | null;
  /** Set for a one-level lookup path filter such as Product.AgeRestricted:
   * api_name is the related object's field and access is the caller's
   * record-access predicate for the related record (alias rel). */
  via?: { lookupField: string; access: string };
};

export type RecordCursor = {
  field: string | null;
  direction: 'asc' | 'desc';
  value: string | null;
  id: string;
};

const apiName = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Field name or one-level lookup path (Lookup.Field). */
export const filterFieldPath = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;
const recordIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operators = new Set<RecordFilterOperator>([
  'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'matches', 'includes', 'excludes', 'in', 'isBlank', 'isNotBlank',
]);
const typedColumns: Record<string, { column: string; cast: string }> = {
  number: { column: 'value_number', cast: 'numeric' },
  currency: { column: 'value_number', cast: 'numeric' },
  percent: { column: 'value_number', cast: 'numeric' },
  date: { column: 'value_date', cast: 'date' },
  datetime: { column: 'value_datetime', cast: 'timestamptz' },
  boolean: { column: 'value_boolean', cast: 'boolean' },
};

export function parseFilterLogic(logic: string | undefined, count: number): string {
  if (!Number.isInteger(count) || count < 0 || count > 20)
    throw new Error('Invalid record filter count');
  if (count === 0) {
    if (logic?.trim()) throw new Error('Filter logic requires filters');
    return '';
  }
  if (!logic?.trim()) return Array.from({ length: count }, (_, index) => `f${index}`).join(' AND ');

  const tokens = logic.match(/\d+|AND|OR|\(|\)/gi) ?? [];
  if (tokens.join('').toLowerCase() !== logic.replace(/\s+/g, '').toLowerCase())
    throw new Error('Invalid record filter logic');
  let position = 0;
  const used=new Set<number>();
  const parsePrimary = (): string => {
    const token = tokens[position++];
    if (token === '(') {
      const result = parseOr();
      if (tokens[position++] !== ')') throw new Error('Invalid record filter logic');
      return `(${result})`;
    }
    const index = Number(token);
    if (!Number.isInteger(index) || index < 1 || index > count)
      throw new Error('Invalid record filter reference');
    if(used.has(index))throw new Error('Duplicate record filter reference');
    used.add(index);
    return `f${index - 1}`;
  };
  const parseAnd = (): string => {
    let value = parsePrimary();
    while (tokens[position]?.toUpperCase() === 'AND') {
      position++;
      value = `(${value} AND ${parsePrimary()})`;
    }
    return value;
  };
  const parseOr = (): string => {
    let value = parseAnd();
    while (tokens[position]?.toUpperCase() === 'OR') {
      position++;
      value = `(${value} OR ${parseAnd()})`;
    }
    return value;
  };
  const result = parseOr();
  if (position !== tokens.length||used.size!==count) throw new Error('Invalid record filter logic');
  return result;
}

export function parseRecordFilters(raw: string | undefined): RecordFilter[] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid record filters');
  }
  if (!Array.isArray(parsed) || parsed.length > 20) throw new Error('Invalid record filters');
  return parsed.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid record filter');
    const filter = item as Record<string, unknown>;
    if (typeof filter.field !== 'string' || !filterFieldPath.test(filter.field) ||
        typeof filter.operator !== 'string' || !operators.has(filter.operator as RecordFilterOperator) ||
        (typeof filter.value !== 'string' && !Array.isArray(filter.value)) ||
        (Array.isArray(filter.value) && filter.value.some(value => typeof value !== 'string')))
      throw new Error('Invalid record filter');
    if((filter.operator==='isBlank'||filter.operator==='isNotBlank')&&filter.value!=='')
      throw new Error('Blank filters require an empty value');
    return {
      field: filter.field,
      operator: filter.operator as RecordFilterOperator,
      value: filter.value as string | string[],
    };
  });
}

export function parseRecordCursor(raw: string | undefined): RecordCursor | undefined {
  if (raw === undefined) return undefined;
  if (raw.length > 2048) throw new Error('Invalid record cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid record cursor');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid record cursor');
  const cursor = parsed as Record<string, unknown>;
  if ((cursor.field !== null && (typeof cursor.field !== 'string' || !apiName.test(cursor.field))) ||
      (cursor.direction !== 'asc' && cursor.direction !== 'desc') ||
      (cursor.value !== null && (typeof cursor.value !== 'string' || cursor.value.length > 512)) ||
      typeof cursor.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id))
    throw new Error('Invalid record cursor');
  return cursor as RecordCursor;
}

/**
 * Relative saved-view date values deliberately remain symbolic in storage.
 * PostgreSQL resolves them at query time, so a "Today" view also works tomorrow.
 * UTC boundaries are explicit rather than depending on the database session timezone.
 */
const relativeDatePeriods: Record<string, [string, string]> = {
  '@yesterday': ["(now() AT TIME ZONE 'UTC')::date - 1", "(now() AT TIME ZONE 'UTC')::date"],
  '@today': ["(now() AT TIME ZONE 'UTC')::date", "(now() AT TIME ZONE 'UTC')::date + 1"],
  '@tomorrow': ["(now() AT TIME ZONE 'UTC')::date + 1", "(now() AT TIME ZONE 'UTC')::date + 2"],
  '@last_week': ["date_trunc('week', now() AT TIME ZONE 'UTC')::date - 7", "date_trunc('week', now() AT TIME ZONE 'UTC')::date"],
  '@this_week': ["date_trunc('week', now() AT TIME ZONE 'UTC')::date", "date_trunc('week', now() AT TIME ZONE 'UTC')::date + 7"],
  '@next_week': ["date_trunc('week', now() AT TIME ZONE 'UTC')::date + 7", "date_trunc('week', now() AT TIME ZONE 'UTC')::date + 14"],
  '@last_month': ["date_trunc('month', now() AT TIME ZONE 'UTC')::date - interval '1 month'", "date_trunc('month', now() AT TIME ZONE 'UTC')::date"],
  '@this_month': ["date_trunc('month', now() AT TIME ZONE 'UTC')::date", "date_trunc('month', now() AT TIME ZONE 'UTC')::date + interval '1 month'"],
  '@next_month': ["date_trunc('month', now() AT TIME ZONE 'UTC')::date + interval '1 month'", "date_trunc('month', now() AT TIME ZONE 'UTC')::date + interval '2 months'"],
  '@last_year': ["date_trunc('year', now() AT TIME ZONE 'UTC')::date - interval '1 year'", "date_trunc('year', now() AT TIME ZONE 'UTC')::date"],
  '@this_year': ["date_trunc('year', now() AT TIME ZONE 'UTC')::date", "date_trunc('year', now() AT TIME ZONE 'UTC')::date + interval '1 year'"],
  '@next_year': ["date_trunc('year', now() AT TIME ZONE 'UTC')::date + interval '1 year'", "date_trunc('year', now() AT TIME ZONE 'UTC')::date + interval '2 years'"],
};

export function compileRecordFilters(
  filters: readonly RecordFilter[],
  logic: string | undefined,
  fields: ReadonlyMap<string, QueryField>,
  firstParameter: number,
  exactIndexedFields: ReadonlySet<string> = new Set<string>(),
): { predicate: string; parameters: unknown[] } {
  if (filters.length > 20) throw new Error('Too many record filters');
  const parameters: unknown[] = [];
  const predicates = filters.map((filter, index) => {
    if (!filterFieldPath.test(filter.field)) throw new Error('Invalid list field');
    // Id is a system column, not a value in md_record_values. Keep it inside
    // the normal tenant/record-access-scoped query so extra filters still apply.
    if (filter.field === 'Id') {
      if (filter.operator === 'isBlank' || filter.operator === 'isNotBlank') {
        if (filter.value !== '') throw new Error('Blank filters require an empty value');
        return filter.operator === 'isBlank' ? 'FALSE' : 'TRUE';
      }
      if (filter.operator === 'eq' || filter.operator === 'ne') {
        if (typeof filter.value !== 'string') throw new Error('Invalid record Id filter');
        if (!recordIdPattern.test(filter.value)) return filter.operator === 'eq' ? 'FALSE' : 'TRUE';
        const bind='$'+(firstParameter+parameters.length);
        parameters.push(filter.value);
        return 'r.id'+(filter.operator === 'eq' ? '=' : '<>')+bind+'::uuid';
      }
      if (filter.operator === 'in') {
        if (!Array.isArray(filter.value)||!filter.value.length||filter.value.length>100||
          filter.value.some(value=>typeof value!=='string'||!recordIdPattern.test(value)))
          throw new Error('Invalid record Id filter');
        const bind='$'+(firstParameter+parameters.length);
        parameters.push(filter.value);
        return 'r.id=ANY('+bind+'::uuid[])';
      }
      throw new Error('Unsupported record Id filter operator');
    }
    const field = fields.get(filter.field);
    if (field?.via) {
      // Lookup path: evaluate the same predicate against the related record
      // (alias rel) reached through the lookup value, with its record access.
      const lookupParameter = `$${firstParameter + parameters.length}`;
      parameters.push(field.via.lookupField);
      const inner = compileRecordFilters([{ ...filter, field: field.api_name }], undefined,
        new Map([[field.api_name, { ...field, via: undefined }]]), firstParameter + parameters.length);
      parameters.push(...inner.parameters);
      return `EXISTS(SELECT 1 FROM md_record_values lk JOIN md_records rel
        ON rel.tenant_id=lk.tenant_id AND rel.id=lk.reference_record_id AND rel.is_deleted=false
        WHERE lk.tenant_id=r.tenant_id AND lk.record_id=r.id AND lk.object_api=r.object_api
          AND lk.field_api=${lookupParameter} AND ${field.via.access}
          AND ${inner.predicate.replace(/\br\./g, 'rel.')})`;
    }
    if (filter.field.includes('.')) throw new Error('Invalid list field');
    if (!field || ['formula', 'geolocation', 'address', 'encryptedtext'].includes(field.data_type))
      throw new Error('Invalid list field');
    if (!operators.has(filter.operator))
      throw new Error('Invalid record filter operator');
    const sourceType = field.data_type === 'rollup' ? field.rollup_source_data_type : field.data_type;
    const typed = sourceType ? typedColumns[sourceType] : undefined;
    const fieldParameter = `$${firstParameter + parameters.length}`;
    parameters.push(filter.field);
    if(filter.operator==='isBlank'||filter.operator==='isNotBlank'){
      if(filter.value!=='')throw new Error('Blank filters require an empty value');
      const hasValue=`COALESCE(fv.value_text,fv.reference_record_id::text,'')<>''`;
      const valuePredicate=filter.operator==='isBlank'
        ?`NOT EXISTS(SELECT 1 FROM md_record_values fv WHERE fv.tenant_id=r.tenant_id
          AND fv.record_id=r.id AND fv.object_api=r.object_api AND fv.field_api=${fieldParameter}
          AND ${hasValue})`
        :`EXISTS(SELECT 1 FROM md_record_values fv WHERE fv.tenant_id=r.tenant_id
          AND fv.record_id=r.id AND fv.object_api=r.object_api AND fv.field_api=${fieldParameter}
          AND ${hasValue})`;
      return valuePredicate;
    }
    const valueParameter = `$${firstParameter + parameters.length}`;
    // A date-only selection (or a relative period) denotes a whole local-calendar
    // date in UTC, including records with a time component on Date/Time fields.
    const period = typeof filter.value === 'string'
      ? relativeDatePeriods[filter.value] ??
        (/^\d{4}-\d{2}-\d{2}$/.test(filter.value)
          ? [valueParameter + '::date', '(' + valueParameter + '::date + 1)'] as [string, string]
          : undefined)
      : undefined;
    if (typeof filter.value === 'string' && filter.value.startsWith('@') &&
        (sourceType === 'date' || sourceType === 'datetime') &&
        !relativeDatePeriods[filter.value])
      throw new Error('Invalid relative date filter');
    if (period && (sourceType === 'date' || sourceType === 'datetime')) {
      if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(filter.operator))
        throw new Error('Invalid date filter operator');
      // Only concrete dates need a bound parameter; symbolic periods use SQL current time.
      if (!relativeDatePeriods[filter.value as string]) parameters.push(filter.value);
      const boundary = (sql: string) => sourceType === 'datetime'
        ? '(' + sql + ')::timestamp AT TIME ZONE ' + "'UTC'"
        : '(' + sql + ')::date';
      const [start, end] = period;
      const column = 'fv.' + typed!.column;
      const comparisons: Record<string, string> = {
        eq: column + '>=' + boundary(start) + ' AND ' + column + '<' + boundary(end),
        ne: column + '>=' + boundary(start) + ' AND ' + column + '<' + boundary(end),
        lt: column + '<' + boundary(start),
        lte: column + '<' + boundary(end),
        gt: column + '>=' + boundary(end),
        gte: column + '>=' + boundary(start),
      };
      const existence = 'EXISTS(SELECT 1 FROM md_record_values fv WHERE fv.tenant_id=r.tenant_id' +
        ' AND fv.record_id=r.id AND fv.object_api=r.object_api AND fv.field_api=' + fieldParameter +
        ' AND (' + comparisons[filter.operator] + '))';
      return filter.operator === 'ne' ? 'NOT ' + existence : existence;
    }
    if (typeof filter.value === 'string' && relativeDatePeriods[filter.value] &&
        typed && sourceType !== 'date' && sourceType !== 'datetime')
      throw new Error('Relative dates require a date field');
    if (filter.operator === 'in') {
      if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 100 ||
          filter.value.some(value => typeof value !== 'string' || value.length > 512))
        throw new Error('Invalid IN filter values');
      parameters.push(filter.value);
      const column = typed ? `fv.${typed.column}` : `COALESCE(fv.value_text,fv.reference_record_id::text)`;
      const cast = typed ? `::${typed.cast}[]` : '::text[]';
      return `EXISTS(SELECT 1 FROM md_record_values fv WHERE fv.tenant_id=r.tenant_id
        AND fv.record_id=r.id AND fv.object_api=r.object_api AND fv.field_api=${fieldParameter}
        AND ${column}=ANY(${valueParameter}${cast}))`;
    }
    if (typeof filter.value !== 'string' || filter.value.length > 2000)
      throw new Error('Invalid record filter value');
    if ((filter.operator === 'includes' || filter.operator === 'excludes') &&
        field.data_type === 'multipicklist') {
      const includedValues=filter.value.split(';');
      if(includedValues.some(value=>!value||value.length>512)
        ||includedValues.length>200||new Set(includedValues).size!==includedValues.length)
        throw new Error('Invalid multi-select filter values');
      parameters.push(includedValues);
      const membership = `COALESCE((SELECT array_agg(mv.value ORDER BY mv.sort_order)
        FROM md_record_multi_values mv WHERE mv.tenant_id=r.tenant_id AND mv.record_id=r.id
          AND mv.object_api=r.object_api AND mv.field_api=${fieldParameter}),ARRAY[]::text[])`;
      return filter.operator==='includes'
        ?`${membership} @> ${valueParameter}::text[]`
        :`NOT (${membership} @> ${valueParameter}::text[])`;
    }
    if (filter.operator === 'matches') {
      if (!['text', 'email', 'phone', 'url', 'picklist'].includes(field.data_type))
        throw new Error('Wildcard criteria require a text field');
      const pattern=excelWildcardSqlLike(filter.value);
      parameters.push(pattern);
      // Like the Excel wildcard criterion "*", omit blank text cells.
      const nonblank=filter.value.includes('*')||filter.value.includes('?')
        ? " AND fv.value_text<>''" : '';
      return `EXISTS(SELECT 1 FROM md_record_values fv WHERE fv.tenant_id=r.tenant_id
        AND fv.record_id=r.id AND fv.object_api=r.object_api AND fv.field_api=${fieldParameter}
        AND lower(fv.value_text) LIKE lower(${valueParameter}) ESCAPE '\\'${nonblank})`;
    }
    if (filter.operator === 'contains' || filter.operator === 'startsWith') {
      if (!['text', 'email', 'phone', 'url', 'picklist'].includes(field.data_type))
        throw new Error('Text operators require a text field');
      const escapedValue = filter.value.replace(/[\\%_]/g, '\\$&');
      parameters.push(filter.operator === 'contains' ? `%${escapedValue}%` : `${escapedValue}%`);
      return `EXISTS(SELECT 1 FROM md_record_values fv WHERE fv.tenant_id=r.tenant_id
        AND fv.record_id=r.id AND fv.object_api=r.object_api AND fv.field_api=${fieldParameter}
        AND lower(fv.value_text) LIKE lower(${valueParameter}) ESCAPE '\\')`;
    }
    if (filter.operator === 'includes'||filter.operator==='excludes')
      throw new Error('Includes requires a multi-select picklist');
    if (filter.operator === 'ne') {
      parameters.push(filter.value);
      const comparison = typed
        ? `fv.${typed.column}=${valueParameter}::${typed.cast}`
        : `COALESCE(fv.value_text,fv.reference_record_id::text)=${valueParameter}`;
      return `NOT EXISTS(SELECT 1 FROM md_record_values fv WHERE fv.tenant_id=r.tenant_id
        AND fv.record_id=r.id AND fv.object_api=r.object_api AND fv.field_api=${fieldParameter}
        AND ${comparison})`;
    }
    const sqlOperators: Record<string, string> = { eq: '=', lt: '<', lte: '<=', gt: '>', gte: '>=' };
    const sqlOperator = sqlOperators[filter.operator];
    if (!sqlOperator) throw new Error('Invalid record filter operator');
    parameters.push(filter.value);
    const comparison = typed
      ? `fv.${typed.column}${sqlOperator}${valueParameter}::${typed.cast}`
      : `COALESCE(fv.value_text,fv.reference_record_id::text)${sqlOperator}${valueParameter}`;
    // Tenant-configured exact equality indexes are a search accelerator only:
    // retain the full source-value comparison to protect against hash collisions.
    const exactIndex=filter.operator==='eq'&&!typed
      &&['text','email','phone','url','picklist'].includes(field.data_type)
      &&exactIndexedFields.has(filter.field)
      ?` AND EXISTS(SELECT 1 FROM md_field_exact_index_entries ix
         WHERE ix.tenant_id=fv.tenant_id AND ix.object_api=fv.object_api
         AND ix.field_api=fv.field_api AND ix.record_id=fv.record_id
         AND ix.value_hash=md5(${valueParameter}))`:'';
    return `EXISTS(SELECT 1 FROM md_record_values fv WHERE fv.tenant_id=r.tenant_id
      AND fv.record_id=r.id AND fv.object_api=r.object_api AND fv.field_api=${fieldParameter}
      AND ${comparison}${exactIndex})`;
  });
  const expression = parseFilterLogic(logic, filters.length);
  const predicate = expression.replace(/f(\d+)/g, (_, index: string) => predicates[Number(index)]);
  return { predicate, parameters };
}
