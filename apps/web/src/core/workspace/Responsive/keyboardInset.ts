/** Publishes the height of the on-screen keyboard as the `--keyboard-inset` CSS variable.
 *
 * iOS Safari and Android Chrome (default `resizes-visual`) keep the layout viewport — and therefore
 * `100dvh` — unchanged when the software keyboard opens; only `window.visualViewport` shrinks. Phone
 * sheets and forms use `--keyboard-inset` to lift their sticky Save/Cancel footer above the keyboard.
 * When the keyboard is open `<html>` also carries the `md-keyboard-open` class.
 */

/** Below this many CSS px the difference is browser chrome (URL bar), not a keyboard. */
export const KEYBOARD_MIN_INSET = 120;
/** Pinch-zoom also shrinks the visual viewport; it must never be mistaken for a keyboard. */
const MAX_UNZOOMED_SCALE = 1.01;

export interface ViewportSnapshot {
  innerHeight: number;
  height: number;
  offsetTop: number;
  scale: number;
}

/** Keyboard height in CSS px, or 0 when no keyboard is believed to be open. */
export function computeKeyboardInset(viewport: ViewportSnapshot): number {
  if (viewport.scale > MAX_UNZOOMED_SCALE) return 0;
  const inset = Math.round(viewport.innerHeight - viewport.height - viewport.offsetTop);
  return inset >= KEYBOARD_MIN_INSET ? inset : 0;
}

/** Idempotent. Returns a disposer; a missing Visual Viewport API leaves the variable at its 0px default. */
export function installKeyboardInset(win: Window = window): () => void {
  const viewport = win.visualViewport;
  if (!viewport) return () => undefined;
  const root = win.document.documentElement;
  let frame = 0;
  let current = -1;
  const apply = () => {
    frame = 0;
    const inset = computeKeyboardInset({
      innerHeight: win.innerHeight,
      height: viewport.height,
      offsetTop: viewport.offsetTop,
      scale: viewport.scale
    });
    if (inset === current) return;
    current = inset;
    root.style.setProperty('--keyboard-inset', `${inset}px`);
    root.classList.toggle('md-keyboard-open', inset > 0);
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(apply); };
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  win.addEventListener('orientationchange', schedule);
  apply();
  return () => {
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    win.removeEventListener('orientationchange', schedule);
    if (frame) win.cancelAnimationFrame(frame);
    root.style.removeProperty('--keyboard-inset');
    root.classList.remove('md-keyboard-open');
  };
}
