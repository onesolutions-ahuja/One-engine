import * as React from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown, EyeOff, Layers3, LockKeyhole, Pencil, Search, X} from 'lucide-react';
import type {LibraryComponentMetadata, PageComponentMetadata} from '../../metadata/Definitions/metadata';
import {libraryComponentLabel} from '../../components/Registry/componentLibraryDiscovery';
import {buildPageNavigatorEntries, filterPageNavigatorEntries} from './pageComponentNavigatorModel.mjs';
import {componentInstanceNames} from '../../../../../server/src/system-support/page-component-names';
import type {CanvasSelectMode} from './canvasSelectionInteractions';
import './PageComponentNavigator.css';

type NavigatorEntry = ReturnType<typeof buildPageNavigatorEntries>[number];
type Props = {
  components: PageComponentMetadata[];
  libraryComponents: LibraryComponentMetadata[];
  selectedId: string;
  selectionIds: string[];
  pageKey: string;
  onSelect: (id: string, mode:CanvasSelectMode) => void;
  onRename: (id: string, name: string) => void;
};

export default function PageComponentNavigator({
  components, libraryComponents, selectedId, selectionIds, pageKey, onSelect, onRename
}: Props) {
  const [query,setQuery]=React.useState('');
  const [open,setOpen]=React.useState(false);
  const [typeFilter,setTypeFilter]=React.useState('');
  const [activeIndex,setActiveIndex]=React.useState(0);
  const [renamingId,setRenamingId]=React.useState('');
  const [renameValue,setRenameValue]=React.useState('');
  const [position,setPosition]=React.useState({top:0,left:0,width:420});
  const inputRef=React.useRef<HTMLInputElement|null>(null);
  const panelRef=React.useRef<HTMLDivElement|null>(null);
  const listRef=React.useRef<HTMLDivElement|null>(null);
  const labels=React.useMemo(()=>Object.fromEntries(libraryComponents.map(item=>[
    item.apiName, libraryComponentLabel(item)
  ])),[libraryComponents]);
  const entries:NavigatorEntry[]=React.useMemo(()=>{
    // Display exactly the same per-page identity as CSV export, including legacy
    // components whose name has not yet been persisted to metadata.
    const names=componentInstanceNames(components);
    return buildPageNavigatorEntries(components,labels).map(entry=>{
      const name=names.get(entry.id)??entry.name;
      return {...entry,name,baseName:name,customName:true,
        searchText:entry.searchText+' '+name.toLocaleLowerCase()};
    });
  },[components,labels]);
  const types=React.useMemo(()=>[...new Set(entries.map(item=>item.type))].sort(),[entries]);
  const matches=React.useMemo(
    ()=>filterPageNavigatorEntries(entries,query,typeFilter),[entries,query,typeFilter]);
  const selected=entries.find(item=>item.id===selectedId);
  const active=matches[Math.min(activeIndex,matches.length-1)];

  React.useEffect(()=>{
    setOpen(false);setQuery('');setTypeFilter('');setRenamingId('');setActiveIndex(0);
  },[pageKey]);
  React.useEffect(()=>setActiveIndex(0),[query,typeFilter]);
  React.useEffect(()=>{
    if (!open) return;
    const update=()=>{
      const rect=inputRef.current?.closest('.ribbon-view-search')?.getBoundingClientRect();
      if (!rect) return;
      const width=Math.min(420,window.innerWidth-12);
      const maxHeight=Math.min(430,window.innerHeight-20);
      setPosition({
        top:Math.max(6,Math.min(rect.bottom+5,window.innerHeight-maxHeight-6)),
        left:Math.max(6,Math.min(rect.left,window.innerWidth-width-6)),width
      });
    };
    const outside=(event:PointerEvent)=>{
      const node=event.target as Node;
      if (!panelRef.current?.contains(node) && !inputRef.current?.closest('.ribbon-view-find')?.contains(node)) {
        setOpen(false);setRenamingId('');
      }
    };
    update();
    document.addEventListener('pointerdown',outside);
    window.addEventListener('resize',update);
    window.addEventListener('scroll',update,true);
    return()=>{
      document.removeEventListener('pointerdown',outside);
      window.removeEventListener('resize',update);
      window.removeEventListener('scroll',update,true);
    };
  },[open]);

  const choose=(item:NavigatorEntry,mode:CanvasSelectMode='replace')=>{
    onSelect(item.id,mode);
    if(mode==='replace'){
      setOpen(false);setQuery('');setTypeFilter('');setRenamingId('');
    }
  };
  const startRename=(item:NavigatorEntry)=>{
    setRenamingId(item.id);
    setRenameValue(item.name);
  };
  const finishRename=(commit:boolean)=>{
    if (commit && renamingId) onRename(renamingId,renameValue.trim().slice(0,80));
    setRenamingId('');
  };
  const onSearchKeyDown=(event:React.KeyboardEvent<HTMLInputElement>)=>{
    if (event.key==='Escape') {setOpen(false);setRenamingId('');return;}
    if (event.key==='ArrowDown'||event.key==='ArrowUp') {
      event.preventDefault();setOpen(true);
      setActiveIndex(current=>Math.max(0,Math.min(matches.length-1,current+(event.key==='ArrowDown'?1:-1))));
    } else if (event.key==='Enter' && open && active) {
      event.preventDefault();choose(active,event.altKey?'member':event.shiftKey?'range':event.ctrlKey||event.metaKey?'toggle':'replace');
    }
  };
  React.useEffect(()=>{
    if(!open || !active || !listRef.current) return;
    const target=Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-navigator-id]'))
      .find(item=>item.dataset.navigatorId===active.id);
    target?.scrollIntoView({block:'nearest'});
  },[open,active?.id]);

  return <div className="office-ribbon-stack ribbon-view-find page-component-navigator">
    <div className="ribbon-view-search">
      <Search size={14} aria-hidden="true"/>
      <input ref={inputRef} type="search" role="combobox" autoComplete="off"
        aria-label="Find a component" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open?'page-component-navigator-results':undefined}
        aria-activedescendant={open&&active?'page-nav-option-'+active.id:undefined}
        placeholder="Find a component" value={query}
        onFocus={()=>setOpen(true)}
        onClick={()=>setOpen(true)}
        onKeyDown={onSearchKeyDown}
        onChange={event=>{setQuery(event.target.value);setOpen(true);}}/>
      {query && <button type="button" className="page-navigator-clear"
        aria-label="Clear component search" onClick={()=>{setQuery('');setOpen(true);inputRef.current?.focus();}}><X size={12}/></button>}
      <button type="button" className="page-navigator-toggle" aria-label="Browse page components"
        aria-expanded={open} onClick={()=>{if(!open)inputRef.current?.focus();setOpen(!open);}}>
        <ChevronDown size={14} aria-hidden="true"/>
      </button>
    </div>
    <small className="page-navigator-help">{selectionIds.length?selectionIds.length+' selected · ':''}{components.length} on page · Layers</small>
    {open && createPortal(<div ref={panelRef} className="ribbon-view-find-results page-navigator-popup"
      style={{position:'fixed',top:position.top,left:position.left,width:position.width}}
      role="dialog" aria-label="Components on this page">
      <div className="page-navigator-heading">
        <strong>Layers · {selectionIds.length} selected</strong>
        <button type="button" aria-label="Close component navigator" onClick={()=>setOpen(false)}><X size={15}/></button>
      </div>
      <div className="page-navigator-filters">
        <label>Type <select aria-label="Filter components by type" value={typeFilter}
          onChange={event=>setTypeFilter(event.target.value)}>
          <option value="">All components ({entries.length})</option>
          {types.map(type=><option key={type} value={type}>{type} ({entries.filter(row=>row.type===type).length})</option>)}
        </select></label>
        <span>{matches.length} found</span>
      </div>
      <div id="page-component-navigator-results" ref={listRef}
        className="page-navigator-list" role="listbox" aria-multiselectable="true" aria-label="Page component results">
        {matches.map((item,index)=><div key={item.id} data-navigator-id={item.id}
          className={'page-navigator-row'+(selectionIds.includes(item.id)?' is-selected':'')+(active?.id===item.id?' is-active':'')}>
          {renamingId===item.id ? <div className="page-navigator-rename">
            <input autoFocus aria-label="Component name" maxLength={80}
              value={renameValue} onChange={event=>setRenameValue(event.target.value)}
              onKeyDown={event=>{
                if(event.key==='Escape'){event.preventDefault();finishRename(false);}
                if(event.key==='Enter'){event.preventDefault();finishRename(true);}
              }}/>
            <button type="button" onClick={()=>finishRename(true)}>Save</button>
            <button type="button" onClick={()=>finishRename(false)}>Cancel</button>
          </div> : <>
            <button type="button" id={'page-nav-option-'+item.id} role="option"
              aria-selected={selectionIds.includes(item.id)} className="page-navigator-option"
              title={item.id+' · '+item.path} onMouseEnter={()=>setActiveIndex(index)}
              onClick={event=>choose(item,event.altKey?'member':event.shiftKey?'range':event.ctrlKey||event.metaKey?'toggle':'replace')}>
              <Layers3 size={15} aria-hidden="true"/>
              <span className="page-navigator-item-copy">
                <strong>{item.name}</strong>
                <small>{item.type} · {item.path}{item.location?' · '+item.location:''}</small>
                {item.detail && <small className="page-navigator-binding" title={item.detail}>{item.detail}</small>}
              </span>
              {item.hidden && <EyeOff size={13} aria-label="Hidden" />}
              {item.locked && <LockKeyhole size={13} aria-label="Locked" />}
            </button>
            <button type="button" className="page-navigator-rename-button"
              aria-label={'Rename '+item.name+' in navigator'} title="Rename component (unique within the page layout)"
              disabled={item.locked} onClick={()=>startRename(item)}><Pencil size={13}/></button>
          </>}
        </div>)}
        {!matches.length && <div className="page-navigator-empty" role="status">No matching components. Try another name, field or type.</div>}
      </div>
      <div className="page-navigator-footer">
        <span>{selectionIds.length>1?selectionIds.length+' components selected':selected?'Selected: '+selected.name:'Select a component'}</span>
        <span>Ctrl/Cmd-click: toggle · Shift-click: range</span>
      </div>
    </div>,document.body)}
  </div>;
}
