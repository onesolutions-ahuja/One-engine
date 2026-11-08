import type { FlowDefinitionMetadata, FlowResourceMetadata } from '../../metadata/Definitions/metadata';
import { jsonSampleScalarPaths } from './jsonSampleScalarPaths';

/** One-click HTTP Callout outputs for no-code builders.
 * Ticking an output declares a typed Flow Variable and wires it into the
 * existing statusVariable / responseVariable / responseMapping runtime contract,
 * so later steps can pick it with ! without creating variables by hand. */
export type HttpSampleField = { path: string; sample: string; dataType: 'Text' | 'Number' | 'Boolean' };
type Element = FlowDefinitionMetadata['elements'][number];

const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;

export function httpSampleFields(raw: string): HttpSampleField[] {
  const paths = jsonSampleScalarPaths(raw);
  if (!paths.length) return [];
  const payload = JSON.parse(raw) as unknown;
  return paths.map(path => {
    let current: unknown = payload;
    for (const token of path.match(/[A-Za-z][A-Za-z0-9_]*|\d+/g) ?? []) {
      current = current && typeof current === 'object' ? (current as Record<string, unknown>)[token] : undefined;
    }
    const dataType = typeof current === 'number' ? 'Number' : typeof current === 'boolean' ? 'Boolean' : 'Text';
    return { path, sample: current === null || current === undefined ? '' : String(current), dataType };
  });
}

export function httpResponseMapping(element: Element): Record<string, string> {
  const raw = element.config.responseMapping;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] =>
      identifier.test(entry[0]) && typeof entry[1] === 'string'));
  } catch { return {}; }
}

/** Readable, unique Flow variable name such as Get_Weather_main_temp. */
export function httpOutputName(flow: FlowDefinitionMetadata, element: Element, suffix: string): string {
  const step = (element.label || element.type).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Step';
  const tail = suffix.replace(/\[(\d+)\]/g, '_$1').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  let base = (/^[A-Za-z]/.test(step) ? step : 'Step_' + step) + (tail ? '_' + tail : '');
  base = base.slice(0, 70).replace(/_+$/, '');
  const taken = new Set(flow.resources.map(resource => resource.name.toLowerCase()));
  let name = base;
  for (let index = 2; taken.has(name.toLowerCase()); index++) name = base + '_' + index;
  return name;
}

function variable(name: string, label: string, dataType: string): FlowResourceMetadata {
  return { name, label, type: 'Variable', dataType, isCollection: false,
    availableForInput: false, availableForOutput: false };
}

function withConfig(flow: FlowDefinitionMetadata, elementId: number, patch: Record<string, unknown>,
  resources: FlowResourceMetadata[]): FlowDefinitionMetadata {
  return { ...flow, resources,
    elements: flow.elements.map(item => item.id === elementId ? { ...item, config: { ...item.config, ...patch } } : item) };
}

/** Drop an auto-declared variable once nothing else in the Flow uses it. */
function pruneUnused(flow: FlowDefinitionMetadata, name: string): FlowResourceMetadata[] {
  const text = JSON.stringify({ elements: flow.elements, resources: flow.resources.filter(item => item.name !== name) });
  const used = new RegExp('(^|[^A-Za-z0-9_])' + name + '([^A-Za-z0-9_]|$)').test(text);
  return used ? flow.resources : flow.resources.filter(item => item.name !== name);
}

export function toggleHttpStandardOutput(flow: FlowDefinitionMetadata, elementId: number,
  kind: 'status' | 'body', on: boolean): FlowDefinitionMetadata {
  const element = flow.elements.find(item => item.id === elementId);
  if (!element) return flow;
  const key = kind === 'status' ? 'statusVariable' : 'responseVariable';
  const current = typeof element.config[key] === 'string' ? String(element.config[key]) : '';
  if (!on) {
    const cleared = withConfig(flow, elementId, { [key]: '' }, flow.resources);
    return current ? { ...cleared, resources: pruneUnused(cleared, current) } : cleared;
  }
  if (current && flow.resources.some(item => item.name === current)) return flow;
  const name = httpOutputName(flow, element, kind === 'status' ? 'Status' : 'Response');
  const label = (element.label || 'HTTP Callout') + (kind === 'status' ? ' status code' : ' full response');
  return withConfig(flow, elementId, { [key]: name },
    [...flow.resources, variable(name, label, kind === 'status' ? 'Number' : 'Text')]);
}

export function toggleHttpResponseField(flow: FlowDefinitionMetadata, elementId: number,
  field: HttpSampleField, on: boolean): FlowDefinitionMetadata {
  const element = flow.elements.find(item => item.id === elementId);
  if (!element) return flow;
  const mapping = httpResponseMapping(element);
  const existing = Object.entries(mapping).find(([, path]) => path === field.path)?.[0];
  if (!on) {
    if (!existing) return flow;
    delete mapping[existing];
    const cleared = withConfig(flow, elementId, { responseMapping: JSON.stringify(mapping) }, flow.resources);
    return { ...cleared, resources: pruneUnused(cleared, existing) };
  }
  if (existing) return flow;
  if (Object.keys(mapping).length >= 50) throw new Error('An HTTP Callout can return at most 50 fields');
  const name = httpOutputName(flow, element, field.path);
  mapping[name] = field.path;
  return withConfig(flow, elementId, { responseMapping: JSON.stringify(mapping) },
    [...flow.resources, variable(name, (element.label || 'Response') + ' → ' + field.path, field.dataType)]);
}
