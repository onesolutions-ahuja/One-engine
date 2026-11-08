import type { SqlPersistence } from './sql-persistence.js';
export type ComponentDefinition={api_name:string;renderer_key:string};
export class ComponentRuntime {
  constructor(private readonly db:SqlPersistence) {}
  async list(tenantId:string) {
    const {rows}=await this.db.query<ComponentDefinition>(
      'SELECT api_name,renderer_key FROM md_component_definitions WHERE tenant_id=$1 AND enabled=true ORDER BY api_name',
      [tenantId]);
    return rows.map(row=>({apiName:row.api_name,rendererKey:row.renderer_key}));
  }
  async resolve(tenantId:string,apiName:string):Promise<ComponentDefinition> {
    const {rows}=await this.db.query<ComponentDefinition>(
      'SELECT api_name,renderer_key FROM md_component_definitions WHERE tenant_id=$1 AND api_name=$2 AND enabled=true',[tenantId,apiName]);
    if(!rows[0]) throw new Error('Component not found');
    return rows[0];
  }
  // Renderers execute in the web client registry; database metadata never evaluates source code.
}

export type MetadataValueRow={component_key?:string;property_path:string;value_kind:string;value_text:string|null};
export function encodeMetadataValue(value:unknown,path:string,rows:Array<{path:string;kind:string;text:string|null}>,depth=0):void{
  if(depth>16||rows.length>5000)throw new Error('Invalid metadata properties');
  if(value===undefined)return;
  const add=(kind:string,text:string|null)=>rows.push({path,kind,text});
  if(value===null){add('null',null);return;}
  if(Array.isArray(value)){
    add('array',null);
    value.forEach((v,i)=>encodeMetadataValue(v,path+'/'+i,rows,depth+1));return;
  }
  if(typeof value==='object'){
    if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
      throw new Error('Invalid metadata property');
    add('object',null);
    for(const [k,v] of Object.entries(value)){
      if(['__proto__','prototype','constructor'].includes(k))throw new Error('Invalid metadata property name');
      encodeMetadataValue(v,path+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1'),rows,depth+1);
    }return;
  }
  if(typeof value==='string'&&value.length<=20000){add('string',value);return;}
  if(typeof value==='number'&&Number.isFinite(value)){add('number',String(value));return;}
  if(typeof value==='boolean'){add('boolean',String(value));return;}
  throw new Error('Invalid metadata property');
}
export function decodeMetadataValues(rows:MetadataValueRow[]):Record<string,unknown>{
  const output:Record<string,unknown>={};
  for(const row of [...rows].sort((a,b)=>a.property_path.split('/').length-b.property_path.split('/').length)){
    const parts=row.property_path.split('/').slice(1).map(p=>p.replace(/~1/g,'/').replace(/~0/g,'~'));
    if(!parts.length||parts.some(p=>['__proto__','constructor','prototype'].includes(p)))continue;
    let parent:Record<string,unknown>=output;
    for(const part of parts.slice(0,-1)){
      const next=parent[part];
      if(!next||typeof next!=='object')throw new Error('Invalid saved metadata property');
      parent=next as Record<string,unknown>;
    }
    parent[parts[parts.length-1]]=row.value_kind==='array'?[]:row.value_kind==='object'?{}:
      row.value_kind==='null'?null:row.value_kind==='boolean'?row.value_text==='true':
      row.value_kind==='number'?Number(row.value_text):row.value_text??'';
  }
  return output;
}

