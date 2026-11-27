import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';
import {childrenOf, isLayoutContainer, multiPageKey, multiPageTabId, rawLayoutParentId} from '../../pages/TemplatePageRuntime/pageComponentLayout';

/**
 * Page Builder rules for Smart MultiPage (any app). Each direct child of a MultiPage is one
 * tab (page). In the designer a tab is opened by clicking it; the open tab is remembered per
 * MultiPage, new components go INTO the open tab, and "+" adds a new tab.
 */
export const MULTIPAGE_TYPE = 'Custom:smart_multipage';
type Components = PageComponentMetadata[];
const isMultiPage = (component: PageComponentMetadata | undefined) => component?.type === MULTIPAGE_TYPE;

/** Tabs (pages) of a MultiPage, in tab order. */
export function multiPageTabs(components: Components, multiPageId: string): Components {
  return childrenOf(components, multiPageId);
}

/** The tab shown in the designer: the tab holding the selection, else the remembered tab, else the first. */
export function openMultiPageTab(components: Components, multiPageId: string,
  selectedId?: string | null, rememberedId?: string): PageComponentMetadata | undefined {
  const tabs = multiPageTabs(components, multiPageId);
  if (!tabs.length) return undefined;
  const byId = new Map(components.map(item => [item.id, item]));
  const seen = new Set<string>();
  let cursor = selectedId ? byId.get(selectedId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const parentId = rawLayoutParentId(cursor);
    if (parentId === multiPageId) return tabs.find(tab => tab.id === cursor!.id);
    cursor = parentId ? byId.get(parentId) : undefined;
  }
  return tabs.find(tab => tab.id === rememberedId) ?? tabs[0];
}

/** For every MultiPage around the selection: the tab that holds it (so it stays open later). */
export function multiPageTabsHolding(components: Components, selectedId?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  const byId = new Map(components.map(item => [item.id, item]));
  const seen = new Set<string>();
  let cursor = selectedId ? byId.get(selectedId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const parentId = rawLayoutParentId(cursor);
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && isMultiPage(parent)) out[parent.id] = cursor.id;
    cursor = parent;
  }
  return out;
}

/** Where an inserted component goes: inserting "into" a MultiPage puts it inside the open
 * tab (when that tab is a container); only "Add tab" makes a new tab. */
export function multiPageInsertParent(components: Components, parentId: string | null,
  remembered: Readonly<Record<string, string>>, asNewTab = false): string | null {
  if (!parentId || asNewTab) return parentId;
  const parent = components.find(item => item.id === parentId);
  if (!isMultiPage(parent)) return parentId;
  const open = openMultiPageTab(components, parentId, null, remembered[parentId]);
  return open && isLayoutContainer(open) ? open.id : parentId;
}

/** The MultiPage the selection is (or sits inside): its tabs show in the MultiPage bar. */
export function selectedMultiPage(components: readonly PageComponentMetadata[], selectedId?: string | null): PageComponentMetadata | undefined {
  const byId = new Map(components.map(item => [item.id, item]));
  const seen = new Set<string>();
  for (let item = selectedId ? byId.get(selectedId) : undefined; item && !seen.has(item.id); item = byId.get(rawLayoutParentId(item) ?? '')) {
    seen.add(item.id);
    if (isMultiPage(item)) return item;
  }
  return undefined;
}

/** "Page 1", "Page 2"... not used by another tab of this MultiPage (case-insensitive). */
export function nextTabName(components: Components, multiPageId: string): string {
  const used = new Set(multiPageTabs(components, multiPageId)
    .flatMap(tab => [tab.label, multiPageKey(tab)]).map(name => name.trim().toLowerCase()));
  for (let n = used.size + 1; ; n++) if (!used.has(`page ${n}`)) return `Page ${n}`;
}

/** Id for a new tab: one more than any tab has had (deleted ids are not reused). */
export function nextTabId(components: Components, multiPageId: string): number {
  const tabs = multiPageTabs(components, multiPageId);
  const used = tabs.map(tab => multiPageTabId(tab, tabs));
  const kept = Number(components.find(item => item.id === multiPageId)?.properties?.multiPageNextTab);
  return Math.max(tabs.length, ...used.map(id => id + 1), Number.isInteger(kept) ? kept : 0);
}

/** Every tab of the MultiPage with its id written down, so moving tabs keeps their ids. */
export function stampTabIds(components: Components, multiPageId: string): Components {
  const tabs = multiPageTabs(components, multiPageId);
  const ids = new Map(tabs.map(tab => [tab.id, multiPageTabId(tab, tabs)]));
  if (tabs.every(tab => tab.properties?.pageIndex === ids.get(tab.id))) return components;
  return components.map(item => ids.has(item.id) && item.properties?.pageIndex !== ids.get(item.id)
    ? {...item, properties: {...item.properties, pageIndex: ids.get(item.id)}} : item);
}

/** Write down the ids of every MultiPage's tabs (before a delete, cut or new tab changes positions). */
export function stampAllTabIds(components: Components): Components {
  return components.filter(isMultiPage).reduce((list, multiPage) => stampTabIds(list, multiPage.id), components);
}

/** After a delete: the tabs left keep the ids they had before it (not their new positions). */
export function keepTabIds(before: Components, after: Components): Components {
  const stamped = new Map(stampAllTabIds(before).map(item => [item.id, item.properties?.pageIndex]));
  return after.map(item => {
    const id = stamped.get(item.id);
    return id === undefined || item.properties?.pageIndex === id ? item : {...item, properties: {...item.properties, pageIndex: id}};
  });
}

/** Rename a tab. Its key follows its name unless a formula already uses the old key: then the
 * old key is kept as the tab's "Page key" so Visible/Active tab formulas keep working. */
export function renameMultiPageTab(components: Components, tabId: string, name: string):
  {components: Components; error?: string} {
  const tab = components.find(item => item.id === tabId);
  const parentId = tab ? rawLayoutParentId(tab) : null;
  const clean = name.trim();
  if (!tab || !parentId || !isMultiPage(components.find(item => item.id === parentId)))
    return {components, error: 'Select a tab to rename'};
  if (!clean) return {components, error: 'A tab needs a name'};
  const clash = multiPageTabs(components, parentId).some(other => other.id !== tabId
    && [other.label, multiPageKey(other)].some(value => value.trim().toLowerCase() === clean.toLowerCase()));
  if (clash) return {components, error: `Another tab is already called "${clean}"`};
  if (clean === tab.label) return {components};
  const oldKey = multiPageKey(tab);
  const hasOwnKey = typeof tab.properties?.pageKey === 'string' && tab.properties.pageKey.trim() !== '';
  const keyUsed = !hasOwnKey && components.some(item => Object.values(item.properties ?? {})
    .some(value => typeof value === 'string' && value.startsWith('=') && value.toLowerCase().includes(oldKey.toLowerCase())));
  return {components: components.map(item => item.id !== tabId ? item : {
    ...item, label: clean,
    properties: keyUsed ? {...item.properties, pageKey: oldKey} : item.properties
  })};
}

/** True when the component is a tab of a MultiPage. */
export function isMultiPageTab(components: Components, id: string): boolean {
  const item = components.find(component => component.id === id);
  const parentId = item ? rawLayoutParentId(item) : null;
  return Boolean(parentId && isMultiPage(components.find(component => component.id === parentId)));
}

/** Move a tab one place left (-1) or right (+1) among its MultiPage's tabs. */
export function moveMultiPageTab(components: Components, tabId: string, direction: -1 | 1): Components {
  const original = components.find(item => item.id === tabId);
  const parentId = original ? rawLayoutParentId(original) : null;
  if (!original || !parentId) return components;
  // Ids stay with their tabs: write them down before the order changes.
  components = stampTabIds(components, parentId);
  const tab = components.find(item => item.id === tabId)!;
  const tabs = multiPageTabs(components, parentId);
  const other = tabs[tabs.findIndex(item => item.id === tabId) + direction];
  if (!other) return components;
  const from = components.indexOf(tab), to = components.indexOf(other);
  const next = [...components];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
