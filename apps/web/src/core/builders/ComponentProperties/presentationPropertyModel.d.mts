export type PresentationDefinition = {
  propertyKey: string;
  label?: string;
  kind: string;
  defaultValue?: unknown;
  choices?: ReadonlyArray<{key: string; label: string}>;
};
export function isPresentationProperty(definition: PresentationDefinition): boolean;
export function presentationSection(definition: PresentationDefinition): 'Content' | 'Layout' | 'Responsive' | 'Appearance';
export function groupedPresentationProperties<T extends PresentationDefinition>(definitions?: readonly T[]): Array<{section: 'Content' | 'Layout' | 'Responsive' | 'Appearance'; definitions: T[]}>;
export function presentationValue(properties: Record<string, unknown>, definition: PresentationDefinition): unknown;
