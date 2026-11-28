import type {LibraryComponentMetadata} from '../../metadata/Definitions/metadata';
import { registeredComponentDefinitions } from './componentLibraryDiscovery';

export type ComponentSurface = LibraryComponentMetadata['surfaces'][number];

/** Resolve published components for each metadata-defined page, dashboard or Flow surface. */
export function findRegisteredComponent(
  components: readonly LibraryComponentMetadata[],
  apiName: unknown,
  surface: ComponentSurface
): LibraryComponentMetadata | undefined {
  if (typeof apiName !== 'string' || !apiName) return undefined;
  return publishedLookup(components, surface).get(apiName);
}

// Called once per component on every canvas/runtime render; the library list is
// immutable state, so the published lookup is built once per list and surface.
type PublishedLookup = { length: number; bySurface: Map<ComponentSurface, Map<string, LibraryComponentMetadata>> };
const publishedCache = new WeakMap<readonly LibraryComponentMetadata[], PublishedLookup>();
function publishedLookup(components: readonly LibraryComponentMetadata[], surface: ComponentSurface): Map<string, LibraryComponentMetadata> {
  let entry = publishedCache.get(components);
  if (!entry || entry.length !== components.length) {
    entry = { length: components.length, bySurface: new Map() };
    publishedCache.set(components, entry);
  }
  let lookup = entry.bySurface.get(surface);
  if (!lookup) {
    lookup = new Map();
    for (const definition of registeredComponentDefinitions(components, surface)) {
      if (definition.status !== 'Draft' && definition.surfaces.includes(surface) && !lookup.has(definition.apiName))
        lookup.set(definition.apiName, definition);
    }
    entry.bySurface.set(surface, lookup);
  }
  return lookup;
}

/** Interpret saved metadata for all existing registered-component surfaces.
 * This does not authorise rendering: the published surface lookup still does. */
const savedReferenceRules = [
  {surface:'page',type:'Custom:',key:'type',prefix:true},
  {surface:'dashboard',type:'Custom',key:'customComponentApiName',prefix:false},
  {surface:'flow',type:'Custom Component',key:'componentApiName',prefix:false}
] as const;
export function componentApiNameFromMetadata(source:unknown,surface:ComponentSurface):string|undefined {
  if(!source || typeof source!=='object' || Array.isArray(source)) return undefined;
  const record=source as Record<string,unknown>;
  for(const rule of savedReferenceRules) {
    if(rule.surface!==surface) continue;
    const apiName=rule.prefix
      ? typeof record.type==='string' && record.type.startsWith(rule.type)
        ? record.type.slice(rule.type.length) : null
      : record.type===rule.type ? record[rule.key] : null;
    return typeof apiName==='string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)
      ? apiName : undefined;
  }
  return undefined;
}
export function findRegisteredComponentForInstance(
  components:readonly LibraryComponentMetadata[],instance:unknown,surface:ComponentSurface
):LibraryComponentMetadata|undefined {
  return findRegisteredComponent(components,componentApiNameFromMetadata(instance,surface),surface);
}
