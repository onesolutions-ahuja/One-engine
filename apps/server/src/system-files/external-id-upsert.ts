import type {PoolClient} from 'pg';
import type {SqlPersistence} from './sql-persistence.js';
import type {RbacEngine} from './rbac-engine.js';
import type {RecordEngine} from './record-engine.js';
import {normalizeNumberField} from '../field-engine/types/NumberField.js';
/** Atomic external-ID lookup and write, sharing the generic record CRUD engine. */
export class ExternalIdUpsert {
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
   private readonly records:RecordEngine){}
 async execute(tenantId:string,userId:string,objectApi:string,fieldApi:string,key:string,
   values:Record<string,unknown>) {
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldApi)
    ||!key||key.length>255||Object.getPrototypeOf(values)!==Object.prototype)
    throw new Error('Invalid external ID upsert');
  return this.db.transaction(async(client:PoolClient)=>{
   const field=await client.query<{case_sensitive:boolean;data_type:string;precision:number|null;scale:number|null}>(
    `SELECT case_sensitive,data_type,precision,scale FROM md_field_definitions WHERE tenant_id=$1
     AND object_api=$2 AND api_name=$3 AND external_id=true AND deleted_at IS NULL`,
    [tenantId,objectApi,fieldApi]);
   if(!field.rows.length||!['text','email','phone','url','number','currency','percent'].includes(field.rows[0].data_type))
     throw new Error('Invalid external ID field');
   const definition=field.rows[0];
   const numeric=['number','currency','percent'].includes(definition.data_type);
   const normalizedKey=numeric
     ?normalizeNumberField(Number(key),fieldApi,definition.precision,definition.scale):key;
   const caseSensitive=numeric||definition.case_sensitive;
   const supplied=values[fieldApi];
   if(supplied!==undefined&&(numeric
     ?typeof supplied!=='number'||!Number.isFinite(supplied)
       ||normalizeNumberField(supplied,fieldApi,definition.precision,definition.scale)!==normalizedKey
     :typeof supplied!=='string'||(caseSensitive
       ?supplied!==normalizedKey:supplied.toLowerCase()!==normalizedKey.toLowerCase())))
     throw new Error('External ID path and payload mismatch');
   // Serialize equal keys (including absent keys) without locking unrelated tenant keys.
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [tenantId+':'+objectApi+':'+fieldApi+':'+(caseSensitive?normalizedKey:normalizedKey.toLowerCase())]);
   const {rows}=await client.query<{id:string}>(`SELECT r.id FROM md_records r
    JOIN md_record_values v ON v.tenant_id=r.tenant_id AND v.object_api=r.object_api
      AND v.record_id=r.id AND v.field_api=$3
    WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false
      AND ${caseSensitive?'v.value_text=$4':'lower(v.value_text)=lower($4)'}
    ORDER BY r.id LIMIT 2`,[tenantId,objectApi,fieldApi,normalizedKey]);
   if(rows.length>1)throw new Error('Duplicate external ID matches');
   const payload={...values,[fieldApi]:numeric?Number(normalizedKey):normalizedKey};
   if(rows.length){
    await this.rbac.require(tenantId,userId,objectApi,'edit');
    await this.rbac.requireRecord(tenantId,userId,objectApi,rows[0].id,'edit');
    await this.records.updateWithTriggersInTransaction(client,tenantId,userId,objectApi,rows[0].id,payload);
    return {id:rows[0].id,created:false};
   }
   await this.rbac.require(tenantId,userId,objectApi,'create');
   const id=await this.records.createWithTriggersInTransaction(client,tenantId,userId,objectApi,payload);
   return {id,created:true};
  });
 }
}
