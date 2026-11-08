import {appearanceNumberFields,appearanceColorFields,appearanceChoiceFields,responsiveNumberFields,responsiveOptionFields,responsiveColorFields,responsiveSettingKeys} from '../../metadata/Definitions/metadataAppearanceSchema';
import type { CSSProperties } from 'react';
import type { PageComponentMetadata } from '../../metadata/Definitions/metadata';

export const layoutTypes = ['Container', 'Row', 'Column', 'Card', 'Grid'] as const;
export type LayoutType = typeof layoutTypes[number];
export const isLayoutType = (type: string): type is LayoutType => layoutTypes.some((value) => value === type);
export type VisualProperties = {
  padding: number; margin: number; gap: number; borderWidth: number; borderRadius: number;
  backgroundColor: string; color: string; borderColor: string;
  align: 'start' | 'center' | 'end' | 'stretch';
  justify: 'start' | 'center' | 'end' | 'space-between';
  desktopColumns: number; tabletColumns: number; mobileColumns: number;
};
export const visualDefaults: VisualProperties = {
  padding: 12, margin: 0, gap: 12, borderWidth: 0, borderRadius: 8,
  backgroundColor: '', color: '', borderColor: '#d0d5dd',
  align: 'stretch', justify: 'start', desktopColumns: 3, tabletColumns: 2, mobileColumns: 1
};
const colorPattern = /^(?:#[0-9a-f]{3,8}|transparent|[a-z]+)$/i;
export function normalizeVisualProperties(input: unknown): VisualProperties {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const result = { ...visualDefaults };
  for (const {key,min,max} of appearanceNumberFields) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate))
      result[key] = Math.max(min,Math.min(max,Math.round(candidate)));
  }
  for (const {key} of appearanceColorFields) {
    if (typeof value[key] === 'string' && (value[key] === '' || colorPattern.test(value[key] as string)))
      result[key] = value[key] as string;
  }
  for (const {key,options} of appearanceChoiceFields) {
    if ((options as readonly string[]).includes(String(value[key])))
      (result as unknown as Record<string,unknown>)[key] = value[key];
  }
  return result;
}
export function componentVisualStyle(visual: unknown, type: string, viewport: 'Desktop' | 'Tablet' | 'Phone' = 'Desktop'): CSSProperties {
  const v = normalizeVisualProperties(visual);
  const layout = isLayoutType(type);
  const cols = viewport === 'Phone' ? v.mobileColumns : viewport === 'Tablet' ? v.tabletColumns : v.desktopColumns;
  return {
    padding: v.padding, margin: v.margin, gap: layout ? v.gap : undefined,
    borderWidth: v.borderWidth, borderStyle: v.borderWidth ? 'solid' : undefined, borderColor: v.borderColor,
    borderRadius: v.borderRadius, backgroundColor: v.backgroundColor || undefined, color: v.color || undefined,
    ...(layout ? { display: type === 'Grid' ? 'grid' : 'flex',
      flexDirection: type === 'Row' ? 'row' : 'column',
      flexWrap: type === 'Row' ? 'wrap' : undefined,
      gridTemplateColumns: type === 'Grid' ? `repeat(${cols}, minmax(0, 1fr))` : undefined,
      alignItems: v.align === 'start' ? 'flex-start' : v.align === 'end' ? 'flex-end' : v.align,
      justifyContent: v.justify === 'start' ? 'flex-start' : v.justify === 'end' ? 'flex-end' : v.justify,
      minHeight: 64, minWidth: 0 } : {})
  };
}
/**
 * Unified component appearance resolver.
 * `visualStyle` is the original Page Builder metadata; `layoutStyle` and
 * `layoutResponsive` are its newer, per-device overrides. Preserve both so
 * pages created before this change continue to render unchanged.
 *
 * Generic custom components start unstyled unless their author actually
 * configures appearance. Layout primitives retain their existing defaults.
 */
/** Do not add new wrapper DOM for existing unstyled standard pages. */
export function hasPageComponentAppearance(properties: Record<string, unknown>): boolean {
  return properties.visualStyle !== undefined
    || properties.layoutStyle !== undefined
    || properties.layoutResponsive !== undefined;
}

/**
 * The canvas frame is only geometry/selection. For non-layout components
 * appearance belongs to the rendered control, text, image or surface.
 * CSS custom properties safely cross the registered-component boundary,
 * including its loading and preview wrappers.
 */

/** Semantic targets keep geometry-only wrappers invisible while applying
 * appearance to the actual visible control/surface in both builder and runtime.
 * Collections style their individual items, never a second enclosing card. */
export type PageAppearanceTarget =
  | 'input' | 'toggle' | 'button' | 'badge' | 'text' | 'image'
  | 'surface' | 'collection' | 'table' | 'calendar' | 'progress'
  | 'layout' | 'tabs' | 'conversation' | 'cart' | 'form' | 'overlay';
const specificPageTargets: Record<string, PageAppearanceTarget> = {
  smartbutton:'button',smarttoggle:'toggle',smartlookup:'input',
  smarttabs:'tabs',smarttext:'input',smartcardgrid:'collection',
  smartimage:'image',smartcalendar:'calendar',smartnavigation:'button',
  smartcontainer:'layout',
  oneitemgrid:'collection', unerepeater:'collection', unerecordlist:'collection',
  uneitemgrid:'collection', uneoptiongroups:'collection',
  unetable:'table', unelineitems:'table', reportchart:'surface',
  onecalendar:'calendar', unecalendar:'calendar',
  oneconversation:'conversation', uneconversation:'conversation',
  oneshoppingcart:'cart', unecart:'cart',
  unetoggle:'toggle',
  uneform:'form',
  unestack:'layout', unecontainer:'layout', unegrid:'layout', unesplitpane:'layout',
  unetabs:'tabs', tabs:'tabs',
  unemodal:'overlay', unedrawer:'overlay',
  uneprogress:'progress'
};
export function pageAppearanceTarget(type: string): PageAppearanceTarget {
  if (isLayoutType(type)) return 'layout';
  const name = type.replace(/^Custom:/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  // Private application identities keep the same native appearance targets as their
  // former UNE renderers; only the app owns the component, not its styling engine.
  const canonicalLegacy = name.startsWith('ui') ? 'une'+name.slice(2) : name;
  const legacyName = canonicalLegacy.replace(/^(?:onechatter|uneacechatter)/,'une');
  if (specificPageTargets[name] || specificPageTargets[canonicalLegacy] || specificPageTargets[legacyName])
    return specificPageTargets[name] ?? specificPageTargets[canonicalLegacy] ?? specificPageTargets[legacyName];
  if (/search|input|lookup|date.?picker|select|dropdown|choice|checkbox|radio|slider|slot.?picker/.test(name)) return 'input';
  if (/button|navigation|menu|link|action/.test(name)) return 'button';
  if (/badge|chip|tag/.test(name)) return 'badge';
  if (/image|picture|avatar|logo/.test(name)) return 'image';
  if (/progress|loadingbar/.test(name)) return 'progress';
  if (/text|heading|paragraph|label/.test(name)) return 'text';
  if (/chart|table/.test(name)) return 'table';
  return 'surface';
}

/** An authored appearance value is independent: setting a 64px radius does
 * not create padding, background or an editor-frame border. */
const pageStyleFlags: Record<string, string> = {
  '--md-page-radius':'radius',
  '--md-page-padding':'padding',
  '--md-page-border-width':'border',
  '--md-page-border-color':'stroke',
  '--md-page-background':'background',
  '--md-page-color':'color',
  '--md-page-shadow':'shadow',
  '--md-page-font-size':'font-size',
  '--md-page-line-height':'line-height',
  '--md-page-letter-spacing':'letter-spacing',
  '--md-page-font-family':'font-family',
  '--md-page-font-weight':'font-weight',
  '--md-page-font-style':'font-style',
  '--md-page-text-decoration':'text-decoration',
  '--md-page-text-align':'text-align',
  '--md-page-opacity':'opacity',
  '--md-page-gap':'gap',
  '--md-page-align-items':'align-items',
  '--md-page-justify-content':'justify-content',
  '--md-page-overflow':'overflow'
};
export function pageAppearanceStyleKeys(style: CSSProperties): string {
  return Object.entries(pageStyleFlags)
    .filter(([key]) => (style as unknown as Record<string, unknown>)[key] !== undefined)
    .map(([,name]) => name).join(' ');
}

export function resolvePageComponentStyle(
  properties: Record<string, unknown>,
  type: string,
  device: LayoutDevice = 'Desktop'
): CSSProperties {
  const authored = properties.visualStyle && typeof properties.visualStyle === 'object'
    && !Array.isArray(properties.visualStyle)
    ? properties.visualStyle as Record<string, unknown> : {};
  const values = normalizeVisualProperties(authored);
  // Pre-existing editor saves may include a complete normalized snapshot.
  // Do not turn those defaults into newly visible decorative component shells.
  const oldSnapshot = Object.keys(visualDefaults).every(key => authored[key] !== undefined);
  const visual: CSSProperties = {};
  if (isLayoutType(type)) Object.assign(visual, componentVisualStyle(properties.visualStyle, type, device));
  else {
    const keys = ['padding','margin','borderWidth','borderRadius','backgroundColor','borderColor','color'] as const;
    for (const key of keys) {
      if (authored[key] === undefined || authored[key] === '') continue;
      if (oldSnapshot && authored[key] === visualDefaults[key]) continue;
      (visual as unknown as Record<string, unknown>)[key] = values[key];
    }
  }
  const configured: CSSProperties = {};
  // Native/common component settings are also visual controls. Resolve their
  // *authored* values here instead of styling the RegisteredComponent host.
  // No implicit manifest defaults are introduced into the page metadata.
  if (!isLayoutType(type)) {
    const number = (key: string, min: number, max: number): number | undefined => {
      const value = properties[key];
      return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
        ? value : undefined;
    };
    const colour = (key: string): string | undefined => {
      const value = properties[key];
      return typeof value === 'string' && colorPattern.test(value) ? value : undefined;
    };
    configured.padding = number('padding',0,128);
    configured.borderRadius = number('radius',0,128);
    configured.borderWidth = number('borderWidth',0,24);
    configured.borderColor = colour('borderColor');
    configured.backgroundColor = colour('backgroundColor');
    configured.color = colour('textColor');
    configured.margin = number('margin',0,160);
    configured.fontSize = number('fontSize',8,96);
    // Support both CSS multipliers (1.5) and familiar percent entry (150).
    const authoredLineHeight=number('lineHeight',0.5,300);
    if(authoredLineHeight!==undefined)configured.lineHeight=authoredLineHeight>10?authoredLineHeight/100:authoredLineHeight;
    const authoredLetterSpacing=number('letterSpacing',-10,40);
    if(authoredLetterSpacing!==undefined)configured.letterSpacing=authoredLetterSpacing+'px';
    const families:Record<string,string>={system:'system-ui, sans-serif',sans:'Arial, Helvetica, sans-serif',serif:'Georgia, serif',mono:'Consolas, monospace'};
    const family=String(properties.fontFamily??'');
    if(families[family])configured.fontFamily=families[family];
    configured.gap = number('gap',0,160);
    const opacityValue = number('opacity',0,100);
    if (opacityValue !== undefined) configured.opacity = opacityValue / 100;
    const weight = String(properties.fontWeight ?? '');
    if (['400','500','600','700','800'].includes(weight))
      configured.fontWeight = Number(weight);
    const align = String(properties.textAlign ?? '');
    if (['left','center','right','start','end'].includes(align))
      configured.textAlign = align as CSSProperties['textAlign'];
    const namedShadow = String(properties.shadow ?? '');
    const shadows: Record<string,string> = {
      none:'none',small:'0 1px 3px rgba(15,23,42,.12)',
      medium:'0 4px 12px rgba(15,23,42,.14)',
      large:'0 10px 24px rgba(15,23,42,.17)'
    };
    if (shadows[namedShadow]) configured.boxShadow = shadows[namedShadow];
  }
  const style = { ...configured, ...visual, ...resolveLayoutStyle(properties, device) };
  // Non-destructive per-layout offsets: preserve responsive document flow while
  // allowing the author to freely move and rotate individual components.
  const placement = properties.templatePlacement;
  if (placement && typeof placement === 'object' && !Array.isArray(placement)) {
    const values = placement as Record<string, unknown>;
    const bounded = (value: unknown, bound: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.max(-bound, Math.min(bound, value)) : 0;
    const x = bounded(values.x, 10000), y = bounded(values.y, 10000);
    const rotation = bounded(values.rotation, 360);
    if (x || y || rotation) {
      style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
      style.transformOrigin = 'center center';
      style.position = 'relative';
    }
  }
  if (isLayoutType(type)) return style;
  // Position, dimensions, external margin and visibility belong to the frame.
  // All visible appearance properties belong to the component itself.
  const { padding, borderRadius, borderWidth, borderColor, backgroundColor,
    boxShadow, color, borderStyle, fontSize, fontWeight, fontStyle, textDecoration, textAlign,
    lineHeight, letterSpacing, fontFamily, opacity,
    gap, alignItems, justifyContent, overflowY, ...frame } = style;
  const tokens: Record<string, string> = {};
  const put = (key: string, value: unknown, unit = '') => {
    if (value !== undefined && value !== '') tokens[key] = String(value) + unit;
  };
  put('--md-page-padding',padding,'px');
  put('--md-page-radius',borderRadius,'px');
  put('--md-page-border-width',borderWidth,'px');
  put('--md-page-border-color',borderColor);
  put('--md-page-background',backgroundColor);
  put('--md-page-color',color);
  put('--md-page-shadow',boxShadow);
  put('--md-page-font-size',fontSize,'px');
  put('--md-page-line-height',lineHeight);
  put('--md-page-letter-spacing',letterSpacing);
  put('--md-page-font-family',fontFamily);
  put('--md-page-font-weight',fontWeight);
  put('--md-page-font-style',fontStyle);
  put('--md-page-text-decoration',textDecoration);
  put('--md-page-text-align',textAlign);
  put('--md-page-opacity',opacity);
  put('--md-page-gap',gap,'px');
  put('--md-page-align-items',alignItems);
  put('--md-page-justify-content',justifyContent);
  put('--md-page-overflow',overflowY);
  return { ...frame, ...tokens } as CSSProperties;
}

/** Compatibility API for legacy page components. Use the same cycle checker
 * as responsive layouts, while retaining the legacy built-in-parent restriction.
 */
export function canNestComponent(components: PageComponentMetadata[], childId: string, parentId: string): boolean {
  const parent = components.find(item=>item.id===parentId);
  return Boolean(parent && isLayoutContainer(parent) && canNest(components,childId,parentId));
}
export function directChildren(components: PageComponentMetadata[], parentId?: string): PageComponentMetadata[] {
  return components.filter((component) => (component.parentId || undefined) === parentId);
}

export function isDescendantOf(components: PageComponentMetadata[], childId: string, ancestorId: string): boolean {
  const visited = new Set<string>();
  const byId = new Map(components.map(item=>[item.id,item]));
  let cursor = byId.get(childId);
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    const parentId = rawLayoutParentId(cursor);
    if (!parentId) return false;
    if (parentId === ancestorId) return true;
    cursor = byId.get(parentId);
  }
  return false;
}

export type LayoutDevice = 'Desktop' | 'Tablet' | 'Phone';
export type LayoutSettingKey = 'width' | 'height' | 'padding' | 'margin' | 'backgroundColor' | 'borderColor'
  | 'borderWidth' | 'borderRadius' | 'alignItems' | 'justifyContent' | 'gap' | 'opacity' | 'hidden'
  | 'fontSize' | 'fontWeight' | 'fontStyle' | 'textDecoration' | 'textAlign' | 'boxShadow'
  | 'position' | 'top' | 'bottom' | 'left' | 'right' | 'zIndex' | 'overflowY';
export type LayoutSettings = Partial<Record<LayoutSettingKey, string | number | boolean>>;
export const layoutContainerTypes = new Set(['Container', 'Row', 'Column', 'Card', 'Grid', 'Tabs', 'Accordion']);

export function isLayoutContainer(component: PageComponentMetadata): boolean {
  return layoutContainerTypes.has(component.type)
    || component.type==='Custom:ui_container'
    // Smart Container is a shared layout primitive. Older saved instances have no
    // layoutContainer flag, so recognise them without rewriting tenant metadata.
    || (component.type==='Custom:smart_container' && component.properties?.layoutContainer !== false)
    || (component.type.startsWith('Custom:') && component.properties?.layoutContainer === true);
}
export function rawLayoutParentId(component: PageComponentMetadata): string | null {
  return typeof component.properties?.layoutParentId === 'string' && component.properties.layoutParentId
    ? component.properties.layoutParentId : (component.parentId || null);
}

function validParentId(components: PageComponentMetadata[], component: PageComponentMetadata): string | null {
  const parentId = rawLayoutParentId(component);
  if (!parentId) return null;
  const byId = new Map(components.map((item) => [item.id, item]));
  const visited = new Set([component.id]);
  let currentId: string | null = parentId;
  while (currentId) {
    if (visited.has(currentId)) return null;
    visited.add(currentId);
    const parent = byId.get(currentId);
    if (!parent || !isLayoutContainer(parent)) return null;
    currentId = rawLayoutParentId(parent);
  }
  return parentId;
}

export function childrenOf(
  components: PageComponentMetadata[],
  parentId: string | null
): PageComponentMetadata[] {
  return components.filter((item) => validParentId(components, item) === parentId);
}

export function canNest(
  components: PageComponentMetadata[],
  movingId: string,
  newParentId: string | null
): boolean {
  if (newParentId === null) return true;
  const parent = components.find((item) => item.id === newParentId);
  if (!parent || !isLayoutContainer(parent) || newParentId === movingId) return false;
  const visited = new Set([movingId]);
  let next: string | null = newParentId;
  while (next) {
    if (visited.has(next)) return false;
    visited.add(next);
    const item = components.find((candidate) => candidate.id === next);
    next = item ? rawLayoutParentId(item) : null;
  }
  return true;
}

export function reparentComponent(
  components: PageComponentMetadata[],
  movingId: string,
  parentId: string | null
): PageComponentMetadata[] {
  if (!components.some((item) => item.id === movingId) || !canNest(components, movingId, parentId))
    return components;
  return components.map((item) => {
    if (item.id !== movingId) return item;
    const properties = { ...item.properties };
    if (parentId) properties.layoutParentId = parentId;
    else delete properties.layoutParentId;
    return { ...item, parentId: parentId || undefined, properties };
  });
}

const settingsKeys: readonly LayoutSettingKey[] = responsiveSettingKeys;
const numberLimits: Partial<Record<LayoutSettingKey,[number,number]>> =
  Object.fromEntries(responsiveNumberFields.map(({key,min,max})=>[key,[min,max]]));
const supportedOptions: Partial<Record<LayoutSettingKey,readonly string[]>> =
  Object.fromEntries(responsiveOptionFields.map(({key,options})=>[key,options]));
const colorKeys = new Set<string>(responsiveColorFields.map(item=>item.key));
const safeShadows: Record<string, string> = {
  none: 'none',
  sm: '0 1px 3px rgba(15, 23, 42, .12)',
  md: '0 4px 12px rgba(15, 23, 42, .14)',
  lg: '0 10px 24px rgba(15, 23, 42, .17)'
};
const cssColorPattern = /^(transparent|#[0-9a-f]{3}(?:[0-9a-f]{3})?|rgba?\([0-9.,\s%]+\))$/i;

export function validateLayoutSetting(key: LayoutSettingKey, value: unknown): string {
  if (key === 'hidden') return typeof value === 'boolean' ? '' : 'Must be true or false';
  if (colorKeys.has(key)) return typeof value === 'string' && cssColorPattern.test(value)
    ? '' : 'Choose a valid hex or RGB colour';
  if (supportedOptions[key]) return typeof value === 'string' && supportedOptions[key]?.includes(value)
    ? '' : (key === 'alignItems' || key === 'justifyContent' ? 'Choose a supported alignment' : 'Choose a supported appearance value');
  const limits = numberLimits[key];
  return limits && typeof value === 'number' && Number.isFinite(value) && value >= limits[0] && value <= limits[1]
    ? '' : 'Enter a number within the allowed range';
}

export function layoutSettings(properties: Record<string, unknown>, device: LayoutDevice = 'Desktop'): LayoutSettings {
  const base = properties.layoutStyle && typeof properties.layoutStyle === 'object' && !Array.isArray(properties.layoutStyle)
    ? properties.layoutStyle as Record<string, unknown> : {};
  const responsive = properties.layoutResponsive && typeof properties.layoutResponsive === 'object' && !Array.isArray(properties.layoutResponsive)
    ? properties.layoutResponsive as Record<string, unknown> : {};
  const override = responsive[device];
  const merged = {
    ...base,
    ...(override && typeof override === 'object' && !Array.isArray(override) ? override : {})
  };
  const safe: LayoutSettings = {};
  for (const key of settingsKeys) {
    const value = merged[key];
    if (value !== undefined && !validateLayoutSetting(key, value)) {
      (safe as Record<string, unknown>)[key] = value;
    }
  }
  return safe;
}
export function updateLayoutSettings(
  properties: Record<string, unknown>,
  device: 'Base' | LayoutDevice,
  setting: LayoutSettingKey,
  value: string | number | boolean | null
): Record<string, unknown> {
  if (value !== null) {
    const validation = validateLayoutSetting(setting, value);
    if (validation) throw new Error(validation);
  }
  if (device === 'Base') {
    const base = { ...(properties.layoutStyle as Record<string, unknown> || {}) };
    if (value === null) delete base[setting]; else base[setting] = value;
    return { ...properties, layoutStyle: base };
  }
  const responsive = { ...(properties.layoutResponsive as Record<string, unknown> || {}) };
  const updated = { ...(responsive[device] as Record<string, unknown> || {}) };
  if (value === null) delete updated[setting]; else updated[setting] = value;
  if (Object.keys(updated).length) responsive[device] = updated; else delete responsive[device];
  return { ...properties, layoutResponsive: responsive };
}

export function componentLayoutProps(
  properties: Record<string, unknown>,
  device: LayoutDevice = 'Desktop'
): Record<string, string | number> {
  const s = layoutSettings(properties, device);
  return {
    ...(s.alignItems ? { align: String(s.alignItems) } : {}),
    ...(s.justifyContent ? { justify: String(s.justifyContent) } : {}),
    ...(s.gap !== undefined ? { gap: Number(s.gap) } : {})
  };
}

export function resolveLayoutStyle(
  properties: Record<string, unknown>,
  device: LayoutDevice = 'Desktop'
): Record<string, string | number | undefined> {
  const s = layoutSettings(properties, device);
  return {
    ...(s.width !== undefined ? { width: Number(s.width) } : {}),
    ...(s.height !== undefined ? { height: Number(s.height) } : {}),
    ...(s.padding !== undefined ? { padding: Number(s.padding) } : {}),
    ...(s.margin !== undefined ? { margin: Number(s.margin) } : {}),
    ...(s.backgroundColor ? { backgroundColor: String(s.backgroundColor) } : {}),
    ...(s.borderColor ? { borderColor: String(s.borderColor) } : {}),
    ...(s.borderWidth !== undefined ? { borderWidth: Number(s.borderWidth), borderStyle: s.borderWidth ? 'solid' : 'none' } : {}),
    ...(s.borderRadius !== undefined ? { borderRadius: Number(s.borderRadius) } : {}),
    ...(s.alignItems ? { alignItems: String(s.alignItems) } : {}),
    ...(s.justifyContent ? { justifyContent: String(s.justifyContent) } : {}),
    ...(s.gap !== undefined ? { gap: Number(s.gap) } : {}),
    ...(s.opacity !== undefined ? { opacity: Number(s.opacity) / 100 } : {}),
    ...(s.fontSize !== undefined ? { fontSize: Number(s.fontSize) } : {}),
    ...(s.fontWeight ? { fontWeight: Number(s.fontWeight) } : {}),
    ...(s.fontStyle ? { fontStyle: String(s.fontStyle) as 'normal'|'italic' } : {}),
    ...(s.textDecoration ? { textDecoration: String(s.textDecoration) } : {}),
    ...(s.textAlign ? { textAlign: String(s.textAlign) } : {}),
    ...(s.boxShadow ? { boxShadow: safeShadows[String(s.boxShadow)] } : {}),
    ...(s.position ? { position: String(s.position) } : {}),
    ...(s.top !== undefined ? { top: Number(s.top) } : {}),
    ...(s.bottom !== undefined ? { bottom: Number(s.bottom) } : {}),
    ...(s.left !== undefined ? { left: Number(s.left) } : {}),
    ...(s.right !== undefined ? { right: Number(s.right) } : {}),
    ...(s.zIndex !== undefined ? { zIndex: Number(s.zIndex) } : {}),
    ...(s.overflowY ? { overflowY: String(s.overflowY) } : {}),
    ...(s.hidden ? { display: 'none' } : {})
  };
}
