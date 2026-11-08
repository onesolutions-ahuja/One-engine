import type { PageComponentMetadata } from '../../metadata/Definitions/metadata';
import { rawLayoutParentId } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import { isCanvasLocked } from './canvasInteractions';

export type ComponentClipboard = { rootId: string; components: PageComponentMetadata[] };

/**
 * Remove all selected components in one draft edit. Locked items block the
 * entire operation (never delete only part of an intended multi-selection).
 * Surviving children of removed containers retain the closest surviving parent
 * and their canvas coordinates are translated into that parent's space.
 */
export function removePageComponentSelection(
  components: readonly PageComponentMetadata[],
  ids: readonly string[]
): { components: PageComponentMetadata[]; removed: number; locked: PageComponentMetadata[] } {
  const selected = new Set(ids);
  const targets = components.filter(item => selected.has(item.id));
  if (!targets.length) return { components: [...components], removed: 0, locked: [] };
  const locked = targets.filter(isCanvasLocked);
  if (locked.length) return { components: [...components], removed: 0, locked };
  const removed = new Set(targets.map(item => item.id));
  const originals = new Map(components.map(item => [item.id,item]));
  const survivors = components.filter(item => !removed.has(item.id)).map(item => {
    let parent = rawLayoutParentId(item);
    if (!parent || !removed.has(parent)) return item;
    let offsetX = 0, offsetY = 0;
    const traversed = new Set<string>();
    while (parent && removed.has(parent) && !traversed.has(parent)) {
      traversed.add(parent);
      const ancestor = originals.get(parent);
      if (!ancestor) { parent = null; break; }
      if (ancestor.position) {
        offsetX += ancestor.position.x;
        offsetY += ancestor.position.y;
      }
      parent = rawLayoutParentId(ancestor);
    }
    if (parent && removed.has(parent)) parent = null;
    const properties = { ...item.properties };
    if (parent) properties.layoutParentId = parent;
    else delete properties.layoutParentId;
    return {
      ...item, parentId: parent ?? undefined, properties,
      ...(item.position ? { position: {
        ...item.position, x: item.position.x + offsetX, y: item.position.y + offsetY
      } } : {})
    };
  });
  return { components: survivors, removed: targets.length, locked: [] };
}


export function remapComponentInteractionTargets<T extends PageComponentMetadata>(
  components:readonly T[],ids:ReadonlyMap<string,string>
):T[]{
  return components.map(component=>{
    const raw=component.properties.pagePropertyContract;
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return component;
    const envelope=raw as Record<string,unknown>,interactions=envelope.interactions;
    if(!Array.isArray(interactions))return component;
    const next=interactions.map(interaction=>{
      if(!interaction||typeof interaction!=='object'||Array.isArray(interaction))return interaction;
      const targetId=(interaction as Record<string,unknown>).targetComponentId;
      const replacement=typeof targetId==='string'?ids.get(targetId):undefined;
      return replacement?{...interaction as Record<string,unknown>,targetComponentId:replacement}:interaction;
    });
    if(next.every((interaction,index)=>interaction===interactions[index]))return component;
    return {...component,properties:{...component.properties,
      pagePropertyContract:{...envelope,interactions:next}}};
  });
}

/** Snapshot the selected component and every descendant, in existing render order. */
export function copyComponentTree(
  components: readonly PageComponentMetadata[], rootId: string
): ComponentClipboard {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of components) {
      if (!ids.has(item.id) && ids.has(rawLayoutParentId(item) ?? '')) {
        ids.add(item.id);
        changed = true;
      }
    }
  }
  return { rootId, components: structuredClone(components.filter(item => ids.has(item.id))) };
}

/** Deep copy with newly allocated IDs and internally consistent parent references. */
export function cloneComponentTree(
  snapshot: ComponentClipboard,
  rootParentId: string | null,
  makeId: () => string = () => 'copy-' + crypto.randomUUID(),
  offset = 24
): { rootId: string; components: PageComponentMetadata[] } {
  if (!snapshot.components.some(item => item.id === snapshot.rootId))
    throw new Error('Cannot copy a missing component');
  const ids = new Map(snapshot.components.map(item => [item.id, makeId()]));
  const cloned = snapshot.components.map(item => {
    const root = item.id === snapshot.rootId;
    const originalParent = rawLayoutParentId(item);
    const parent = root ? rootParentId : ids.get(originalParent ?? '') ?? null;
    const properties = structuredClone(item.properties);
    // A clone is a new page instance. Its original CSV-facing name is never reused.
    // The page's shared naming allocator assigns the next free type-based name.
    delete properties.navigatorName;
    if (parent) properties.layoutParentId = parent;
    else delete properties.layoutParentId;
    return {
      ...structuredClone(item),
      id: ids.get(item.id)!,
      label: root ? item.label + ' Copy' : item.label,
      parentId: parent ?? undefined,
      properties,
      position: item.position
        ? {...item.position,
          x: root ? item.position.x + offset : item.position.x,
          y: root ? item.position.y + offset : item.position.y}
        : undefined
    };
  });
  return { rootId: ids.get(snapshot.rootId)!, components: remapComponentInteractionTargets(cloned,ids) };
}

/** Dropping into a tab also establishes the selected tab, not just parentId. */
export function assignTabOnReparent(
  items: PageComponentMetadata[],movingId:string,parentId:string|null,selectedTab?:string
):PageComponentMetadata[] {
  const parent=items.find(item=>item.id===parentId);
  if(parent?.type!=='Tabs')return items;
  const tabNames=Array.isArray(parent.properties.tabs)
    ?parent.properties.tabs.filter((name):name is string=>typeof name==='string'&&name.length>0)
    :[];
  const tab=selectedTab&&tabNames.includes(selectedTab)?selectedTab:tabNames[0];
  if(!tab)return items;
  return items.map(item=>item.id===movingId
    ?{...item,properties:{...item.properties,tabLabel:tab}}:item);
}
