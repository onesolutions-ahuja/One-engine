import {useSyncExternalStore} from 'react';
import {Parser,type Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';
import {validFormulaCollectionName,formulaCollectionReferenceKey} from '../../../../../server/src/expression-engine/FormulaCollection.js';

export type SessionCollection={name:string;items:unknown[]};
type Entry={owner:string;collection:SessionCollection};
type Snapshot={collections:Readonly<Record<string,SessionCollection>>;errors:Readonly<Record<string,string>>};
type Registry={owners:Map<string,Entry>;subscribers:Set<()=>void>;snapshot:Snapshot};
const empty:Snapshot=Object.freeze({collections:Object.freeze({}),errors:Object.freeze({})});
const sessions=new Map<string,Registry>();
/** Discover output names at any supported formula nesting depth.
 * An unquoted identifier is allowed only in COLLECTION's name position. */
export function namedCollectionNames(formula:unknown):string[]{
 if(typeof formula!=='string'||!formula.trim())return [];
 const found=new Set<string>();
 const outputs=(node:Expression):void=>{
  if(node.kind!=='call')return;
  if(node.name==='COLLECTION'){
   const first=node.args[0];
   const name=first?.kind==='literal'&&typeof first.value==='string'?first.value:
    first?.kind==='reference'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(first.value)?first.value:'';
   if(validFormulaCollectionName(name))found.add(name);
  }else if(node.name==='IF'&&node.args.length===3){
   outputs(node.args[1]);outputs(node.args[2]);
  }else if(node.name==='IFERROR'||node.name==='BLANKVALUE'||node.name==='NULLVALUE'){
   node.args.forEach(outputs);
  }
 };
 try{outputs(new Parser(tokenize(formula.trim())).parse());}catch{return [];}
 return [...found];
}
export function namedCollectionName(formula:unknown):string|undefined{
 return namedCollectionNames(formula)[0];
}
/** Decide whether a formula can yield a collection without evaluating it.
 * Used only by metadata collection consumers; ordinary scalar properties stay scalar.
 * IF and IFERROR select a branch lazily in the shared evaluator. */
export function isCollectionSourceExpression(formula:unknown,knownCollections:readonly string[]=[]):boolean{
 if(typeof formula!=='string'||!formula.trim())return false;
 const names=new Set(knownCollections.map(name=>name.toLowerCase()));
 const returnsCollection=(node:Expression):boolean=>{
  if(node.kind==='reference')return names.has(node.value.toLowerCase());
  if(node.kind!=='call')return false;
  if(node.name==='COLLECTION'||node.name==='TABLE')return true;
  if(node.name==='IF'&&node.args.length===3)
   return returnsCollection(node.args[1])||returnsCollection(node.args[2]);
  if(['IFERROR','BLANKVALUE','NULLVALUE'].includes(node.name))
   return node.args.some(returnsCollection);
  return false;
 };
 try{return returnsCollection(new Parser(tokenize(formula.trim())).parse());}
 catch{return false;}
}
function registry(scope:string):Registry{
 let current=sessions.get(scope);
 if(!current){current={owners:new Map(),subscribers:new Set(),snapshot:empty};sessions.set(scope,current);}
 return current;
}
function refresh(current:Registry):void{
 const collections:Record<string,SessionCollection>=Object.create(null);
 const errors:Record<string,string>=Object.create(null);
 const registered=new Map<string,string>();
 for(const {owner,collection} of current.owners.values()){
  const name=collection.name;
  if(!validFormulaCollectionName(name)){errors[owner]='Collection requires a valid nonblank name';continue;}
  const normalized=formulaCollectionReferenceKey(name).toLocaleLowerCase('en');
  const prior=registered.get(normalized);
  if(prior&&prior!==owner){errors[owner]='Duplicate collection name in this session: '+name;continue;}
  registered.set(normalized,owner);collections[formulaCollectionReferenceKey(name)]=collection;
 }
 current.snapshot={collections,errors};
 current.subscribers.forEach(callback=>callback());
}
export function registerSessionCollection(scope:string,owner:string,collection:SessionCollection|null):()=>void{
 if(!scope||!owner)return ()=>{};
 const current=registry(scope);
 const prior=current.owners.get(owner)?.collection;
 // Components without a named Collection must not invalidate every consumer.
 // Likewise a second publication of the same collection does not change the snapshot.
 const changed=collection ? prior!==collection : prior!==undefined;
 if(changed){
  if(collection)current.owners.set(owner,{owner,collection});
  else current.owners.delete(owner);
  refresh(current);
 }
 return ()=>{
  const entry=current.owners.get(owner);
  if(entry?.collection===collection){current.owners.delete(owner);refresh(current);}
  if(current.owners.size===0&&current.subscribers.size===0)sessions.delete(scope);
 };
}
export function getSessionCollection(scope:string,name:string):SessionCollection|undefined{
 const current=sessions.get(scope)?.snapshot.collections;
 return current?.[name]??Object.entries(current??{}).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1];
}
export function useSessionCollectionSnapshot(scope:string){
 return useSyncExternalStore(
  callback=>{const current=registry(scope);current.subscribers.add(callback);
   return ()=>{current.subscribers.delete(callback);
    if(!current.owners.size&&!current.subscribers.size)sessions.delete(scope);};},
  ()=>sessions.get(scope)?.snapshot??empty,()=>empty
 );
}
