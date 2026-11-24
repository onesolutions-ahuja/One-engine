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

/** Bounds of a block (one component, or a whole visual group). */
function blockBounds(members: readonly PageComponentMetadata[]): Position | null {
  if (members.length === 1) return members[0].position ?? null;
  return canvasGroupBounds(members);
}
const covers = (outer: Position | null, inner: Position | null) =>
  !!outer && !!inner && outer.x <= inner.x && outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

/** Sibling blocks in stacking order (bottom first). A visual group is one block. */
function siblingBlocks(siblings: readonly PageComponentMetadata[]) {
  const blocks: PageComponentMetadata[][] = [];
  const seen = new Set<string>();
  for (const sibling of siblings) {
    if (seen.has(sibling.id)) continue;
    const members = canvasGroupMembers(siblings, sibling);
    for (const member of members) seen.add(member.id);
    blocks.push(members);
  }
  return blocks;
}

/** Lowest slot a block may be sent to: it always stays above any sibling that
 * fully covers it (a background panel, a full-page image...), so Send to back
 * can never hide a component behind the canvas area it sits on. */
function backFloor(blocks: PageComponentMetadata[][], from: number): number {
  const own = blockBounds(blocks[from]);
  let floor = 0;
  blocks.forEach((block, index) => {
    if (index !== from && covers(blockBounds(block), own)) floor = Math.max(floor, index < from ? index + 1 : index);
  });
  return Math.min(floor, from);
}

function layerState(components: readonly PageComponentMetadata[], id: string) {
  const selected = components.find(item => item.id === id);
  if (!selected || selected.properties.editorLocked === true) return null;
  const siblings = components.filter(item => parentId(item) === parentId(selected));
  const moving = canvasGroupMembers(siblings, selected);
  if (moving.some(item => item.properties.editorLocked === true)) return null;
  const blocks = siblingBlocks(siblings);
  const from = blocks.findIndex(block => block.some(item => item.id === selected.id));
  if (from < 0) return null;
  return {selected, blocks, from};
}

const reorder = (components: readonly PageComponentMetadata[], selected: PageComponentMetadata,
  blocks: PageComponentMetadata[][]) => {
  const ordered = blocks.flat();
  let cursor = 0;
  return components.map(item => parentId(item) === parentId(selected) ? ordered[cursor++] : item);
};

/** A command is unavailable when the selected block already sits at the
 * relevant edge (for back: just above what covers it). Locked objects cannot move. */
export function canMoveCanvasLayer(
  components: readonly PageComponentMetadata[], id: string,
  direction: 'front' | 'back' | 'forward' | 'backward'
): boolean {
  const state = layerState(components, id);
  if (!state) return false;
  const {blocks, from} = state;
  return direction === 'back' || direction === 'backward'
    ? from > backFloor(blocks, from) : from < blocks.length - 1;
}

/** Reorder sibling slots only. Grouped members stay together, without changing other parents.
 * New and front-placed components go on top; Send to back stops above any covering sibling. */
export function moveCanvasLayer(
  components: readonly PageComponentMetadata[], id: string, edge: 'front' | 'back'
): PageComponentMetadata[] {
  const state = layerState(components, id);
  if (!state) return [...components];
  const {selected, blocks, from} = state;
  const to = edge === 'front' ? blocks.length - 1 : backFloor(blocks, from);
  const [block] = blocks.splice(from, 1);
  blocks.splice(to, 0, block);
  return reorder(components, selected, blocks);
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
 * one block and never crosses into another container's stacking context.
 * Stepping back never goes below a sibling that fully covers the block. */
export function shiftCanvasLayer(
  components: readonly PageComponentMetadata[], id: string, offset: -1 | 1
): PageComponentMetadata[] {
  const state = layerState(components, id);
  if (!state) return [...components];
  const {selected, blocks, from} = state;
  const to = from + offset;
  if (to < 0 || to >= blocks.length || (offset < 0 && from <= backFloor(blocks, from))) return [...components];
  [blocks[from], blocks[to]] = [blocks[to], blocks[from]];
  return reorder(components, selected, blocks);
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
