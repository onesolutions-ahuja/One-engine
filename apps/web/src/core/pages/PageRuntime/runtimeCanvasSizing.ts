import type { CSSProperties } from 'react';
import type { LightningPageMetadata, PageComponentMetadata } from '../../metadata/Definitions/metadata';

/**
 * The published layout fits WIDTH, never height. A long free canvas scrolls
 * instead of shrinking until its cart and labels become unreadable.
 */
export function runtimeCanvasWidthScale(canvasWidth: number, availableWidth: number): number {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0 || !Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  return Math.min(1, Math.max(0.01, availableWidth / canvasWidth));
}

export function runtimeCanvasExtraWidth(canvasWidth: number, availableWidth: number): number {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0 || !Number.isFinite(availableWidth)) return 0;
  return Math.max(0, availableWidth - canvasWidth);
}

/** Widest change treated as a scrollbar appearing or disappearing. */
const SCROLLBAR_STEP = 24;
/**
 * Next measured canvas width, without the scrollbar feedback loop. When a small
 * step is immediately undone (width A -> B -> A within a second), the scaled
 * height is toggling a scrollbar; settle on the narrower width, where the
 * shorter canvas fits and the scrollbar stays away. Real resizes pass through.
 */
export function settleCanvasWidth(
  previous: number, next: number, lastStep: { from: number; at: number } | null, now: number,
  remember: (step: { from: number; at: number } | null) => void,
): number {
  if (Math.abs(previous - next) < .5) return previous;
  const small = Math.abs(previous - next) <= SCROLLBAR_STEP;
  if (small && lastStep && now - lastStep.at < 1000 && Math.abs(lastStep.from - next) < .5) {
    remember({ from: lastStep.from, at: now });
    return Math.min(previous, next);
  }
  remember(small ? { from: previous, at: now } : null);
  return next;
}

type CanvasPage = Pick<LightningPageMetadata, 'canvasWidth' | 'canvasHeight' | 'components'>;

/**
 * Detect a genuine large right column (cart, inspector, panel) rather than
 * making assumptions about a particular app or component API name.
 * Purely visual: stored positions and builder editing remain unchanged.
 */
export function runtimeRightColumnStart(page: CanvasPage): number | null {
  const w = page.canvasWidth, h = page.canvasHeight;
  const column = page.components
    .filter(component => {
      const p = component.position;
      if (!component.visible || component.parentId || !p) return false;
      const gap = w - (p.x + p.width);
      return p.x >= w * .43 && p.width >= w * .16 && p.width <= w * .49
        && p.height >= h * .38 && gap >= -w * .04 && gap <= w * .12;
    })
    .sort((a, b) => (b.position?.height ?? 0) - (a.position?.height ?? 0))[0];
  return column?.position?.x ?? null;
}

/**
 * On a larger monitor, keep right-side controls at the right and let large
 * left-hand surfaces (including dockbars) occupy the added width. Small
 * controls keep their authored pixel sizes: icons and type never stretch.
 *
 * --md-runtime-canvas-extra is zero for equal/smaller screens; the formula
 * therefore reproduces the original saved geometry without a second layout.
 */
export function runtimeResponsiveComponentStyle(
  page: CanvasPage, component: PageComponentMetadata, rightColumnStart: number | null,
): CSSProperties {
  const p = component.position, w = page.canvasWidth;
  if (!p || component.parentId || !Number.isFinite(w) || w <= 0) return {};
  const rightGap = w - (p.x + p.width);
  const coversPage = p.x <= w * .08 && p.width >= w * .8 && rightGap <= w * .12;
  // A component that starts a little left of the right column but mostly lies in
  // it (e.g. a cart overlapping the panel edge) moves with the column: left
  // behind, it ended up over the product grid on wider screens.
  const rightSide = rightColumnStart !== null
    ? (p.x >= rightColumnStart - 12 || p.x + p.width / 2 >= rightColumnStart) && !coversPage
    : p.x >= w * .55 && p.width <= w * .45
      && rightGap >= -w * .03 && rightGap <= w * .09;
  const fillsLeft = rightColumnStart !== null
    && p.x < rightColumnStart - 12
    && p.x <= w * .26 && p.width >= w * .28
    && p.x + p.width >= rightColumnStart - Math.max(64, w * .06);
  const extra = 'var(--md-runtime-canvas-extra, 0px)';
  if (rightSide) return { left: `calc(${p.x}px + ${extra})` };
  if (coversPage || fillsLeft) return { width: `calc(${p.width}px + ${extra})` };
  return {};
}
