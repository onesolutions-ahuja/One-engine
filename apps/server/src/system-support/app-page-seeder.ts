import type {PoolClient} from 'pg';
export type AppPageSeed={key:string;version:number;pageApiName:string;title:string;componentId:string;
  properties:Record<string,unknown>};
const safe=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Value={path:string;text:string|null;type:string;objectId:string|null;fieldId:string|null;flowId:string|null};
/** Independent app metadata is flattened to relational values; never executable JSON.
 * Existing seeded or user-edited properties are never overwritten by an upgrade. */
export function flattenAppProperties(properties:Record<string,unknown>):Value[] {
  const values:Value[]=[];
  const visit=(value:unknown,path:string,depth:number)=>{
    if(depth>12||values.length>=500)throw new Error('Invalid app property size');
    if(value&&typeof value==='object'){
      const array=Array.isArray(value);
      if(path)values.push({path,text:null,type:array?'array':'object',objectId:null,fieldId:null,flowId:null});
      for(const [key,item] of Object.entries(value)){
        if(!(safe.test(key)||array&&/^(0|[1-9][0-9]*)$/.test(key))||['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid app property key');
        visit(item,path?path+'.'+key:key,depth+1);
      }
      return;
    }
    if(!path||!['string','number','boolean'].includes(typeof value)&&value!==null
      ||typeof value==='number'&&!Number.isFinite(value))throw new Error('Invalid app property value');
    const entry:Value={path,text:value===null?null:String(value),type:value===null?'null':typeof value,
      objectId:null,fieldId:null,flowId:null};
    if(typeof value==='string'&&value.startsWith('metadata:')){
      const id=value.slice(9);if(!uuid.test(id))throw new Error('Invalid metadata reference');
      if(/objectApiName$|targetObject$/i.test(path))entry.objectId=id;
      else if(/flowApiName$/i.test(path))entry.flowId=id;
      else if(/FieldApiName$|Field$|\.field$/i.test(path))entry.fieldId=id;
      else throw new Error('Invalid metadata reference property');
      entry.text=null;entry.type='reference';
    }
    values.push(entry);
  };
  visit(properties,'',0);return values;
}
export function expandAppProperties(rows:readonly {property_path:string;value_text:string|null;data_type:string;
  object_id?:string|null;field_id?:string|null;flow_id?:string|null}[]):Record<string,unknown> {
  const root:Record<string,unknown>=Object.create(null);
  for(const row of [...rows].sort((a,b)=>a.property_path.split('.').length-b.property_path.split('.').length)){
    const path=row.property_path.split('.');
    if(path.some(key=>!(safe.test(key)||/^(0|[1-9][0-9]*)$/.test(key))||['__proto__','prototype','constructor'].includes(key)))
      throw new Error('Invalid stored property path');
    let current=root;
    for(const key of path.slice(0,-1)){
      if(current[key]===undefined)current[key]=Object.create(null);
      if(!current[key]||typeof current[key]!=='object')throw new Error('Conflicting stored property path');
      current=current[key] as Record<string,unknown>;
    }
    const id=row.object_id??row.field_id??row.flow_id;
    const value=row.data_type==='array'?[]:row.data_type==='object'?Object.create(null):row.data_type==='reference'?(id?'metadata:'+id:undefined):row.data_type==='boolean'?row.value_text==='true'
      :row.data_type==='number'?Number(row.value_text):row.data_type==='null'?null:row.value_text;
    if(value===undefined||typeof value==='number'&&!Number.isFinite(value))throw new Error('Invalid stored property');
    const last=path[path.length-1];
    if(current[last]!==undefined&&typeof current[last]==='object'&&typeof value==='object')continue;
    current[last]=value;
  }
  return root;
}
export async function seedAppPage(client:PoolClient,tenantId:string,appId:string,seed:AppPageSeed) {
  if(!seed||!safe.test(seed.key)||!safe.test(seed.pageApiName)||!seed.title?.trim()
    ||!Number.isSafeInteger(seed.version)||seed.version<1||!uuid.test(seed.componentId))throw new Error('Invalid app page seed');
  const properties=flattenAppProperties(seed.properties);
  // Same-app installs serialize via their md_app_installations row in AppRuntime.
  const receipt=await client.query<{page_id:string;component_id:string;version:number}>(
    'SELECT page_id,component_id,version FROM md_app_seed_pages WHERE tenant_id=$1 AND app_id=$2 AND seed_key=$3 FOR UPDATE',
    [tenantId,appId,seed.key]);
  if(receipt.rows[0]?.version>=seed.version)return;
  const component=await client.query<{api_name:string}>(
    'SELECT api_name FROM md_component_definitions WHERE tenant_id=$1 AND id=$2 AND enabled=true',[tenantId,seed.componentId]);
  if(!component.rows[0])throw new Error('App component dependency missing');
  let saved=receipt.rows[0];
  if(!saved){
    const page=await client.query<{id:string}>(
      'INSERT INTO md_page_definitions (tenant_id,api_name,title) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',
      [tenantId,seed.pageApiName,seed.title]);
    if(!page.rows[0])throw new Error('App page conflicts with existing metadata; refusing to overwrite');
    const instance=await client.query<{id:string}>(
      'INSERT INTO md_page_components (tenant_id,page_id,component_api,slot) VALUES ($1,$2,$3,$4) RETURNING id',
      [tenantId,page.rows[0].id,component.rows[0].api_name,'main']);
    saved={page_id:page.rows[0].id,component_id:instance.rows[0].id,version:0};
  }
  for(const p of properties)await client.query(`
    INSERT INTO md_page_component_properties
      (tenant_id,component_id,property_path,value_text,data_type,object_id,field_id,flow_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [tenantId,saved.component_id,p.path,p.text,p.type,p.objectId,p.fieldId,p.flowId]);
  await client.query(`INSERT INTO md_app_seed_pages (tenant_id,app_id,seed_key,page_id,component_id,version)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,app_id,seed_key) DO UPDATE SET version=EXCLUDED.version`,
    [tenantId,appId,seed.key,saved.page_id,saved.component_id,seed.version]);
}
