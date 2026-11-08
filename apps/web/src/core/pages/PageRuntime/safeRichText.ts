/** Shared, deliberately small rich text grammar used by Page Builder and runtime.
 * Markup is inert data: no raw HTML, scriptable URLs or inline event handlers. */
export type RichToken = {
  kind:'text'|'bold'|'italic'|'underline'|'link';
  text:string;
  href?:string;
};
const tokenRe=/\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|__([^_\n]+)__|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
export function safeRichTextLink(raw:string):string|null {
  try{
    const url=new URL(raw);
    return (url.protocol==='https:'||url.protocol==='http:'||url.protocol==='mailto:')
      ?url.href:null;
  }catch{return null;}
}
/** Unknown or unsafe markup is displayed verbatim, not interpreted as HTML. */
export function parseSafeRichText(value:string):RichToken[] {
  const result:RichToken[]=[];
  let index=0;
  tokenRe.lastIndex=0;
  for(const match of value.matchAll(tokenRe)){
    const pos=match.index??0;
    if(pos>index)result.push({kind:'text',text:value.slice(index,pos)});
    if(match[1])result.push({kind:'bold',text:match[1]});
    else if(match[2])result.push({kind:'italic',text:match[2]});
    else if(match[3])result.push({kind:'underline',text:match[3]});
    else if(match[4]){
      const href=safeRichTextLink(match[5]);
      if(href)result.push({kind:'link',text:match[4],href});
      else result.push({kind:'text',text:match[0]});
    }
    index=pos+match[0].length;
  }
  if(index<value.length)result.push({kind:'text',text:value.slice(index)});
  return result;
}
