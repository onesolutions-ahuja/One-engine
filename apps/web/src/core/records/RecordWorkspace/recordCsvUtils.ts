import type { ObjectMetadata } from '../../metadata/Definitions/metadata';

export function formatRecordValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    if (!Array.isArray(value) && value !== null && 'latitude' in value && 'longitude' in value) {
      return `${String(value.latitude)}, ${String(value.longitude)}`;
    }
    if (!Array.isArray(value) && 'street' in value && 'city' in value) {
      return ['street', 'city', 'state', 'postalCode', 'country']
        .map((key) => (value as Record<string, unknown>)[key])
        .filter((part) => typeof part === 'string' && part.length > 0)
        .join(', ') || '—';
    }
    return JSON.stringify(value) ?? String(value);
  }
  return String(value);
}

export function parseCsvImport(text: string, object: ObjectMetadata): Array<Record<string, unknown>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell === '') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted value.');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('The CSV must include a header row and at least one record.');
  if (rows.length > 201) throw new Error('CSV imports are limited to 200 records per transaction.');
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  if (headers.some((header) => !header)) throw new Error('CSV column headers cannot be blank.');
  if (new Set(headers.map((header) => header.toLocaleLowerCase())).size !== headers.length) {
    throw new Error('CSV column headers must be unique.');
  }
  const fieldByHeader = new Map(object.fields.flatMap((field) => [
    [field.apiName.toLocaleLowerCase(), field.apiName],
    [field.label.toLocaleLowerCase(), field.apiName]
  ]));
  const fieldNames = headers.map((header) => fieldByHeader.get(header.toLocaleLowerCase()));
  const unknownHeader = headers.find((header) => !fieldByHeader.has(header.toLocaleLowerCase()) && !['recordtypeid','id'].includes(header.toLocaleLowerCase()));
  if (unknownHeader) throw new Error(`CSV column "${unknownHeader}" does not match a field API name or label on ${object.label}.`);
  const mappedNames = headers.map((header, index) => header.toLocaleLowerCase() === 'recordtypeid' ? 'RecordTypeId'
    : header.toLocaleLowerCase() === 'id' ? 'Id' : fieldNames[index]!);
  if (new Set(mappedNames).size !== mappedNames.length) {
    throw new Error('CSV headers map more than once to the same field; remove duplicate label/API name columns.');
  }
  const definitions = new Map(object.fields.map((field) => [field.apiName, field]));
  const convert = (value: string, fieldName: string, rowNumber: number): unknown => {
    const trimmed = value.trim(), type = definitions.get(fieldName)?.dataType?.toLowerCase();
    if (fieldName === 'Id') {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed))
        throw new Error(`CSV row ${rowNumber} has an invalid record ID.`);
      return trimmed;
    }
    if (fieldName === 'RecordTypeId') return trimmed;
    if (!trimmed && ['boolean', 'number', 'currency', 'percent'].includes(type ?? '')) return null;
    if (type === 'boolean') {
      if (trimmed.toLowerCase() === 'true') return true;
      if (trimmed.toLowerCase() === 'false') return false;
      throw new Error(`CSV row ${rowNumber}: ${fieldName} must be true or false.`);
    }
    if (['number', 'currency', 'percent'].includes(type ?? '')) {
      if (!trimmed || !Number.isFinite(Number(trimmed)))
        throw new Error(`CSV row ${rowNumber}: ${fieldName} must be a finite number.`);
      return Number(trimmed);
    }
    return value;
  };
  const parsed = rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} values; expected ${headers.length}.`);
    return Object.fromEntries(values.map((value, columnIndex) =>
      [mappedNames[columnIndex], convert(value, mappedNames[columnIndex], index + 2)]));
  });
  if (mappedNames.includes('Id')) {
    const ids = parsed.map((record) => String(record.Id).toLowerCase());
    if (new Set(ids).size !== ids.length) throw new Error('CSV contains duplicate record IDs.');
  }
  return parsed;
}
