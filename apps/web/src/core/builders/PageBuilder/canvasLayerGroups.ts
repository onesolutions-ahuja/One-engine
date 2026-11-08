import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';

type Position = NonNullable<PageComponentMetadata['position']>;
const parentId = (item: PageComponentMetadata) =>
  typeof item.properties.layoutParentId === 'string' && item.properties.layoutParentId
    ? item.properties.layoutParentId : item.parentId || null;

export const canvasGroupKey = (item: PageComponentMetadata | undefined): string | null =>
  typeof item?.properties.canvasGroupId === 'string' && item.properties.canvasGroupId
    ? item.properties.canvasGroupId : null;

export function canvasGroupMembers(components: readonly PageComponentMetadata[], item: PageComponentMetadata) {
  const id = canvasGroupKey(item);
  return id ? components.filter(other => canvasGroupKey(other) === id && parentId(other) === parentId(item)) : [item];
}

export function groupCanvasSelection(components: readonly PageComponentMetadata[], ids: readonly string[], groupId: string) {
  const selection = new Set(ids);
  const members = components.filter(item => selection.has(item.id));
  if (members.length < 2 || members.length !== selection.size ||
      members.some(item => !item.position || item.properties.editorLocked === true ||
        parentId(item) !== parentId(members[0]) || canvasGroupKey(item))) return [...components];
  return components.map(item => selection.has(item.id)
    ? {...item, properties: {...item.properties, canvasGroupId: groupId}} : item);
}

export function ungroupCanvasSelection(components: readonly PageComponentMetadata[], id: string) {
  const chosen = components.find(item => item.id === id);
  const group = canvasGroupKey(chosen);
  if (!group) return [...components];
  return components.map(item => {
    if (canvasGroupKey(item) !== group) return item;
    const properties = {...item.properties};
    delete properties.canvasGroupId;
    return {...item, properties};
  });
}

/** Office-style stacking is scoped to the direct siblings of the selected
 * component. Children are ordered inside their parent, not against page roots.
 * Both editor and runtime use the same sibling order. */
export function canvasSiblingLayerIndex(
  components: readonly PageComponentMetadata[], id: string
): number {
  const selected = components.find(item => item.id === id);
  if (!selected) return 0;
  return components.filter(item => parentId(item) === parentId(selected))
    .findIndex(item => item.id === id) + 1;
}

/** A command is unavailable when the whole selected group already occupies
 * the relevant edge. Locked objects cannot be rearranged. */
export function canMoveCanvasLayer(
  components: readonly PageComponentMetadata[], id: string,
  direction: 'front' | 'back' | 'forward' | 'backward'
): boolean {
  const selected = components.find(item => item.id === id);
  if (!selected || selected.properties.editorLocked === true) return false;
  const siblings = components.filter(item => parentId(item) === parentId(selected));
  const moving = canvasGroupMembers(siblings,selected);
  if (moving.some(item => item.properties.editorLocked === true)) return false;
  const ids = new Set(moving.map(item=>item.id));
  const first = siblings.findIndex(item => ids.has(item.id));
  const last = siblings.length-1-siblings.slice().reverse().findIndex(item => ids.has(item.id));
  if (first < 0 || last < 0) return false;
  return direction === 'back' || direction === 'backward' ? first > 0 : last < siblings.length-1;
}

/** Reorder sibling slots only. Grouped members stay together, without changing other parents. */
export function moveCanvasLayer(
  components: readonly PageComponentMetadata[], id: string, edge: 'front' | 'back'
): PageComponentMetadata[] {
  const selected = components.find(item => item.id === id);
  if (!selected || selected.properties.editorLocked === true) return [...components];
  const siblings = components.filter(item => parentId(item) === parentId(selected));
  const moving = canvasGroupMembers(siblings, selected);
  if (moving.some(item => item.properties.editorLocked === true)) return [...components];
  const groupIds = new Set(moving.map(item => item.id));
  const others = siblings.filter(item => !groupIds.has(item.id));
  const ordered = edge === 'front' ? [...others, ...moving] : [...moving, ...others];
  let cursor = 0;
  return components.map(item => parentId(item) === parentId(selected) ? ordered[cursor++] : item);
}

export function canvasGroupBounds(members: readonly PageComponentMetadata[]): Position | null {
  if (members.length < 2 || members.some(item => !item.position)) return null;
  const positions = members.map(item => item.position!);
  const x = Math.min(...positions.map(pos => pos.x));
  const y = Math.min(...positions.map(pos => pos.y));
  return {x, y, width: Math.max(...positions.map(pos => pos.x + pos.width)) - x,
    height: Math.max(...positions.map(pos => pos.y + pos.height)) - y};
}

/** Proportional geometry while preserving all original component metadata and identities. */
export function scaleCanvasGroup(
  members: readonly PageComponentMetadata[], next: Position
): Map<string, Position> {
  const original = canvasGroupBounds(members);
  const result = new Map<string, Position>();
  if (!original || original.width <= 0 || original.height <= 0) return result;
  for (const item of members) {
    const position = item.position!;
    result.set(item.id, {
      x: Math.round(next.x + (position.x - original.x) * next.width / original.width),
      y: Math.round(next.y + (position.y - original.y) * next.height / original.height),
      width: Math.max(1, Math.round(position.width * next.width / original.width)),
      height: Math.max(1, Math.round(position.height * next.height / original.height))
    });
  }
  return result;
}

/** One-step arrangement across sibling layer blocks. A visual group moves as
 * one block and never crosses into another container's stacking context. */
export function shiftCanvasLayer(
  components: readonly PageComponentMetadata[], id: string, offset: -1 | 1
): PageComponentMetadata[] {
  const selected=components.find(item=>item.id===id);
  if(!selected||selected.properties.editorLocked===true)return [...components];
  const siblings=components.filter(item=>parentId(item)===parentId(selected));
  const moving=canvasGroupMembers(siblings,selected);
  if(moving.some(item=>item.properties.editorLocked===true))return [...components];
  const movingIds=new Set(moving.map(item=>item.id));
  const blocks:PageComponentMetadata[][]=[];
  const seen=new Set<string>();
  for(const sibling of siblings){
    if(seen.has(sibling.id))continue;
    const members=canvasGroupMembers(siblings,sibling);
    for(const member of members)seen.add(member.id);
    blocks.push(members);
  }
  const from=blocks.findIndex(block=>block.some(item=>movingIds.has(item.id)));
  const to=from+offset;
  if(from<0||to<0||to>=blocks.length)return [...components];
  [blocks[from],blocks[to]]=[blocks[to],blocks[from]];
  const ordered=blocks.flat();
  let cursor=0;
  return components.map(item=>parentId(item)===parentId(selected)?ordered[cursor++]:item);
}

/** Explicit no-code sizing action; never infer a background or rescale siblings. */
export function fitCanvasComponentToPage(
  components: readonly PageComponentMetadata[],id:string,canvas:{width:number;height:number}
):PageComponentMetadata[] {
  const item=components.find(component=>component.id===id);
  if(!item?.position||parentId(item)||canvasGroupKey(item)||
    item.properties.editorLocked===true||!Number.isFinite(canvas.width)||
    !Number.isFinite(canvas.height)||canvas.width<=0||canvas.height<=0)return [...components];
  return components.map(component=>component.id===id
    ?{...component,position:{x:0,y:0,width:canvas.width,height:canvas.height}}:component);
}
