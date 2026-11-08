import type { LibraryComponentMetadata } from '../../metadata/Definitions/metadata';

export const oneLibraryName = 'One-';

/** Display names can change without invalidating persisted API references. */
export function oneComponentLabel(component: Pick<LibraryComponentMetadata, 'label' | 'apiName'>): string {
  const label = component.label.trim() || component.apiName;
  return `One-${label.replace(/^One(?:[-\s]+|(?=[A-Z]))/, '')}`;
}

export function registeredComponentDefinitions(
  components: readonly LibraryComponentMetadata[],
  surface?: LibraryComponentMetadata['surfaces'][number]
): LibraryComponentMetadata[] {
  const definitions = new Map<string, LibraryComponentMetadata>();
  for (const component of components) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(component.apiName) ||
        (surface && (component.status === 'Draft' || !component.surfaces?.includes(surface)))) continue;
    const existing = definitions.get(component.apiName);
    // Prefer the published definition, then the newest revision of the same identity.
    if (!existing || (existing.status === 'Draft' && component.status !== 'Draft') ||
        ((existing.status === 'Draft') === (component.status === 'Draft') && component.version > existing.version)) {
      definitions.set(component.apiName, component);
    }
  }
  return [...definitions.values()];
}

export function uniqueLibraryComponents(
  components: readonly LibraryComponentMetadata[],
  surface?: LibraryComponentMetadata['surfaces'][number]
): LibraryComponentMetadata[] {
  const catalog = registeredComponentDefinitions(components, surface);
  return catalog.filter(component => {
    if (component.trustedBundled && (component.apiName.startsWith('ui_'))) return false;
    // The original eight One registrations are internal compatibility identities.
    return true;
  });
}

/** Friendly names are presentation-only. Never change stable component API names in saved pages. */
export function libraryComponentLabel(component: LibraryComponentMetadata): string {
  if (component.apiName.startsWith('smart_')) return component.label.replace(/^Smart\s+/, '');
  if (component.apiName.startsWith('ui_')) {
    const raw = component.label.replace(/^\s*(?:UNE|One)[\s_-]*/i, '').trim();
    return raw || component.apiName.slice(4).split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
  return component.scope === 'platform-system' ? component.label : oneComponentLabel(component);
}
