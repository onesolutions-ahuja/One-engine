import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/core/workspace/WorkspaceTheme/design-system.css';

window.React = React;

function SmartSearchAccessibilityFixture() {
  const [query,setQuery]=React.useState('');
  const [expanded,setExpanded]=React.useState(false);
  const [active,setActive]=React.useState(-1);
  const inputId=React.useId();
  const listId=React.useId();
  const suggestions=expanded&&query
    ?['Alice','Alex','Bob'].filter(name=>name.toLowerCase().includes(query.toLowerCase()))
    :[];
  const choose=(name)=>{setQuery(name);setExpanded(false);setActive(-1);};
  return <div>
    <label htmlFor={inputId}>Contact search</label>
    <input id={inputId} type="search" role="combobox"
      aria-autocomplete="list" aria-expanded={suggestions.length>0}
      aria-controls={suggestions.length>0?listId:undefined}
      aria-activedescendant={active>=0?listId+'-option-'+active:undefined}
      value={query} onChange={event=>{setQuery(event.target.value);setExpanded(true);setActive(-1);}}
      onKeyDown={event=>{
        if(event.key==='ArrowDown'&&suggestions.length){event.preventDefault();setActive(index=>(index+1)%suggestions.length);}
        else if(event.key==='ArrowUp'&&suggestions.length){event.preventDefault();setActive(index=>index<=0?suggestions.length-1:index-1);}
        else if(event.key==='Enter'&&active>=0){event.preventDefault();choose(suggestions[active]);}
        else if(event.key==='Escape'){setExpanded(false);setActive(-1);}
      }}/>
    {suggestions.length>0&&<div id={listId} role="listbox" aria-label="Contact search suggestions">
      {suggestions.map((name,index)=><div role="option" aria-selected={index===active}
        id={listId+'-option-'+index} key={name} onClick={()=>choose(name)}>{name}</div>)}
    </div>}
  </div>;
}
function AccessibilityFixture() {
  return <main style={{display:'grid',gap:16,padding:24}}>
    <h1>Smart component accessibility fixture</h1>
    <SmartSearchAccessibilityFixture />
    <button type="button" disabled aria-busy="true">Working…</button>
  </main>;
}
createRoot(document.getElementById('root')).render(<AccessibilityFixture />);
