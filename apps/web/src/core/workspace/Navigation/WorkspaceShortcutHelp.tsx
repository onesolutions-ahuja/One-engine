import * as React from 'react';
import { X } from 'lucide-react';
import { useModalAccessibility } from '../../accessibility/Modal/useModalAccessibility';
import '../WorkspaceTheme/shortcutHelp.css';

const commands: ReadonlyArray<[string,string]> = [
  ['Search records, pages and settings','⌘ K'],
  ['Back','⌘ ['],
  ['Forward','⌘ ]'],
  ['Show or hide sidebar','⌘ \\'],
  ['Find in record list','⌘ F'],
  ['New record (with Create permission)','⌘ N'],
  ['Show keyboard shortcuts','?'],
];

export default function WorkspaceShortcutHelp({onClose}:{onClose:()=>void}){
 const root=React.useRef<HTMLDivElement>(null);
 useModalAccessibility(true,root,onClose);
 return <div className="md-shortcut-backdrop" onMouseDown={event=>{
  if(event.target===event.currentTarget)onClose();
 }}>
   <div className="md-shortcut-dialog" ref={root} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1}>
    <header><h2>Keyboard shortcuts</h2><button type="button" className="icon-button" aria-label="Close keyboard shortcuts" onClick={onClose}><X size={18}/></button></header>
    <p>Use Control instead of Command on Windows and Linux. Shortcuts do not run while typing.</p>
    <dl>{commands.map(([label,keys])=><div key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl>
   </div>
  </div>;
}
