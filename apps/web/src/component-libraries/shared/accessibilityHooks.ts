import type * as React from 'react';

/** Shared accessibility behavior for registered One components and workspace dialogs. */
export function useModalAccessibility<T extends HTMLElement>(
  ReactApi: typeof import('react'), active: boolean, dialog: React.RefObject<T>, onEscape: () => void
): void {
  ReactApi.useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter(element => element.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] ?? dialog.current)?.focus();
    focusFirst();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onEscape(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === items[0] || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); items[items.length - 1].focus();
      } else if (!event.shiftKey && (document.activeElement === items[items.length - 1] || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); items[0].focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (dialog.current && event.target instanceof Node && !dialog.current.contains(event.target)) focusFirst();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active, dialog, onEscape]);
}

export function useDismissOnOutside<T extends HTMLElement>(
  ReactApi: typeof import('react'), container: React.RefObject<T>, expanded: boolean, dismiss: () => void
): void {
  ReactApi.useEffect(() => {
    if (!expanded || typeof document === 'undefined') return undefined;
    const onOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !container.current?.contains(event.target)) dismiss();
    };
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onEscape);
    };
  }, [container, expanded, dismiss]);
}
