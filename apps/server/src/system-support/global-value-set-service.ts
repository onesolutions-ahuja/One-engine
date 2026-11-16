import {requireAvailableMetadataName} from './metadata-name-guard.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {loadNativeFields,nativeTableSql,nativeValueSql} from '../system-files/native-object-query.js';

export type GlobalValueSetActor = Readonly<{tenant_id:string;user_id:string}>;
export type GlobalValueSetValueInput = Readonly<{
  value:string;
  label?:string;
  active?:boolean;
}>;
export type GlobalValueSetInput = Readonly<{
  apiName:string;
  label:string;
  description?:string;
  values:readonly GlobalValueSetValueInput[];
}>;
export type GlobalValueSetUpdate = Readonly<{
  apiName?:string;
  label?:string;
  description?:string;
  values?:readonly GlobalValueSetValueInput[];
}>;
export type GlobalValueSetValue = Readonly<{
  value:string;
  label:string;
  active:boolean;
  sortOrder:number;
}>;
export type GlobalValueSet = Readonly<{
  id:string;
  apiName:string;
  label:string;
  description:string;
  values:readonly GlobalValueSetValue[];
  createdAt:string;
  updatedAt:string;
}>;

type SetRow = {
  id:string;
  api_name:string;
  label:string;
  description:string;
  created_at:Date|string;
  updated_at:Date|string;
};
type ValueRow = {
  value_set_id:string;
  value:string;
  label:string;
  active:boolean;
  sort_order:number;
};
type Executor = Pick<SqlPersistence,'query'>;

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const apiNamePattern=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const inputKeys=(input:Record<string,unknown>,allowed:readonly string[])=>{
  if(Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('Invalid global value set');
};
const parseValues=(input:unknown):GlobalValueSetValueInput[]=>{
  if(!Array.isArray(input)||input.length<1||input.length>500)throw new Error('Invalid global value set values');
  const seen=new Set<string>();
  return input.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid global value set value');
    const valueInput=item as Record<string,unknown>;
    inputKeys(valueInput,['value','label','active']);
    if(typeof valueInput.value!=='string')throw new Error('Invalid global value set value');
    const value=valueInput.value.trim();
    const label=valueInput.label===undefined?value:valueInput.label;
    const active=valueInput.active===undefined?true:valueInput.active;
    if(!value||value.length>512||typeof label!=='string'||!label.trim()||label.trim().length>120||
       typeof active!=='boolean'||seen.has(value.toLocaleLowerCase('en-US')))
      throw new Error('Invalid or duplicate global value set value');
    seen.add(value.toLocaleLowerCase('en-US'));
    return {value,label:label.trim(),active};
  });
};
const parseText=(value:unknown,max:number,field:string,required:boolean)=>{
  if(typeof value!=='string')throw new Error('Invalid global value set '+field);
  const trimmed=value.trim();
  if((required&&!trimmed)||trimmed.length>max)throw new Error('Invalid global value set '+field);
  return trimmed;
};
const parseApiName=(value:unknown)=>{
  const name=parseText(value,80,'API name',true);
  if(!apiNamePattern.test(name))throw new Error('Invalid global value set API name');
  return name;
};
const parseDescription=(value:unknown)=>parseText(value,4000,'description',false);
const parseCreate=(input:unknown):GlobalValueSetInput=>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid global value set');
  const data=input as Record<string,unknown>;
  inputKeys(data,['apiName','label','description','values']);
  return {
    apiName:parseApiName(data.apiName),
    label:parseText(data.label,120,'label',true),
    description:data.description===undefined?'':parseDescription(data.description),
    values:parseValues(data.values)
  };
};
const parseUpdate=(input:unknown):GlobalValueSetUpdate=>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid global value set update');
  const data=input as Record<string,unknown>;
  inputKeys(data,['apiName','label','description','values']);
  if(!Object.keys(data).length)throw new Error('Empty global value set update');
  const parsed: {apiName?:string;label?:string;description?:string;values?:GlobalValueSetValueInput[]}={};
  if('apiName' in data)parsed.apiName=parseApiName(data.apiName);
  if('label' in data)parsed.label=parseText(data.label,120,'label',true);
  if('description' in data)parsed.description=parseDescription(data.description);
  if('values' in data)parsed.values=parseValues(data.values);
  return parsed;
};
const asIso=(value:Date|string)=>new Date(value).toISOString();

export class GlobalValueSetService {
  constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}

  private async guard(actor:GlobalValueSetActor,action:'read'|'create'|'edit'|'delete'){
    if(!uuidPattern.test(actor.tenant_id)||!uuidPattern.test(actor.user_id))
      throw new Error('Invalid global value set actor');
    await this.rbac.require(actor.tenant_id,actor.user_id,'GlobalValueSet',action);
  }

  private async materialize(db:Executor,tenantId:string,rows:SetRow[]):Promise<GlobalValueSet[]>{
    if(!rows.length)return [];
    const values=await db.query<ValueRow>(`
      SELECT value_set_id,value,label,active,sort_order
      FROM md_global_value_set_values
      WHERE tenant_id=$1 AND value_set_id=ANY($2::uuid[])
      ORDER BY value_set_id,sort_order,value`,[tenantId,rows.map(row=>row.id)]);
    const grouped=new Map<string,GlobalValueSetValue[]>();
    for(const row of values.rows){
      const bucket=grouped.get(row.value_set_id)??[];
      bucket.push({value:row.value,label:row.label,active:row.active,sortOrder:Number(row.sort_order)});
      grouped.set(row.value_set_id,bucket);
    }
    return rows.map(row=>({
      id:row.id,apiName:row.api_name,label:row.label,description:row.description,
      values:grouped.get(row.id)??[],createdAt:asIso(row.created_at),updatedAt:asIso(row.updated_at)
    }));
  }

  private async insertValues(db:Executor,tenantId:string,id:string,values:readonly GlobalValueSetValueInput[]){
    for(let sortOrder=0;sortOrder<values.length;sortOrder++){
      const item=values[sortOrder];
      await db.query(`INSERT INTO md_global_value_set_values
        (tenant_id,value_set_id,value,label,sort_order,active) VALUES($1,$2,$3,$4,$5,$6)`,
        [tenantId,id,item.value,item.label??item.value,sortOrder,item.active??true]);
    }
  }

  async create(actor:GlobalValueSetActor,input:unknown):Promise<{valueSet:GlobalValueSet}>{
    await this.guard(actor,'create');
    const data=parseCreate(input);
    return this.db.transaction(async tx=>{
      await requireAvailableMetadataName(tx,actor.tenant_id,'globalValueSet',data.apiName);
      const created=await tx.query<SetRow>(`INSERT INTO md_global_value_sets
        (tenant_id,api_name,label,description) VALUES($1,$2,$3,$4)
        RETURNING id,api_name,label,description,created_at,updated_at`,
        [actor.tenant_id,data.apiName,data.label,data.description]);
      await this.insertValues(tx,actor.tenant_id,created.rows[0].id,data.values);
      await tx.query(`INSERT INTO md_global_value_set_audit
        (tenant_id,value_set_id,actor_id,action,api_name) VALUES($1,$2,$3,'create',$4)`,
        [actor.tenant_id,created.rows[0].id,actor.user_id,data.apiName]);
      return {valueSet:(await this.materialize(tx,actor.tenant_id,created.rows))[0]};
    });
  }

  async list(actor:GlobalValueSetActor):Promise<{valueSets:GlobalValueSet[]}>{
    await this.guard(actor,'read');
    const {rows}=await this.db.query<SetRow>(`SELECT id,api_name,label,description,created_at,updated_at
      FROM md_global_value_sets WHERE tenant_id=$1 ORDER BY api_name,id LIMIT 200`,[actor.tenant_id]);
    return {valueSets:await this.materialize(this.db,actor.tenant_id,rows)};
  }

  async update(actor:GlobalValueSetActor,id:string,input:unknown):Promise<{valueSet:GlobalValueSet}>{
    await this.guard(actor,'edit');
    if(!uuidPattern.test(id))throw new Error('Invalid global value set ID');
    const data=parseUpdate(input);
    return this.db.transaction(async tx=>{
      const current=await tx.query<SetRow>(`SELECT id,api_name,label,description,created_at,updated_at
        FROM md_global_value_sets WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[actor.tenant_id,id]);
      if(!current.rows[0])throw new Error('Global value set not found');
      const row=current.rows[0];
      if(data.apiName&&data.apiName!==row.api_name){
        const references=await tx.query(`SELECT 1 FROM md_field_global_value_sets
          WHERE tenant_id=$1 AND value_set_api=$2 LIMIT 1`,[actor.tenant_id,row.api_name]);
        if(references.rowCount)throw new Error('Cannot rename a Global Value Set referenced by fields');
      }
      if(data.values){
        const currentValues=await tx.query<{value:string}>(
          `SELECT v.value FROM md_global_value_set_values v
           JOIN md_global_value_sets s ON s.tenant_id=v.tenant_id AND s.id=v.value_set_id
           WHERE s.tenant_id=$1 AND s.id=$2`,[actor.tenant_id,id]);
        const nextValues=new Set(data.values.map(value=>value.value));
        const removed=currentValues.rows.map(value=>value.value).filter(value=>!nextValues.has(value));
        if(removed.length){
          const {rows:usedFields}=await tx.query<{object_api:string;field_api:string;data_type:string}>(`
            SELECT f.object_api,f.api_name AS field_api,f.data_type
            FROM md_field_global_value_sets g
            JOIN md_field_definitions f ON f.tenant_id=g.tenant_id
              AND f.object_api=g.object_api AND f.api_name=g.field_api
            WHERE g.tenant_id=$1 AND g.value_set_api=$2 AND f.deleted_at IS NULL`,
            [actor.tenant_id,row.api_name]);
          let inUse=false;
          for(const field of usedFields){
            const native=await loadNativeFields(tx,actor.tenant_id,field.object_api);
            const value=nativeValueSql(native,field.field_api,'nr',true);
            const comparison=field.data_type==='multipicklist'
              ?`string_to_array(${value},';') && $3::text[]`
              :`${value}=ANY($3::text[])`;
            const found=await tx.query(`SELECT 1 FROM ${nativeTableSql(native)} nr
              WHERE nr.tenant_id=$1 AND $2=ANY(nr.present_fields)
                AND (${comparison}) LIMIT 1`,
              [actor.tenant_id,field.field_api,removed]);
            if(found.rowCount){inUse=true;break;}
          }
          if(inUse)throw new Error('Cannot remove global values used by records');
        }
      }
      const updated=await tx.query<SetRow>(`UPDATE md_global_value_sets SET
        api_name=$3,label=$4,description=$5,updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING id,api_name,label,description,created_at,updated_at`,
        [actor.tenant_id,id,data.apiName??row.api_name,data.label??row.label,data.description??row.description]);
      if(data.values){
        await tx.query('DELETE FROM md_global_value_set_values WHERE tenant_id=$1 AND value_set_id=$2',[actor.tenant_id,id]);
        await this.insertValues(tx,actor.tenant_id,id,data.values);
      }
      await tx.query(`INSERT INTO md_global_value_set_audit
        (tenant_id,value_set_id,actor_id,action,api_name) VALUES($1,$2,$3,'update',$4)`,
        [actor.tenant_id,id,actor.user_id,updated.rows[0].api_name]);
      return {valueSet:(await this.materialize(tx,actor.tenant_id,updated.rows))[0]};
    });
  }

  async delete(actor:GlobalValueSetActor,id:string):Promise<{deleted:boolean}>{
    await this.guard(actor,'delete');
    if(!uuidPattern.test(id))throw new Error('Invalid global value set ID');
    return this.db.transaction(async tx=>{
      const found=await tx.query<{api_name:string}>(
        'SELECT api_name FROM md_global_value_sets WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[actor.tenant_id,id]);
      if(!found.rows[0])throw new Error('Global value set not found');
      const references=await tx.query(`SELECT 1 FROM md_field_global_value_sets
        WHERE tenant_id=$1 AND value_set_api=$2 LIMIT 1`,[actor.tenant_id,found.rows[0].api_name]);
      if(references.rowCount)throw new Error('Global Value Set is referenced by fields');
      const deleted=await tx.query(
        'DELETE FROM md_global_value_sets WHERE tenant_id=$1 AND id=$2',[actor.tenant_id,id]);
      if(!deleted.rowCount)throw new Error('Global value set not found');
      await tx.query(`INSERT INTO md_global_value_set_audit
        (tenant_id,value_set_id,actor_id,action,api_name) VALUES($1,$2,$3,'delete',$4)`,
        [actor.tenant_id,id,actor.user_id,found.rows[0].api_name]);
      return {deleted:true};
    });
  }
}
