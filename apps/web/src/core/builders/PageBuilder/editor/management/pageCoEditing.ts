import type { PageComponentMetadata } from '../../../../metadata/Definitions/metadata';

/**
 * Page Builder co-editing: designers on the same page and layout see each other's
 * edits as they make them (not only after Save), and who else is there and what they
 * have selected. Edits travel as component upserts/removals through the server
 * (POST /page-edits, Page manage permission) on the live stream; nothing is saved
 * until someone presses Save, so version history is not filled with every move.
 */
export type CoEditOps={upsert:PageComponentMetadata[];remove:string[]};
export type CoEditor={clientId:string;name:string;selection:string[];seenAt:number};

/** What changed between two component lists (by id; JSON equality). */
export function diffComponents(before:ReadonlyMap<string,string>,after:readonly PageComponentMetadata[]):{ops:CoEditOps;next:Map<string,string>}{
 const next=new Map<string,string>();
 const upsert:PageComponentMetadata[]=[];
 for(const component of after){
  const text=JSON.stringify(component);
  next.set(component.id,text);
  if(before.get(component.id)!==text)upsert.push(component);
 }
 const remove=[...before.keys()].filter(id=>!next.has(id));
 return {ops:{upsert,remove},next};
}
/** Apply another designer's edits to the components shown here. Order: kept; new at the end. */
export function applyOps(components:readonly PageComponentMetadata[],ops:CoEditOps):PageComponentMetadata[]{
 const removed=new Set(ops.remove);
 const byId=new Map(ops.upsert.map(component=>[component.id,component]));
 const out=components.filter(component=>!removed.has(component.id)).map(component=>byId.get(component.id)??component);
 const present=new Set(out.map(component=>component.id));
 for(const component of ops.upsert)if(!present.has(component.id)&&!removed.has(component.id))out.push(component);
 return out;
}
export const PRESENCE_MS=25_000;
/** Keep editors heard from recently; newest state per client. */
export function updateEditors(editors:readonly CoEditor[],heard:CoEditor|null,now=Date.now()):CoEditor[]{
 const out=editors.filter(editor=>now-editor.seenAt<PRESENCE_MS&&editor.clientId!==heard?.clientId);
 if(heard)out.push(heard);
 // Nothing expired and no one new: keep the same list, so nothing redraws.
 if(!heard&&out.length===editors.length)return editors as CoEditor[];
 return out;
}
/** Same people with the same names and selections (only "last heard" times differ). */
export function sameEditorsShown(a:readonly CoEditor[],b:readonly CoEditor[]):boolean{
 if(a===b)return true;
 if(a.length!==b.length)return false;
 const byId=new Map(a.map(editor=>[editor.clientId,editor]));
 return b.every(editor=>{
  const old=byId.get(editor.clientId);
  return Boolean(old)&&old!.name===editor.name&&old!.selection.length===editor.selection.length
   &&old!.selection.every((id,index)=>id===editor.selection[index]);
 });
}

/** The other designers here now (shown on the MultiPage bar). */
let shownEditors:CoEditor[]=[];
const editorListeners=new Set<()=>void>();
export const coEditorsStore={
 get:()=>shownEditors,
 set(next:CoEditor[]){shownEditors=next;editorListeners.forEach(listener=>listener());},
 /** Presence lives here, not in Page Builder state: a heartbeat or another designer's
  * ping redraws only what shows presence, and only when what it shows changed. */
 update(change:(current:CoEditor[])=>CoEditor[]){
  const next=change(shownEditors);
  if(next===shownEditors)return;
  const shownChanged=!sameEditorsShown(shownEditors,next);
  shownEditors=next;
  if(shownChanged)editorListeners.forEach(listener=>listener());
 },
 subscribe(listener:()=>void){editorListeners.add(listener);return ()=>{editorListeners.delete(listener);};}
};
