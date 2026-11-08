/** Bounded, pure no-code HTTP request and response mapping for all tenant providers. */
export type FlowHttpScalar=string|number|boolean|null;
export type FlowHttpVariables=Record<string,FlowHttpScalar>;
const ref=/^\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}$/;
const embedded=/\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}/g;
const key=/^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const own=(value:unknown):value is Record<string,unknown>=>Boolean(value)
 &&typeof value==='object'&&!Array.isArray(value);
const scalar=(value:unknown):value is FlowHttpScalar=>value===null||typeof value==='string'
 ||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);
function resource(name:string,vars:FlowHttpVariables):FlowHttpScalar {
 if(!Object.hasOwn(vars,name))throw new Error('Unknown HTTP Callout resource');
 return vars[name];
}
export function expandFlowHttpText(value:string,vars:FlowHttpVariables):string {
 return value.replace(embedded,(_match,name:string)=>String(resource(name,vars)??''));
}
function mapped(value:unknown,vars:FlowHttpVariables,depth=0,counter={nodes:0}):unknown {
 if(++counter.nodes>500||depth>8)throw new Error('HTTP mapping exceeds limits');
 if(typeof value==='string'){
  const standalone=ref.exec(value);
  return standalone?resource(standalone[1],vars):expandFlowHttpText(value,vars);
 }
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))
  return value;
 if(Array.isArray(value)){
  if(value.length>100)throw new Error('HTTP mapping array limit exceeded');
  return value.map(item=>mapped(item,vars,depth+1,counter));
 }
 if(!own(value)||Object.keys(value).length>100)throw new Error('Invalid HTTP mapping value');
 const result:Record<string,unknown>=Object.create(null);
 for(const [name,item] of Object.entries(value)){
  if(!key.test(name)||['__proto__','prototype','constructor'].includes(name))
   throw new Error('Invalid HTTP mapping property name');
  result[name]=mapped(item,vars,depth+1,counter);
 }
 return result;
}
export function parseFlowHttpMapping(value:unknown,vars:FlowHttpVariables):Record<string,unknown>{
 if(typeof value!=='string'||value.length>32768)throw new Error('Invalid HTTP mapping');
 let parsed:unknown;
 try{parsed=JSON.parse(value);}catch{throw new Error('Invalid HTTP mapping JSON');}
 if(!own(parsed))throw new Error('HTTP mapping must be an object');
 return mapped(parsed,vars) as Record<string,unknown>;
}
export function prepareFlowHttpRequest(config:Record<string,unknown>,vars:FlowHttpVariables,maxBodyBytes=32768){
 if(!Number.isInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>8*1024*1024)
  throw Error('Invalid HTTP body limit');
 const path=String(config.path??'');
 const destination=expandFlowHttpText(path,vars);
 if(destination.length>2048)throw new Error('HTTP Callout path exceeds size limit');
 const url=new URL(destination,'https://metadrive.invalid/');
 if(url.origin!=='https://metadrive.invalid'||destination.startsWith('/')||destination.includes('\\')
   ||url.hash)throw new Error('HTTP Callout requires a safe relative path');
 if(typeof config.queryParameters==='string'&&config.queryParameters.trim()){
  const query=parseFlowHttpMapping(config.queryParameters,vars);
  for(const [name,value] of Object.entries(query)){
   if(!scalar(value)||typeof value==='string'&&value.length>4096)
    throw new Error('HTTP query mappings require scalar values');
   if(value!==null)url.searchParams.set(name,String(value));
  }
 }
 const mappedBody=typeof config.body==='string'&&config.body.trim()
  ?config.body.trim().startsWith('{')||config.body.trim().startsWith('[')
    ?JSON.stringify(mapped(JSON.parse(config.body),vars))
    :expandFlowHttpText(config.body,vars):undefined;
 if(mappedBody&&Buffer.byteLength(mappedBody)>maxBodyBytes)
  throw new Error('HTTP Callout body too large');
 return {path:url.pathname.slice(1)+url.search,body:mappedBody};
}
export function mapFlowHttpResponse(value:unknown,body:string,
 allowedOutputs:ReadonlyArray<string|{name:string;dataType:string}>):Record<string,FlowHttpScalar> {
 if(typeof value!=='string'||!value.trim())return {};
 if(value.length>8192)throw new Error('HTTP response mapping too large');
 let mapping:unknown,payload:unknown;
 try{mapping=JSON.parse(value);payload=JSON.parse(body);}catch{throw new Error('Invalid HTTP response mapping or response JSON');}
 if(!own(mapping)||Object.keys(mapping).length>50)
  throw new Error('Invalid HTTP response mapping');
 const output:Record<string,FlowHttpScalar>=Object.create(null);
 for(const [name,path] of Object.entries(mapping)){
  const resource=allowedOutputs.find(item=>typeof item==='string'?item===name:item.name===name);
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)
    ||!resource||typeof path!=='string'||path.length>256
    ||!/^([A-Za-z][A-Za-z0-9_]*|\[\d+\])(\.[A-Za-z][A-Za-z0-9_]*|\[\d+\])*$/.test(path))
   throw new Error('Invalid HTTP response output resource');
  let current:unknown=payload;
  for(const token of path.match(/[A-Za-z][A-Za-z0-9_]*|\d+/g)??[]){
   if(!current||typeof current!=='object'||!Object.hasOwn(current,token)){
    current=null;break;
   }
   current=(current as Record<string,unknown>)[token];
  }
  if(!scalar(current)||typeof current==='string'&&current.length>4096)
   throw new Error('HTTP response resource must be a bounded scalar');
  if(typeof resource==='object'&&current!==null){
   const type=resource.dataType;
   if(['Number','Currency','Percent'].includes(type)&&typeof current!=='number'
     ||['Boolean','Checkbox'].includes(type)&&typeof current!=='boolean'
     ||!['Number','Currency','Percent','Boolean','Checkbox'].includes(type)
       &&typeof current!=='string')
    throw new Error('HTTP response resource type mismatch: '+name);
  }
  output[name]=current;
 }
 return output;
}

/** Reuse a caller-supplied attempt key rather than generating a new key on each retry. */
export function resolveFlowHttpCalloutKey(
  configured:unknown,defaultKey:string,resolve:(expression:string)=>unknown
):string {
  if(configured===undefined||configured===null||configured==='')return defaultKey;
  if(typeof configured!=='string'||configured.length>400)
    throw new Error('HTTP Callout idempotency key is invalid');
  const key=configured.replace(/\{!([A-Za-z_$][A-Za-z0-9_$.]*)\}/g,(_token,name:string)=>{
    const value=resolve('{!'+name+'}');
    if(value===null||!['string','number','boolean'].includes(typeof value))
      throw new Error('HTTP Callout idempotency resource must be scalar');
    return String(value);
  });
  if(!key||key.length>200||!/^[A-Za-z0-9._:-]+$/.test(key))
    throw new Error('HTTP Callout idempotency key must be a short token');
  return key;
}

/** Expose only explicitly public, bounded connector settings to reusable HTTP Flow templates. */
export function publicHttpCredentialVariables(configuration:unknown):Record<string,string> {
 if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))return {};
 const output:Record<string,string>=Object.create(null);
 for(const [name,value] of Object.entries(configuration)) {
  if(/^public_[A-Za-z][A-Za-z0-9_]*$/.test(name)
      &&!/(secret|token|password|passphrase|private|pin|credential|authorization|api_?key)/i.test(name)
      &&typeof value==='string'&&value.length>0&&value.length<=4096)output[name]=value;
 }
 return output;
}

/** The public_ namespace belongs to the selected tenant Named Credential.
 * Do not fall back to caller-supplied Flow inputs if a credential is incomplete. */
export function bindPublicHttpCredentialVariables(
 variables:FlowHttpVariables,configuration:unknown,templates:unknown[]
):FlowHttpVariables {
 const bound:FlowHttpVariables=Object.create(null) as FlowHttpVariables;
 for(const [name,value] of Object.entries(variables)){
  if(!name.startsWith('public_'))bound[name]=value;
 }
 const settings=publicHttpCredentialVariables(configuration);
 const required=new Set<string>();
 for(const template of templates){
  if(typeof template!=='string')continue;
  for(const hit of template.matchAll(/\{!(public_[A-Za-z][A-Za-z0-9_]*)\}/g))
   required.add(hit[1]);
 }
 for(const name of required){
  if(!Object.hasOwn(settings,name))
   throw new Error('Required Named Credential public setting is unavailable: '+name);
 }
 Object.assign(bound,settings);
 return bound;
}
