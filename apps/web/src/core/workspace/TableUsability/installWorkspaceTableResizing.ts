/** One shared, presentation-only column resizer for workspace data tables.
 * Record Workspace keeps its existing SQL-persisted width controls; this
 * enhancement is for other table-based lists and does not alter metadata.
 */
const SKIP = '.records-data-table, [data-md-table-no-resize], [role="presentation"]';
const EXCLUDED_ANCESTORS = '[contenteditable="true"], .document-print, .md-mail-message-body, .builder-editor-mode';
const MIN_WIDTH = 80;
const MAX_WIDTH = 1200;

function headersFor(table: HTMLTableElement): HTMLTableCellElement[] {
  const row = table.tHead?.rows[0];
  if (!row || table.tHead!.rows.length !== 1 || row.cells.length < 2) return [];
  const headers = Array.from(row.cells);
  return headers.every(cell =>
    cell.tagName === 'TH' && cell.colSpan === 1 && cell.rowSpan === 1
  ) ? headers : [];
}

function ensureWidths(table: HTMLTableElement, headers: HTMLTableCellElement[]) {
  let group = table.querySelector(':scope > colgroup[data-md-columns]') as HTMLTableColElement | null;
  if (!group) {
    const existing = table.querySelector(':scope > colgroup');
    if (existing) return null; // Never overwrite metadata-defined column layout.
    const widths = headers.map(cell => Math.max(MIN_WIDTH, Math.round(cell.getBoundingClientRect().width)));
    group = document.createElement('colgroup');
    group.setAttribute('data-md-columns', '');
    widths.forEach(width => {
      const column = document.createElement('col');
      column.style.width = width + 'px';
      group!.appendChild(column);
    });
    table.insertBefore(group, table.firstChild);
    table.style.width = widths.reduce((sum, value) => sum + value, 0) + 'px';
    table.style.minWidth = '0';
    table.style.tableLayout = 'fixed';
    table.classList.add('md-table-width-set');
  }
  const cols = Array.from(group.children) as HTMLTableColElement[];
  return cols.length === headers.length ? cols : null;
}

function resize(table: HTMLTableElement, columns: HTMLTableColElement[], index: number, width: number) {
  const next = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)));
  columns[index].style.width = next + 'px';
  table.style.width = columns.reduce((total, col) =>
    total + (Number.parseFloat(col.style.width) || MIN_WIDTH), 0) + 'px';
  return next;
}

function enhance(table: HTMLTableElement) {
  if (table.matches(SKIP) || table.closest(EXCLUDED_ANCESTORS) || table.closest('table table')) return;
  const headers = headersFor(table);
  if (!headers.length || table.querySelector(':scope > colgroup:not([data-md-columns])')) return;
  table.classList.add('md-resizable-table');
  table.parentElement?.classList.add('md-table-scroll-host');
  headers.forEach((header, index) => {
    if (header.querySelector(':scope > .md-table-column-handle')) return;
    header.classList.add('md-table-resize-header');
    const handle = document.createElement('span');
    handle.className = 'md-table-column-handle';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', 'Resize ' + (header.textContent?.trim() || 'column') + ' column');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', String(MIN_WIDTH));
    handle.setAttribute('aria-valuemax', String(MAX_WIDTH));
    handle.tabIndex = 0;
    const initial = Math.max(MIN_WIDTH, Math.round(header.getBoundingClientRect().width));
    handle.setAttribute('aria-valuenow', String(initial));

    // Keep table headers, rows and Page Builder actions inert while resizing.
    handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    handle.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); });
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const columns = ensureWidths(table, headers);
      if (!columns) return;
      event.preventDefault();
      event.stopPropagation(); // Resizing cannot trigger header sort/navigation.
      const start = Number.parseFloat(columns[index].style.width) || MIN_WIDTH;
      const startX = event.clientX;
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        const value = resize(table, columns, index, start + moveEvent.clientX - startX);
        handle.setAttribute('aria-valuenow', String(value));
      };
      const finish = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== event.pointerId) return;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    });

    handle.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const columns = ensureWidths(table, headers);
      if (!columns) return;
      event.preventDefault();
      event.stopPropagation();
      const width = Number.parseFloat(columns[index].style.width) || MIN_WIDTH;
      const value = resize(table, columns, index, width + (event.key === 'ArrowRight' ? 16 : -16));
      handle.setAttribute('aria-valuenow', String(value));
    });
    header.appendChild(handle);
  });
}

/** Install only with the authenticated workspace; no observer or table code on public routes. */
export function installWorkspaceTableResizing() {
  if (typeof document === 'undefined') return;
  const scan = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLTableElement) enhance(node);
    else if (node.matches('thead, th, tr') && node.closest('thead')) {
      const parent = node.closest('table');
      if (parent instanceof HTMLTableElement) enhance(parent);
    }
    node.querySelectorAll('table').forEach(table => {
      if (table instanceof HTMLTableElement) enhance(table);
    });
  };
  scan(document.body);
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) scan(node);
    }
  });
  observer.observe(document.body, {subtree: true, childList: true});
  return () => observer.disconnect();
}
