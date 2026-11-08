import { uniqueLibraryComponents } from '../../components/Registry/componentLibraryDiscovery';
import type { LibraryComponentMetadata } from '../../metadata/Definitions/metadata';

export function publishedPageLibraryComponents(components: readonly LibraryComponentMetadata[]): LibraryComponentMetadata[] {
  return uniqueLibraryComponents(components, 'page').filter(component=>!component.apiName.startsWith('ui_'));
}

/** Platform palette groups are generic. Application-specific categories belong
 * to registered component metadata, not this shared Page Builder module. */
export const pageBuilderPaletteCategories = [
  'All Components', 'Favourites', 'Recent', 'Layout', 'Display', 'Inputs',
  'Data', 'Navigation'
] as const;

export type PageBuilderPaletteCategory = (typeof pageBuilderPaletteCategories)[number];

// Reuse the same rule iterator for standard and registered component suggestions.
// Full metadata-defined category discovery is part of the shared registry migration.
const inferredCategoryRules: ReadonlyArray<{
  category: PageBuilderPaletteCategory;
  matches: RegExp;
}> = [
  { category: 'Layout', matches: /container|section|column|grid|layout|tab|accordion|split/ },
  { category: 'Inputs', matches: /form|input|checkbox|radio|select|dropdown|picker|slider|toggle/ },
  { category: 'Data', matches: /record|table|list|chart|report|dashboard|related/ },
  { category: 'Navigation', matches: /navigation|menu|top bar|bottom bar|header|footer|button|breadcrumb/ },
  { category: 'Display', matches: /text|image|card|badge|carousel|label|icon|media/ }
];

export function getPageBuilderComponentCategories(
  apiName: string,
  label: string,
  description: string,
  _standard = false,
  category?: string
): PageBuilderPaletteCategory[] {
  if(category && pageBuilderPaletteCategories.some(item=>item===category))return [category as PageBuilderPaletteCategory];
  const name = `${apiName} ${label} ${description}`.toLowerCase();
  const categories = inferredCategoryRules
    .filter(rule => rule.matches.test(name))
    .map(rule => rule.category);
  return categories.length ? categories : ['Display'];
}

export function createComponentPreviewProps(
  apiName: string,
  label: string,
  description?: string
): Record<string, unknown> {
  return {
    apiName,
    label,
    title: label,
    description: description || label,
    value: '',
    items: [],
    records: [],
    loading: false,
    disabled: true,
    preview: true,
    onAction: () => undefined,
    onChange: () => undefined,
    onNavigate: () => undefined
  };
}
