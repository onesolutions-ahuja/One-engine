import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { coEditorsStore } from '../management/pageCoEditing';
import type { PageComponentMetadata } from '../../../../metadata/Definitions/metadata';
import { multiPageName, multiPageTabId } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { multiPageTabs, openMultiPageTab, selectedMultiPage } from '../../multiPageBuilder';
import './MultiPageBar.css';

/** MultiPage bar under the canvas (always in view, above the page bar). With a MultiPage selected
 * (or something inside one) it lists that MultiPage's tabs: click opens a tab to design it,
 * double-click renames it (Enter saves, Esc cancels), + adds a tab. The number on each tab is its
 * id for SCREEN(page, MultiPage, id). The page's layouts (Desktop / Tablet / Mobile / Custom) sit
 * on the right for every page. */
export default function MultiPageBar({ components, selectedId, remembered, layouts, onOpen, onAdd, onRename }: {
  components: PageComponentMetadata[];
  selectedId?: string | null;
  remembered: Readonly<Record<string, string>>;
  layouts: ReactNode;
  onOpen: (multiPageId: string, tabId: string) => void;
  onAdd: (multiPageId: string) => void;
  onRename: (tabId: string, name: string) => boolean;
}) {
  const multiPage = selectedMultiPage(components, selectedId);
  const tabs = multiPage ? multiPageTabs(components, multiPage.id) : [];
  const open = multiPage ? openMultiPageTab(components, multiPage.id, selectedId, remembered[multiPage.id]) : undefined;
  const [renaming, setRenaming] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => { if (renaming) { finished.current = false; input.current?.focus(); input.current?.select(); } }, [renaming]);
  useEffect(() => { if (renaming && !tabs.some(tab => tab.id === renaming)) setRenaming(''); }, [renaming, tabs]);
  const finishRename = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    const tab = tabs.find(item => item.id === renaming);
    const name = value?.trim();
    if (tab && name && name !== tab.label && !onRename(tab.id, name)) { finished.current = false; return; }
    setRenaming('');
  };
  // Co-editing: who else is designing this page, and what they have selected (outlined).
  const editors = useSyncExternalStore(coEditorsStore.subscribe, coEditorsStore.get, coEditorsStore.get);
  const colors = ['#E8590C', '#7048E8', '#0CA678', '#D6336C', '#1C7ED6'];
  const outline = editors.flatMap((editor, index) => editor.selection.filter(id => /^[A-Za-z0-9_-]+$/.test(id))
    .map(id => '[data-component-id="' + id + '"]{outline:2px dashed ' + colors[index % colors.length] + ';outline-offset:2px}')).join('');
  return <nav className="multi-page-bar" aria-label="MultiPage tabs">
    <span className="multi-page-bar-title">{multiPage ? multiPageName(multiPage) : 'MultiPage'}</span>
    {multiPage ? <div className="multi-page-bar-tabs" role="tablist">
      {tabs.map(tab => tab.id === renaming
        ? <input key={tab.id} ref={input} className="multi-page-rename" aria-label="Tab name" defaultValue={tab.label}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === 'Enter') { event.preventDefault(); finishRename(event.currentTarget.value); }
              else if (event.key === 'Escape') { event.preventDefault(); finishRename(null); }
            }}
            onBlur={event => finishRename(event.currentTarget.value)} />
        : <button key={tab.id} type="button" role="tab" aria-selected={tab.id === open?.id}
            className={'multi-page-tab' + (tab.id === open?.id ? ' is-current' : '')}
            title={tab.label + ' · SCREEN(page, ' + multiPageName(multiPage) + ', ' + multiPageTabId(tab, tabs) + ') · double-click to rename'}
            onClick={() => { setRenaming(''); onOpen(multiPage.id, tab.id); }}
            onDoubleClick={() => { onOpen(multiPage.id, tab.id); setRenaming(tab.id); }}>
            <b>{multiPageTabId(tab, tabs)}</b><span>{tab.label}</span>
          </button>)}
      <button type="button" className="multi-page-add" aria-label="Add tab" title="Add tab"
        onClick={() => onAdd(multiPage.id)}><Plus size={15} /></button>
    </div> : <span className="multi-page-bar-hint">Select a MultiPage to see its tabs</span>}
    {editors.length > 0 && <span className="multi-page-editors" aria-label="Also designing this page">
      {editors.map((editor, index) => <span key={editor.clientId} className="multi-page-editor"
        style={{ background: colors[index % colors.length] }} title={editor.name + ' is designing this page'}>
        {(editor.name || '?').slice(0, 1).toUpperCase()}</span>)}
      <style>{outline}</style>
    </span>}
    <div className="multi-page-bar-layouts">{layouts}</div>
  </nav>;
}
