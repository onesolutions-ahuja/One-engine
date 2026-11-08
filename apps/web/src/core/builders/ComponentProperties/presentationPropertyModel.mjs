/** Visual-only settings for the Page Builder's Editing tab.
 * Never treat object/field selectors, filters, events or Flow configuration as appearance.
 * Declared defaults are shown without writing them into tenant metadata until edited.
 */
const SECTIONS = ['Content', 'Layout', 'Responsive', 'Appearance'];

export function isPresentationProperty(definition) {
  if (!definition || typeof definition.propertyKey !== 'string') return false;
  const {propertyKey: key, kind} = definition;
  if (!['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'COLOR', 'IMAGE', 'CURRENCY'].includes(kind)) return false;
  if (/(?:ApiName|ObjectId|FieldId|FlowId|RecordId)$/.test(key)) return false;
  if (/^(?:action|event|on[A-Z]|flow|state|source|data|record|items|records|filter|selection|selectedRecord|selectedCategory|cartTarget|searchKey|searchField|relatedFilter|relatedField|query|operation|checkoutStatus|checkoutRequest|checkoutMessage|checkoutChange)/i.test(key)) return false;
  if (/(?:Binding|Bindings|Flow|Event|InputMap|OutputMap|Callback|Permission|SessionKey|TargetKey|FilterKey|SyncEnabled)$/.test(key)) return false;
  return true;
}

export function presentationSection(definition) {
  // Explicit metadata owns the editing journey; legacy keys retain inferred sections.
  if (definition.section === 'Design' || definition.section === 'Appearance') return 'Appearance';
  if (definition.section === 'Content' || definition.section === 'Layout' || definition.section === 'Responsive') return definition.section;
  const key = definition.propertyKey.toLowerCase();
  if (/responsive|breakpoint|mobile|tablet|desktop|phone|device|orientation/.test(key)) return 'Responsive';
  if (/layout|position|width|height|align|column|rowspan|grid|gap|padding|margin|flex|wrap|direction|span|density/.test(key)) return 'Layout';
  if (/text|label|title|description|placeholder|heading|icon|image|src|empty|badge|subtitle|price|message|option|currency|checkout|basket|store|categorytabs/.test(key)) return 'Content';
  return 'Appearance';
}

export function groupedPresentationProperties(definitions = []) {
  const entries = definitions.filter(isPresentationProperty);
  return SECTIONS.map(section => ({
    section,
    definitions: entries.filter(definition => presentationSection(definition) === section)
  })).filter(group => group.definitions.length > 0);
}

export function presentationValue(properties, definition) {
  return Object.prototype.hasOwnProperty.call(properties, definition.propertyKey)
    ? properties[definition.propertyKey]
    : definition.defaultValue;
}
