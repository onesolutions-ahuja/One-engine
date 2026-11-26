import * as React from 'react';
import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';

/**
 * Designer speed: a data-bound component's preview is drawn again only when something it
 * shows changed. Selecting, moving or resizing a component changes only positions and the
 * builder's own state, so the other (often heavy: Cart, Card Grid, Table) previews are not
 * rebuilt on every click and drop. Only for builder previews (actions are off there).
 */
type Props = Record<string, unknown> & {builderPreview?: boolean; component?: PageComponentMetadata};

/** Same component for the preview: everything but where it sits on the canvas. */
export function samePreviewComponent(a: PageComponentMetadata | undefined, b: PageComponentMetadata | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.type === b.type && a.label === b.label && a.visible === b.visible
    && a.properties === b.properties && a.parentId === b.parentId && a.region === b.region
    && Boolean(a.position) === Boolean(b.position);
}
export function samePreviewComponents(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, index) => samePreviewComponent(item, b[index]));
}
const sameItems = (a: unknown, b: unknown) => a === b || (Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((item, index) => item === b[index]));

export function sameBuilderBinding(before: Props, after: Props): boolean {
  if (before.builderPreview !== true || after.builderPreview !== true) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const a = before[key], b = after[key];
    if (a === b) continue;
    if (typeof a === 'function' && typeof b === 'function') continue; // actions are off in the designer
    if (key === 'component' ? samePreviewComponent(a as PageComponentMetadata, b as PageComponentMetadata)
      : key === 'pageComponents' ? samePreviewComponents(a, b) : sameItems(a, b)) continue;
    return false;
  }
  return true;
}

const memoized = new WeakMap<React.ComponentType<any>, React.ComponentType<any>>();
/** The memoized designer version of a data-bound component renderer (one per renderer). */
export function builderBindingMemo<T extends React.ComponentType<any>>(component: T): T {
  let found = memoized.get(component);
  if (!found) { found = React.memo(component, sameBuilderBinding); memoized.set(component, found); }
  return found as T;
}
