import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
    if (tab && name && name !== tabName(tab) && !onRename(tab.id, name)) { finished.current = false; return; }
    setRenaming('');
  };
  // A tab shows its own name (Page key, else component name), never the component type.
  const tabName = (tab: PageComponentMetadata) => {
    const key = tab.properties?.pageKey, name = tab.properties?.navigatorName;
    return typeof key === 'string' && key.trim() ? key.trim() : typeof name === 'string' && name.trim() ? name.trim() : tab.label;
  };
  return <nav className="multi-page-bar" aria-label="MultiPage tabs">
    <span className="multi-page-bar-title">{multiPage ? multiPageName(multiPage) : 'MultiPage'}</span>
    {multiPage ? <div className="multi-page-bar-tabs" role="tablist">
      {tabs.map(tab => tab.id === renaming
        ? <input key={tab.id} ref={input} className="multi-page-rename" aria-label="Tab name" defaultValue={tabName(tab)}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === 'Enter') { event.preventDefault(); finishRename(event.currentTarget.value); }
              else if (event.key === 'Escape') { event.preventDefault(); finishRename(null); }
            }}
            onBlur={event => finishRename(event.currentTarget.value)} />
        : <button key={tab.id} type="button" role="tab" aria-selected={tab.id === open?.id}
            className={'multi-page-tab' + (tab.id === open?.id ? ' is-current' : '')}
            title={tabName(tab) + ' · SCREEN(page, ' + multiPageName(multiPage) + ', ' + multiPageTabId(tab, tabs) + ') · double-click to rename'}
            onClick={() => { setRenaming(''); onOpen(multiPage.id, tab.id); }}
            onDoubleClick={() => { onOpen(multiPage.id, tab.id); setRenaming(tab.id); }}>
            <b>{multiPageTabId(tab, tabs)}</b><span>{tabName(tab)}</span>
          </button>)}
      <button type="button" className="multi-page-add" aria-label="Add tab" title="Add tab"
        onClick={() => onAdd(multiPage.id)}><Plus size={15} /></button>
    </div> : <span className="multi-page-bar-hint">Select a MultiPage to see its tabs</span>}
    <div className="multi-page-bar-layouts">{layouts}</div>
  </nav>;
}
