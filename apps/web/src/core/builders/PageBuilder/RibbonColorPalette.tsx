import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Baseline,ChevronDown,PaintBucket,Square} from 'lucide-react';

type ColourKind='text'|'fill'|'border';
const themeColumns=[
  ['#ffffff','#f2f2f2','#d9d9d9','#bfbfbf','#a6a6a6','#808080'],
  ['#111111','#595959','#404040','#262626','#171717','#000000'],
  ['#e7e6e6','#d0cece','#aeaaaa','#757171','#3a3838','#222222'],
  ['#44546a','#d6dce4','#acb9ca','#8497b0','#5b6f8e','#333f50'],
  ['#4472c4','#d9e2f3','#b4c6e7','#8eaadb','#2f5597','#203864'],
  ['#ed7d31','#fbe5d6','#f8cbad','#f4b183','#c65911','#843c0c'],
  ['#a5a5a5','#ededed','#d9d9d9','#bfbfbf','#7f7f7f','#525252'],
  ['#ffc000','#fff2cc','#ffe699','#ffd966','#bf9000','#806000'],
  ['#5b9bd5','#ddebf7','#bdd7ee','#9dc3e6','#2e75b6','#1f4e78'],
  ['#70ad47','#e2f0d9','#c6e0b4','#a9d18e','#548235','#375623']
];
const standard=['#c00000','#ff0000','#ffc000','#ffff00','#92d050','#00b050','#00b0f0','#0070c0','#002060','#7030a0'];

export default function RibbonColorPalette({kind,label,value,onChange,variant='icon',iconVariant,disabled=false}:{
  kind:ColourKind;label:string;value:string;onChange:(color:string)=>void;
  variant?:'icon'|'capability'|'property';iconVariant?:'shape'|'focus';disabled?:boolean;
}){
  const [open,setOpen]=useState(false);
  const [customHex,setCustomHex]=useState(value);
  const [position,setPosition]=useState({top:0,left:0});
  const trigger=useRef<HTMLButtonElement>(null);
  const popup=useRef<HTMLDivElement>(null);
  // The original Design tab keeps its existing glyphs. Only Design 2 passes iconVariant.
  const icon=iconVariant==='shape'
    ?<svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
       <circle cx="7" cy="7" r="5" stroke="#254566" strokeWidth="1.6"/>
       <rect x="7" y="7" width="10" height="10" rx="1.6" fill="#9fcbf8"
         stroke="#254566" strokeWidth="1.5"/></svg>
    :iconVariant==='focus'
    ?<svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
       <rect x="4" y="4" width="12" height="12" rx="3" fill="#9bcdf8"/>
       <path d="M2 6V4a2 2 0 0 1 2-2h2M14 2h2a2 2 0 0 1 2 2v2M18 14v2a2 2 0 0 1-2 2h-2M6 18H4a2 2 0 0 1-2-2v-2"
         stroke="#1668be" strokeWidth="1.8" strokeLinecap="round"/></svg>
    :kind==='text'?<Baseline size={17}/>:kind==='fill'?<PaintBucket size={17}/>:<Square size={17}/>;
  const choose=(colour:string)=>{onChange(colour);setOpen(false);trigger.current?.focus();};
  useEffect(()=>setCustomHex(value),[value]);
  const toggle=()=>{
    if(!open&&trigger.current){
      const rect=trigger.current.getBoundingClientRect();
      const paletteHeight=390;
      setPosition({top:window.innerHeight-rect.bottom>=paletteHeight?rect.bottom+5:Math.max(8,rect.top-paletteHeight-5),
        left:Math.max(8,Math.min(rect.left,window.innerWidth-371))});
    }
    setOpen(current=>!current);
  };
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{
      if(!popup.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpen(false);
    };
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    const dismiss=()=>setOpen(false);
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',key);
    window.addEventListener('resize',dismiss);
    window.addEventListener('scroll',dismiss,true);
    return()=>{
      document.removeEventListener('pointerdown',outside);
      document.removeEventListener('keydown',key);
      window.removeEventListener('resize',dismiss);
      window.removeEventListener('scroll',dismiss,true);
    };
  },[open]);
  const swatch=(colour:string,key:string)=>(
    <button key={key} type="button" className={'office-ribbon-swatch'+(value.toLowerCase()===colour?' selected':'')}
      title={colour} aria-label={label+': '+colour} aria-pressed={value.toLowerCase()===colour}
      style={{backgroundColor:colour==='transparent'?'#fff':colour}}
      onClick={()=>choose(colour)}/>
  );
  return <>
    <button ref={trigger} type="button" disabled={disabled} className={variant==='capability'?'office-ribbon-capability-icon office-ribbon-direct-colour':variant==='property'?'office-ribbon-colour-property':'office-ribbon-icon-button office-ribbon-colour-command'}
      title={disabled?'Not supported by selected component':label+(value?' ('+value+')':' (not set)')} aria-label={label+' colour palette'} aria-expanded={open} aria-haspopup="dialog"
      onClick={toggle}>
      <span className="office-ribbon-command-glyph">{icon}<span className={'office-ribbon-colour-underline'+(value?'':' is-unset')} style={value?{background:value}:undefined}/></span>
      {variant==='capability'?<span className="office-ribbon-command-label">{label}</span>:<ChevronDown size={11}/>}
    </button>
    {open&&createPortal(<div ref={popup} className="office-ribbon-colour-palette" role="dialog"
      aria-label={label+' colour palette'} style={{top:position.top,left:position.left}}>
      <div className="office-ribbon-palette-heading">Theme colours</div>
      <div className="office-ribbon-palette-theme">
        {themeColumns.map((column,index)=><div className="office-ribbon-palette-column" key={index}>
          {column.map((colour,row)=>swatch(colour,index+'-'+row))}
        </div>)}
      </div>
      <div className="office-ribbon-palette-heading">Standard colours</div>
      <div className="office-ribbon-palette-standard">
        {standard.map(colour=>swatch(colour,colour))}
      </div>
      <div className="office-ribbon-palette-hex">
        <label>HEX <input type="text" aria-label={'HEX for '+label} value={customHex} placeholder="#RRGGBB" maxLength={7}
          onChange={event=>setCustomHex(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&/^#[0-9a-f]{6}$/i.test(customHex))choose(customHex);}}/></label>
        <button type="button" disabled={!/^#[0-9a-f]{6}$/i.test(customHex)} onClick={()=>choose(customHex)}>Apply</button>
      </div>
      <div className="office-ribbon-palette-footer">
        <button type="button" onClick={()=>choose(kind==='text'?'':'transparent')}>
          {kind==='text'?'Automatic':kind==='fill'?'No fill':'No colour'}
        </button>
        <label>More colours… <input type="color" aria-label={'Custom '+label+' colour'}
          value={/^#[0-9a-f]{6}$/i.test(value)?value:'#000000'}
          onChange={event=>choose(event.target.value)}/></label>
      </div>
    </div>,document.body)}
  </>;
}
