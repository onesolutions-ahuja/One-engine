import type { FlowReferenceSymbol } from './flowReferenceCatalog';

/** @ / $ / ! typed at the cursor (start of text, after a space, bracket or operator).
 * Stays plain text when: written in quotes ("!" "@" "$"), right after a letter
 * ("Hello!", "mail@x"), or followed by a non-letter ("$5", "!!"). */
export function flowReferenceTokenAt(value:string,cursor:number)
  :{start:number;symbol:FlowReferenceSymbol;query:string}|null{
  const found=/(^|[\s(\[,=:+\-*/&])([@$!])((?:[A-Za-z_][A-Za-z0-9_.]*)?)$/.exec(value.slice(0,cursor));
  if(!found)return null;
  return {start:cursor-found[3].length-1,symbol:found[2] as FlowReferenceSymbol,query:found[3]};
}

/** Insert a {!Reference} in place of the typed shortcut, keeping the surrounding text. */
export function insertFlowReference(value:string,start:number,end:number,reference:string)
  :{value:string;cursor:number}{
  return {value:value.slice(0,start)+reference+value.slice(end),cursor:start+reference.length};
}
