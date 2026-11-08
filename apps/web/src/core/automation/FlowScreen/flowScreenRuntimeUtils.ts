import type { FlowElementMetadata } from '../../metadata/Definitions/metadata';
import { resolveMentionValue } from '../../../component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';

export function initialScreenValues(screen: FlowElementMetadata): Record<string, unknown> {
  const fields = Array.isArray(screen.config.fields)
    ? screen.config.fields.filter((field): field is Record<string, unknown> =>
      typeof field === 'object' && field !== null && !Array.isArray(field)
      && !['Display Text', 'Display Image', 'Section'].includes(String(field.type)))
    : [];
  return Object.fromEntries(fields.flatMap((field, index) => {
    const name = typeof field.apiName === 'string'
      ? field.apiName
      : String(field.label ?? `Field_${index + 1}`).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (Object.hasOwn(field, 'defaultValue')) return [[name, field.defaultValue]];
    if (field.type === 'Checkbox' || field.type === 'Toggle') return [[name, false]];
    if (field.type === 'Slider') return [[name, typeof field.min === 'number' ? field.min : 0]];
    return [];
  }));
}

export function screenFieldIsVisible(field: Record<string, unknown>, values: Record<string, unknown>): boolean {
  const conditions = Array.isArray(field.visibilityConditions)
    ? field.visibilityConditions.filter((condition): condition is Record<string, unknown> =>
      typeof condition === 'object' && condition !== null && !Array.isArray(condition))
    : [];
  if (!conditions.length) return true;
  const checks = conditions.map((condition) => {
    const actual = values[String(condition.field ?? '')];
    const expected = condition.value;
    const actualNumber = comparableNumber(actual);
    const expectedNumber = comparableNumber(expected);
    const actualDate = comparableDate(actual);
    const expectedDate = comparableDate(expected);
    const comparison = actualNumber !== undefined && expectedNumber !== undefined
      ? Math.sign(actualNumber - expectedNumber)
      : actualDate !== undefined && expectedDate !== undefined
        ? Math.sign(actualDate - expectedDate)
        : undefined;
    const actualText = String(actual ?? '');
    const expectedText = String(expected ?? '');
    switch (String(condition.operator ?? 'Equals')) {
      case 'Not Equals':
      case 'Not Equal To':
      case 'Does Not Equal': return actualText !== expectedText;
      case 'Is Null': return actual === undefined || actual === null || actual === ''
        || (Array.isArray(actual) && actual.length === 0);
      case 'Is Not Null': return actual !== undefined && actual !== null && actual !== ''
        && !(Array.isArray(actual) && actual.length === 0);
      case 'Greater Than': return comparison !== undefined && comparison > 0;
      case 'Greater Than or Equal':
      case 'Greater Than or Equal To': return comparison !== undefined && comparison >= 0;
      case 'Less Than': return comparison !== undefined && comparison < 0;
      case 'Less Than or Equal':
      case 'Less Than or Equal To': return comparison !== undefined && comparison <= 0;
      case 'Contains': return typeof actual === 'string' && actual.includes(expectedText);
      case 'Does Not Contain': return typeof actual === 'string' && !actual.includes(expectedText);
      case 'Starts With': return actualText.toLocaleLowerCase().startsWith(expectedText.toLocaleLowerCase());
      case 'Includes': return Array.isArray(actual)
        ? actual.some((item) => String(item) === expectedText)
        : typeof actual === 'string' && actual.split(';').includes(expectedText);
      case 'Equals': return actualText === expectedText;
      default: return false;
    }
  });
  return String(field.visibilityLogic ?? 'All').toLowerCase() === 'any'
    ? checks.some(Boolean)
    : checks.every(Boolean);
}

function comparableNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function comparableDate(value: unknown): number | undefined {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) {
    return undefined;
  }
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1
      || calendarDate.getUTCDate() !== day) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}


/** Plain-text resource bindings for metadata-authored Screen Flow instructions. */
export function resolveScreenText(text: unknown, values: Record<string, unknown>): string {
  const merged = String(text ?? '').replace(/\{!([A-Za-z_][A-Za-z0-9_.]*)\}/g, (_match, path: string) => {
    let value: unknown = values;
    for (const key of path.split('.')) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)
          || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) return '';
      value = (value as Record<string, unknown>)[key];
    }
    return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
  });
  const records = Object.fromEntries(Object.entries(values).filter(([, value]) =>
    value && typeof value === 'object' && !Array.isArray(value))) as Record<string, Record<string, unknown>>;
  const fields = Object.fromEntries(Object.entries(records).map(([name, record]) => [name, Object.keys(record)]));
  return String(resolveMentionValue(merged, records, fields) ?? '');
}
