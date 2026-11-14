/**
 * Connection names shared by the CONNECTED() formula, app publishing and app install.
 *
 * Two kinds of connection:
 *  - System connectors (WhatsApp, SMS Gate, Brevo, ...) are AppExchange connector
 *    apps. Their credential name starts with the reserved "onesys_" prefix, which
 *    tenants cannot use, so a tenant callout can never pose as a system connector.
 *    CONNECTED("whatsapp") and CONNECTED("onesys_whatsapp") mean the same thing.
 *  - Custom connections are the tenant's own HTTP callouts (Named Credentials),
 *    for example a personal API: CONNECTED("my_api").
 * A connection is "connected" only when its credential is enabled and has keys,
 * so an installed connector with empty keys is still FALSE.
 */
export const SYSTEM_CONNECTOR_PREFIX='onesys_';

/** Snapshot sent to the browser with the session. Names only, never secrets. */
export type ConnectionSnapshot={
 /** Keys of every system connector the platform offers, connected or not. */
 systemAvailable:readonly string[];
 /** Keys of system connectors installed and configured in this tenant. */
 systemConnected:readonly string[];
 /** Lower-case names of the tenant's own configured HTTPS callouts. */
 customConnected:readonly string[];
};

const KEY=/^[a-z][a-z0-9_]{0,127}$/;

/** "WhatsApp", "onesys_whatsapp", "sms-gate" → "whatsapp", "whatsapp", "sms_gate". */
export function connectionKey(name:unknown):string{
 const value=typeof name==='string'?name.trim().toLowerCase().replace(/-/g,'_'):'';
 const key=value.startsWith(SYSTEM_CONNECTOR_PREFIX)?value.slice(SYSTEM_CONNECTOR_PREFIX.length):value;
 return KEY.test(key)?key:'';
}
export const isSystemConnectorName=(name:unknown)=>
 typeof name==='string'&&name.trim().toLowerCase().startsWith(SYSTEM_CONNECTOR_PREFIX);

/** Whether a name refers to a system connector rather than a custom callout. */
export function isSystemConnection(snapshot:Pick<ConnectionSnapshot,'systemAvailable'>,name:unknown){
 const key=connectionKey(name);
 return !!key&&(isSystemConnectorName(name)||snapshot.systemAvailable.includes(key));
}

/** CONNECTED(name). System names check only system connectors, so a custom
 * callout that happens to be called "whatsapp" never counts as WhatsApp. */
export function isConnected(snapshot:ConnectionSnapshot|null|undefined,name:unknown):boolean{
 if(!snapshot)return false;
 const key=connectionKey(name);
 if(!key)return false;
 if(isSystemConnection(snapshot,name))return snapshot.systemConnected.includes(key);
 return snapshot.customConnected.includes(key);
}

/** Every literal CONNECTED("...") name used anywhere inside metadata (pages, flows). */
export function findConnectedReferences(value:unknown):string[]{
 const names=new Set<string>();
 const pattern=/\bCONNECTED\s*\(\s*"((?:[^"]|"")*)"\s*\)/gi;
 const visit=(item:unknown,depth:number)=>{
  if(depth>40)return;
  if(typeof item==='string'){
   if(!/connected/i.test(item))return;
   for(const match of item.matchAll(pattern)){
    const raw=match[1].replace(/""/g,'"');
    if(connectionKey(raw))names.add(raw.trim());
   }
  }else if(Array.isArray(item))item.forEach(entry=>visit(entry,depth+1));
  else if(item&&typeof item==='object')Object.values(item).forEach(entry=>visit(entry,depth+1));
 };
 visit(value,0);
 return [...names].sort();
}

type Node=import('./FormulaParser.js').Expression;
/** Server evaluators: replace CONNECTED("x") with TRUE/FALSE from a trusted
 * snapshot, so the shared flow evaluator needs no database access. */
export function resolveConnectedCalls(node:Node,snapshot:ConnectionSnapshot|null|undefined):Node{
 switch(node.kind){
  case 'call':{
   if(node.name.toUpperCase()==='CONNECTED'){
    if(node.args.length!==1)throw Error('Invalid CONNECTED argument count');
    const arg=node.args[0];
    if(arg.kind!=='literal'||typeof arg.value!=='string')
     throw Error('CONNECTED needs a connector name in quotes, e.g. CONNECTED("whatsapp")');
    return {kind:'literal',value:isConnected(snapshot,arg.value)};
   }
   return {...node,args:node.args.map(arg=>resolveConnectedCalls(arg,snapshot))};
  }
  case 'unary':return {...node,value:resolveConnectedCalls(node.value,snapshot)};
  case 'binary':return {...node,left:resolveConnectedCalls(node.left,snapshot),
   right:resolveConnectedCalls(node.right,snapshot)};
  default:return node;
 }
}
