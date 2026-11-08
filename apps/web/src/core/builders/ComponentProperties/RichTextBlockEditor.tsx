import {useRef,useState} from 'react';
import {StandardRichText} from '../../pages/PageRuntime/StandardPageBlocks';
import {safeRichTextLink} from '../../pages/PageRuntime/safeRichText';

/** Guided authored formatting with no raw HTML or scriptable URLs. */
export default function RichTextBlockEditor({
  value,onChange
}:{value:string;onChange:(next:string)=>void}) {
  const input=useRef<HTMLTextAreaElement>(null);
  const [preview,setPreview]=useState(false);
  const surround=(open:string,close:string,placeholder:string)=>{
    const el=input.current;
    if(!el)return;
    const start=el.selectionStart,end=el.selectionEnd;
    const chosen=value.slice(start,end)||placeholder;
    const next=value.slice(0,start)+open+chosen+close+value.slice(end);
    onChange(next);
    requestAnimationFrame(()=>{
      el.focus();
      el.setSelectionRange(start+open.length,start+open.length+chosen.length);
    });
  };
  const addLink=()=>{
    const url=window.prompt('Link URL (HTTPS, HTTP or mailto)');
    if(url===null)return;
    const safe=safeRichTextLink(url.trim());
    if(!safe){window.alert('Use a valid HTTPS, HTTP or mailto URL.');return;}
    const el=input.current;
    if(!el)return;
    const start=el.selectionStart,end=el.selectionEnd;
    const label=value.slice(start,end)||'Link text';
    onChange(value.slice(0,start)+'['+label+']('+safe+')'+value.slice(end));
  };
  return <div className="builder-rich-text-editor">
    <div className="canvas-align-choices" role="toolbar" aria-label="Rich text formatting">
      <button type="button" onClick={()=>surround('**','**','bold text')}>Bold</button>
      <button type="button" onClick={()=>surround('*','*','italic text')}>Italic</button>
      <button type="button" onClick={()=>surround('__','__','underlined text')}>Underline</button>
      <button type="button" onClick={addLink}>Insert link</button>
      <button type="button" aria-pressed={preview} onClick={()=>setPreview(previous=>!previous)}>
        {preview?'Edit':'Preview'}</button>
    </div>
    {preview?<StandardRichText text={value}/>:<textarea ref={input} className="form-control"
      rows={7} aria-label="Rich text content" value={value}
      onChange={event=>onChange(event.target.value)}/>}
    <p className="properties-help">Use the toolbar for safely formatted text. Raw HTML is displayed as text.</p>
  </div>;
}
