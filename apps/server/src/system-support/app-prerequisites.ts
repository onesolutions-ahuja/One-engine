import {connectionKey,findConnectedReferences,isSystemConnectorName} from '../expression-engine/FormulaConnections.js';

/**
 * App prerequisites found automatically when an app is published.
 *
 * Nobody ticks them by hand: the publisher's pages and flows are scanned for
 *  - Flow HTTP callouts (by credential name),
 *  - page actions WHATSAPP("cred",…), SMS("cred",…), EMAIL("cred",…),
 *  - CONNECTED("name") guards.
 * A connection the app guards with CONNECTED() is OPTIONAL (a feature that
 * hides itself until connected, e.g. "Send invoice by WhatsApp"). Anything
 * used without a guard is REQUIRED.
 *
 * System connectors (onesys_…) can be installed for the user automatically.
 * Custom callouts (a tenant's own API) cannot: the user creates them.
 */
export type ConnectorPrerequisite={
 kind:'connector';key:string;appApi:string;label:string;optional:boolean;
 /** A flow calls it: the connector must exist for the flow to install. */
 usedByFlows:boolean;
 /** Credential names the publisher's metadata uses for it (new or legacy names). */
 credentialNames:string[];
};
export type CalloutPrerequisite={kind:'callout';name:string;optional:boolean;usedByFlows:boolean};
export type AppPrerequisite=ConnectorPrerequisite|CalloutPrerequisite;

type FlowLike={elements?:unknown};
type Contents={pages?:unknown[];flows?:FlowLike[]};
type Catalogue={
 /** Platform connector keys, e.g. whatsapp, sms_gate. */
 systemKeys:readonly string[];
 /** key → connector app API name and label. */
 connectorFor:(key:string)=>{appApi:string;label:string}|undefined;
 /** Publisher credential name (lower case) → connector key, from connector bindings. */
 publisherBindings:ReadonlyMap<string,string>;
};

const MESSAGE_ACTION=/\b(?:WHATSAPP|SMS|EMAIL)\s*\(\s*"((?:[^"]|"")*)"/gi;

/** Credential names used by flow callouts (packaged by name, never by ID). */
export function flowCredentialNames(flows:readonly FlowLike[]|undefined):string[]{
 const names=new Set<string>();
 for(const flow of flows??[])for(const element of Array.isArray(flow.elements)?flow.elements:[]){
  const config=element&&typeof element==='object'?(element as Record<string,unknown>).config:undefined;
  const name=config&&typeof config==='object'?(config as Record<string,unknown>).namedCredentialApiName:undefined;
  if(typeof name==='string'&&name.trim())names.add(name.trim());
 }
 return [...names].sort();
}

/** Credential names in WHATSAPP/SMS/EMAIL page actions anywhere in metadata. */
export function messageActionCredentialNames(value:unknown):string[]{
 const names=new Set<string>();
 const visit=(item:unknown,depth:number)=>{
  if(depth>40)return;
  if(typeof item==='string'){
   if(!/WHATSAPP|SMS|EMAIL/i.test(item))return;
   for(const match of item.matchAll(MESSAGE_ACTION)){
    const name=match[1].replace(/""/g,'"').trim();
    if(name)names.add(name);
   }
  }else if(Array.isArray(item))item.forEach(entry=>visit(entry,depth+1));
  else if(item&&typeof item==='object')Object.values(item).forEach(entry=>visit(entry,depth+1));
 };
 visit(value,0);
 return [...names].sort();
}

export function detectAppPrerequisites(contents:Contents,catalogue:Catalogue):AppPrerequisite[]{
 const flowNames=flowCredentialNames(contents.flows);
 const metadata=[contents.pages??[],contents.flows??[]];
 const actionNames=messageActionCredentialNames(metadata);
 const guarded=findConnectedReferences(metadata);
 // Which connector a name means: the publisher's binding first (legacy names),
 // then the reserved onesys_ prefix, then a bare platform key like "whatsapp".
 const connectorKey=(name:string)=>{
  const bound=catalogue.publisherBindings.get(name.toLowerCase());
  if(bound)return bound;
  const key=connectionKey(name);
  return key&&(isSystemConnectorName(name)||catalogue.systemKeys.includes(key))?key:'';
 };
 const connectors=new Map<string,ConnectorPrerequisite>();
 const callouts=new Map<string,CalloutPrerequisite>();
 const add=(name:string,source:'flow'|'action'|'guard')=>{
  const key=connectorKey(name);
  if(key){
   const app=catalogue.connectorFor(key);
   if(!app)return; // Unknown/retired connector: the package install reports it.
   const item=connectors.get(key)??{kind:'connector',key,appApi:app.appApi,label:app.label,
    optional:false,usedByFlows:false,credentialNames:[]};
   if(source==='flow')item.usedByFlows=true;
   if(source!=='guard'&&!item.credentialNames.includes(name))item.credentialNames.push(name);
   connectors.set(key,item);
   return;
  }
  const id=connectionKey(name);
  if(!id)return;
  const item=callouts.get(id)??{kind:'callout',name,optional:false,usedByFlows:false};
  if(source==='flow')item.usedByFlows=true;
  if(source!=='guard')item.name=name;
  callouts.set(id,item);
 };
 for(const name of flowNames)add(name,'flow');
 for(const name of actionNames)add(name,'action');
 for(const name of guarded)add(name,'guard');
 // Optional only when the app guards it with CONNECTED().
 const guardedKeys=new Set(guarded.map(name=>connectorKey(name)||'callout:'+connectionKey(name)));
 for(const item of connectors.values())item.optional=guardedKeys.has(item.key);
 for(const [id,item] of callouts)item.optional=guardedKeys.has('callout:'+id);
 for(const item of connectors.values())item.credentialNames.sort();
 return [...[...connectors.values()].sort((a,b)=>a.key.localeCompare(b.key)),
  ...[...callouts.values()].sort((a,b)=>a.name.localeCompare(b.name))];
}

/** Read prerequisites stored with a published version (tolerates older manifests). */
export function parsePrerequisites(value:unknown):AppPrerequisite[]{
 if(!Array.isArray(value))return [];
 const text=(item:unknown)=>typeof item==='string'?item:'';
 return value.flatMap((raw):AppPrerequisite[]=>{
  if(!raw||typeof raw!=='object')return [];
  const item=raw as Record<string,unknown>;
  if(item.kind==='connector'&&connectionKey(item.key)&&text(item.appApi))
   return [{kind:'connector',key:connectionKey(item.key),appApi:text(item.appApi),label:text(item.label)||text(item.appApi),
    optional:item.optional===true,usedByFlows:item.usedByFlows===true,
    credentialNames:Array.isArray(item.credentialNames)?item.credentialNames.filter(n=>typeof n==='string'):[]}];
  if(item.kind==='callout'&&connectionKey(item.name))
   return [{kind:'callout',name:text(item.name),optional:item.optional===true,usedByFlows:item.usedByFlows===true}];
  return [];
 });
}

/** Whether a missing connector must be installed together with the app. */
export const connectorInstallNeeded=(item:ConnectorPrerequisite)=>!item.optional||item.usedByFlows;
