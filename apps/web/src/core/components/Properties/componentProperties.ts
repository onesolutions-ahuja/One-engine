export type ComponentPropertyValues = Record<string, unknown>;
export type ComponentPropertyKind = 'text' | 'number' | 'boolean';

const reservedNames = new Set([
  '__proto__', 'prototype', 'constructor', 'key', 'ref', 'children',
  'onAction', 'onChange', 'onNavigate', 'onLaunchFlow',
  'properties', 'records', 'objects', 'flows', 'filters', 'sessionId'
]);

export function validateComponentPropertyName(name: string, existing: ComponentPropertyValues = {}): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return 'Use a letter followed by letters, digits or underscores.';
  if (reservedNames.has(name)) return 'This property is reserved for the component host.';
  if (Object.prototype.hasOwnProperty.call(existing, name)) return 'This property already exists.';
  return '';
}

export function parseComponentProperties(raw: unknown): { properties: ComponentPropertyValues; error: string } {
  if (raw === undefined || raw === null || raw === '') return { properties: {}, error: '' };
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { properties: {}, error: 'The stored component properties are invalid JSON. Repair them before editing.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { properties: {}, error: 'Component properties must be a plain object.' };
  }
  if (Object.keys(parsed).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) {
    return { properties: {}, error: 'Component properties contain a forbidden key.' };
  }
  return { properties: parsed as ComponentPropertyValues, error: '' };
}

export function addComponentProperty(
  properties: ComponentPropertyValues,
  name: string,
  kind: ComponentPropertyKind
): ComponentPropertyValues {
  const error = validateComponentPropertyName(name, properties);
  if (error) throw new Error(error);
  return { ...properties, [name]: kind === 'boolean' ? false : kind === 'number' ? 0 : '' };
}

export function displayComponentPropertyName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}
