import type { PageComponentMetadata } from '../../metadata/Definitions/metadata';

export type CanvasPosition = NonNullable<PageComponentMetadata['position']>;
export type CanvasGuides = { x: boolean; y: boolean };
export type SnapResult = { position: CanvasPosition; guides: CanvasGuides };
export const CANVAS_GRID = 8;
const MAGNET_RANGE = 6;

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/** Pure geometric snapping. No extra React state or history entries during a drag. */
export function snapCanvasPosition(
  draft: CanvasPosition,
  canvas: { width: number; height: number },
  neighbours: ReadonlyArray<CanvasPosition>,
  gridEnabled = true
): SnapResult {
  let x = clamp(Math.round(draft.x), 0, canvas.width - draft.width);
  let y = clamp(Math.round(draft.y), 0, canvas.height - draft.height);
  const guides = { x: false, y: false };
  if (gridEnabled) {
    x = clamp(Math.round(x / CANVAS_GRID) * CANVAS_GRID, 0, canvas.width - draft.width);
    y = clamp(Math.round(y / CANVAS_GRID) * CANVAS_GRID, 0, canvas.height - draft.height);
  }
  const xAnchors = neighbours.flatMap(p => [p.x, p.x + p.width, p.x + p.width / 2]);
  const yAnchors = neighbours.flatMap(p => [p.y, p.y + p.height, p.y + p.height / 2]);
  const nearest = (value: number, offsets: number[], anchors: number[]) => {
    let best = value;
    let distance = MAGNET_RANGE + 1;
    for (const anchor of anchors) for (const offset of offsets) {
      const diff = Math.abs(anchor - (value + offset));
      if (diff < distance) { best = anchor - offset; distance = diff; }
    }
    return { value: best, matched: distance <= MAGNET_RANGE };
  };
  const horizontal = nearest(x, [0, draft.width, draft.width / 2], xAnchors);
  const vertical = nearest(y, [0, draft.height, draft.height / 2], yAnchors);
  if (horizontal.matched) { x = clamp(Math.round(horizontal.value), 0, canvas.width - draft.width); guides.x = true; }
  if (vertical.matched) { y = clamp(Math.round(vertical.value), 0, canvas.height - draft.height); guides.y = true; }
  return { position: { ...draft, x, y }, guides };
}

export function snapCanvasSize(
  position: CanvasPosition,
  width: number,
  height: number,
  canvas: { width: number; height: number },
  min: { width: number; height: number },
  gridEnabled: boolean
): CanvasPosition {
  const scaled = (n: number) => gridEnabled ? Math.round(n / CANVAS_GRID) * CANVAS_GRID : Math.round(n);
  return {
    ...position,
    width: clamp(scaled(width), Math.min(min.width, canvas.width - position.x), canvas.width - position.x),
    height: clamp(scaled(height), Math.min(min.height, canvas.height - position.y), canvas.height - position.y)
  };
}

export const isCanvasLocked = (component: Pick<PageComponentMetadata, 'properties'>) =>
  component.properties.editorLocked === true;

/** A group is an existing layout container, so no new metadata/runtime engine. */
export function wrapCanvasComponent(
  components: readonly PageComponentMetadata[],
  id: string,
  groupId: string
): PageComponentMetadata[] {
  const child = components.find(component => component.id === id);
  if (!child || !child.position || isCanvasLocked(child) || child.parentId) return [...components];
  const group: PageComponentMetadata = {
    id: groupId, type: 'Container', label: child.label + ' Group', visible: true,
    region: child.region ?? 'main',
    position: { ...child.position },
    properties: { visualStyle: { padding: 0, margin: 0, gap: 0 }, layoutContainer: true }
  };
  return components.flatMap(component => component.id === id
    ? [group, { ...component, parentId: groupId, properties: { ...component.properties, layoutParentId: groupId },
      position: { ...component.position!, x: 0, y: 0 } }]
    : [component]);
}

/** Group compatible root-level free-canvas components without losing absolute geometry. */
export function groupCanvasComponents(
  components: readonly PageComponentMetadata[],
  ids: readonly string[],
  groupId: string
): PageComponentMetadata[] {
  const selection=new Set(ids);
  const children=components.filter(item=>selection.has(item.id));
  if(children.length<2||children.length!==selection.size||children.some(item=>
    !item.position||item.parentId||item.properties.layoutParentId||isCanvasLocked(item)
  ))return [...components];
  const left=Math.min(...children.map(item=>item.position!.x));
  const top=Math.min(...children.map(item=>item.position!.y));
  const right=Math.max(...children.map(item=>item.position!.x+item.position!.width));
  const bottom=Math.max(...children.map(item=>item.position!.y+item.position!.height));
  const group:PageComponentMetadata={
    id:groupId,type:'Container',label:'Group',visible:true,region:children[0].region??'main',
    position:{x:left,y:top,width:right-left,height:bottom-top},
    properties:{layoutContainer:true,visualStyle:{padding:0,margin:0,gap:0}}
  };
  let added=false;
  return components.flatMap(item=>{
    if(!selection.has(item.id))return [item];
    const child={...item,parentId:groupId,
      properties:{...item.properties,layoutParentId:groupId},
      position:{...item.position!,x:item.position!.x-left,y:item.position!.y-top}};
    if(!added){added=true;return [group,child];}
    return [child];
  });
}

/** Restore grouped children to absolute canvas coordinates without data migrations. */
export function ungroupCanvasComponent(
  components: readonly PageComponentMetadata[], id: string
): PageComponentMetadata[] {
  const group = components.find(item => item.id === id);
  if (!group || group.type !== 'Container' || !group.position || isCanvasLocked(group)) return [...components];
  const children = components.filter(item => item.parentId === id || item.properties.layoutParentId === id);
  if (!children.length || children.some(isCanvasLocked)) return [...components];
  return components.filter(item => item.id !== id).map(item => {
    if (!children.some(child => child.id === item.id)) return item;
    const props = { ...item.properties };
    delete props.layoutParentId;
    return { ...item, parentId: undefined, properties: props,
      position: {
        x: group.position!.x + (item.position?.x ?? 0),
        y: group.position!.y + (item.position?.y ?? 0),
        width: item.position?.width ?? group.position!.width,
        height: item.position?.height ?? group.position!.height
      }
    };
  });
}

/** Align a set of unlocked canvas components to a shared canvas edge/center in one immutable update. */
export function alignCanvasComponents(
  components: readonly PageComponentMetadata[],
  selectedIds: readonly string[],
  axis: 'x' | 'y',
  anchor: 'start' | 'center' | 'end',
  canvas: { width: number; height: number }
): PageComponentMetadata[] {
  const ids = new Set(selectedIds);
  const dimension = axis === 'x' ? 'width' : 'height';
  const eligible=components.filter(item=>ids.has(item.id)&&item.position
    &&!isCanvasLocked(item));
  if(!eligible.length)return [...components];
  const group=eligible.length>1;
  const low=group?Math.min(...eligible.map(item=>item.position![axis])):0;
  const high=group?Math.max(...eligible.map(item=>item.position![axis]+item.position![dimension]))
    :(axis==='x'?canvas.width:canvas.height);
  const mid=(low+high)/2;
  return components.map(item=>{
    if(!ids.has(item.id)||!item.position||isCanvasLocked(item))return item;
    const value=anchor==='start'?low:anchor==='center'
      ?Math.round(mid-item.position[dimension]/2):high-item.position[dimension];
    return {...item,position:{...item.position,[axis]:Math.round(value)}};
  });
}

/** Spacing is determined by the selected bounds and the actual element sizes. */
export function distributeCanvasComponents(
  components: readonly PageComponentMetadata[], ids: readonly string[], axis: 'x'|'y'
): PageComponentMetadata[] {
  const selected=new Set(ids);
  const dimension=axis==='x'?'width':'height';
  const eligible=components.filter(item=>selected.has(item.id)&&item.position
    &&!isCanvasLocked(item))
    .sort((a,b)=>a.position![axis]-b.position![axis]);
  if(eligible.length<3)return [...components];
  const first=eligible[0].position![axis];
  const last=eligible[eligible.length-1].position!;
  const space=last[axis]+last[dimension]-first
    -eligible.reduce((sum,item)=>sum+item.position![dimension],0);
  const gap=space/(eligible.length-1);
  const updates=new Map<string,number>();
  let cursor=first;
  for(const item of eligible){
    updates.set(item.id,Math.round(cursor));
    cursor+=item.position![dimension]+gap;
  }
  return components.map(item=>item.position&&updates.has(item.id)
    ?{...item,position:{...item.position,[axis]:updates.get(item.id)!}}:item);
}
