/**
 * Close transient native <details> menus on outside click / Escape without
 * collapsing regular disclosures, accordions or record detail sections.
 *
 * Popups are recognised by their absolutely/fixed-positioned direct panel
 * child (the same pattern used across shared Records and app toolbars).
 * Controlled React popovers keep using useDismissOnOutside.
 */
export function installPopoverDismissal(doc: Document = document): () => void {
  const popupDetails = () => Array.from(doc.querySelectorAll<HTMLDetailsElement>('details[open]'))
    .filter(details => Array.from(details.children).some(child =>
      child.tagName !== 'SUMMARY' &&
      ['absolute', 'fixed'].includes(doc.defaultView?.getComputedStyle(child).position ?? '')
    ) || details.hasAttribute('data-dismiss-on-outside'));

  const onPointerDown = (event: PointerEvent) => {
    for (const details of popupDetails()) {
      if (!(event.target instanceof Node) || !details.contains(event.target)) details.open = false;
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    const details = popupDetails().at(-1);
    if (!details) return;
    details.open = false;
    details.querySelector<HTMLElement>(':scope > summary')?.focus();
    event.preventDefault();
  };
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest('button, a, [role="menuitem"]');
    if (!action) return;
    const details = action.closest<HTMLDetailsElement>('details[open]');
    if (!details || !popupDetails().includes(details)) return;
    // A form/filter editor stays open for multiple selections; simple action
    // menus can be dismissed once their item is activated.
    if (!details.querySelector('input, select, textarea, [contenteditable="true"]')) details.open = false;
  };
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('click', onClick, true);
  };
}
