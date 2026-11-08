import {createElement,useEffect,useMemo,useState,type ReactNode} from 'react';
import {apiDownload} from '../../authentication/Client/authClient';

const imagePath=/^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/content$/i;
const allowedTags=new Set(['a','b','blockquote','br','code','div','em','h1','h2','h3','h4',
  'hr','i','li','ol','p','pre','s','span','strong','sub','sup','u','ul','img']);
const emptyObjects:Record<string,string>={};

export default function RichTextContent({html}:{html:string}) {
  const [images,setImages]=useState<Record<string,string>>(emptyObjects);
  const [failed,setFailed]=useState<Set<string>>(()=>new Set());
  const nodes=useMemo(()=>{
    const document=new DOMParser().parseFromString(html,'text/html');
    return Array.from(document.body.childNodes);
  },[html]);
  const paths=useMemo(()=>[...new Set(nodes.flatMap(function collect(node):string[] {
    if(node.nodeType!==Node.ELEMENT_NODE)return [];
    const element=node as HTMLElement;
    const own=element.tagName.toLowerCase()==='img'&&imagePath.test(element.getAttribute('src')??'')
      ?[element.getAttribute('src')!]:[];
    return [...own,...Array.from(element.childNodes).flatMap(collect)];
  }))],[nodes]);

  useEffect(()=>{
    let active=true;
    const objectUrls:string[]=[];
    setImages({});
    setFailed(new Set());
    void Promise.all(paths.map(async path=>{
      try {
        const blob=await apiDownload(path);
        if(!/^image\/(?:jpeg|png|gif|webp)$/.test(blob.type))
          throw new Error('Unexpected inline image content type');
        const url=URL.createObjectURL(blob);
        if(!active){URL.revokeObjectURL(url);return [path,null] as const;}
        objectUrls.push(url);
        return [path,url] as const;
      } catch {
        return [path,null] as const;
      }
    })).then(results=>{
      if(!active)return;
      setImages(Object.fromEntries(results.flatMap(([path,url])=>url?[[path,url]]:[])));
      setFailed(new Set(results.flatMap(([path,url])=>url?[]:[path])));
    });
    return ()=>{
      active=false;
      objectUrls.forEach(url=>URL.revokeObjectURL(url));
    };
  },[paths]);

  const render=(node:Node,key:string):ReactNode=>{
    if(node.nodeType===Node.TEXT_NODE)return node.textContent;
    if(node.nodeType!==Node.ELEMENT_NODE)return null;
    const element=node as HTMLElement;
    const tag=element.tagName.toLowerCase();
    if(['script','style','iframe','object','embed','template','svg','math'].includes(tag))return null;
    const children=Array.from(element.childNodes).map((child,index)=>render(child,`${key}-${index}`));
    if(!allowedTags.has(tag))return children;
    if(tag==='img'){
      const src=element.getAttribute('src')??'';
      if(!imagePath.test(src))return null;
      const objectUrl=images[src];
      return objectUrl
        ?<img key={key} src={objectUrl} alt={element.getAttribute('alt')??''} loading="lazy"/>
        :failed.has(src)?<span key={key} role="img" aria-label="Inline image unavailable">[Image unavailable]</span>:null;
    }
    if(tag==='a'){
      const href=element.getAttribute('href')??'';
      let valid=false;
      try {
        const parsed=new URL(href,window.location.origin);
        valid=['https:','http:','mailto:'].includes(parsed.protocol);
      } catch { valid=false; }
      return createElement('a',{key,href:valid?href:undefined,rel:'noopener noreferrer',target:'_blank'},...children);
    }
    return createElement(tag,{key},...children);
  };

  return <div className="record-rich-text">{nodes.map((node,index)=>render(node,String(index)))}</div>;
}
