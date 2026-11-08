import type { LibraryComponentMetadata } from '../../metadata/Definitions/metadata';

export type SqlRegisteredComponent = {
  apiName:string;
  rendererKey:string;
};

/** Only SQL-enabled, explicitly bundled definitions acquire trusted runtime assets.
 * The lightweight index is loaded after authentication, not during public startup. */
export async function resolveSqlComponentLibrary(
  registered: readonly SqlRegisteredComponent[],
  baseUrl: string = import.meta.env.BASE_URL
): Promise<LibraryComponentMetadata[]> {
  const authorised = registered.filter(item => item.apiName.startsWith('smart_') && item.rendererKey === 'smart-bundled:' + item.apiName);
  if (!authorised.length) return [];
  const response = await fetch(`${baseUrl}component-library/catalog-index.json`,{cache:'no-cache'});
  if (!response.ok) throw Error('Bundled component index unavailable');
  const payload:unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('components' in payload) ||
    !Array.isArray(payload.components)) throw Error('Invalid bundled component index');
  const indexed = new Map<string, LibraryComponentMetadata>();
  for (const raw of payload.components) {
    if (!raw || typeof raw.apiName !== 'string' || !Array.isArray(raw.surfaces) ||
      typeof raw.version !== 'number') continue;
    indexed.set(raw.apiName, {
      ...raw, description:raw.description ?? '', jsxSource:'',cssSource:'',
      compiledJs:'',scopedCss:'',updatedAt:'',status:'Published',
      trustedBundled:true
    } as LibraryComponentMetadata);
  }
  // Older tenants can retain SQL registrations for components removed from the
  // reviewed release. Their metadata must not prevent unrelated pages or Setup
  // from loading. Never promote an unreviewed SQL key to an executable component.
  const resolved: LibraryComponentMetadata[] = [];
  let unavailable = 0;
  for (const item of authorised) {
    const definition = indexed.get(item.apiName);
    if (!definition) { unavailable++; continue; }
    resolved.push(definition);
  }
  if (unavailable) console.warn('Ignoring unavailable Smart component registrations:',unavailable);
  return resolved;
}
