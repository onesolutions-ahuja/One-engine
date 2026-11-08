import {resolveComponentSettings} from '../../components/Properties/componentSettingDefinitions';
import type { LightningPageMetadata, LibraryComponentMetadata } from '../../metadata/Definitions/metadata';

export type PageToolbarAction = { componentId: string; event: string; label: string };

/**
 * The page toolbar is driven by registered component property metadata, not
 * special cases for individual apps. Components opt in with these properties:
 * topbarActionEvent, topbarActionLabelProperty, topbarActionRequiresProperty.
 */
export function resolvePageToolbarActions(
  page: LightningPageMetadata | null,
  library: readonly LibraryComponentMetadata[]
): PageToolbarAction[] {
  if (!page) return [];
  const registered = new Map(library.map(definition => [definition.apiName, definition]));
  return page.components.flatMap(component => {
    if (component.visible === false || !component.type.startsWith('Custom:')) return [];
    const definition = registered.get(component.type.slice('Custom:'.length));
    if (!definition) return [];
    const properties = resolveComponentSettings(definition.propertyDefinitions??[],component.properties);
    const event = String(properties.topbarActionEvent ?? '').trim();
    const labelProperty = String(properties.topbarActionLabelProperty ?? '').trim();
    const requiredProperty = String(properties.topbarActionRequiresProperty ?? '').trim();
    if (!event || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(event) ||
      (requiredProperty && !String(properties[requiredProperty] ?? '').trim())) return [];
    const label = String((labelProperty && properties[labelProperty]) || properties.topbarActionLabel || component.label || event).trim();
    return label ? [{componentId: component.id, event, label}] : [];
  });
}
