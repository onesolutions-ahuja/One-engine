import type {PoolClient} from 'pg';
import type {SqlPersistence} from './sql-persistence.js';
import {encodeMetadataValue,decodeMetadataValues,type MetadataValueRow} from './component-runtime.js';

/** Draft history reuses the Component/Flow metadata value codec, without a JSON document column. */
/** Limit rollback to previously captured legacy layout metadata. Field definitions,
 * published Record Pages, current Record Types and settings are not in that snapshot. */
export function restorableObjectLayoutSnapshot(history:unknown,objectApi:string,currentLabel:string){
 if(!history||typeof history!=='object'||Array.isArray(history))
  throw new Error('Invalid historical layout snapshot');
 const saved=history as Record<string,unknown>;
 if(saved.apiName!==objectApi||!Array.isArray(saved.pageLayouts)
   ||saved.pageLayouts.length===0||!Array.isArray(saved.pageLayoutAssignments))
  throw new Error('Historical layout snapshot is incomplete');
 return {apiName:objectApi,label:currentLabel,
  pageLayouts:saved.pageLayouts,pageLayoutAssignments:saved.pageLayoutAssignments};
}

export class ObjectMetadataHistory {
 constructor(private readonly db:SqlPersistence){}
 static async capture(client:PoolClient,tenantId:string,objectApi:string,revision:number,
  actorUserId:string|undefined,after:Record<string,unknown>):Promise<void>{
  const encoded:Array<{path:string;kind:string;text:string|null}>=[];
  encodeMetadataValue(after,'/after',encoded);
  if(encoded.length>5000)throw new Error('Object metadata history exceeds allowed size');
  await client.query(`INSERT INTO md_object_metadata_history
   (tenant_id,object_api,revision,actor_user_id) VALUES($1,$2,$3,$4)`,[tenantId,objectApi,revision,actorUserId??null]);
  for(const entry of encoded){
   await client.query(`INSERT INTO md_object_metadata_history_values
     (tenant_id,object_api,revision,property_path,value_kind,value_text) VALUES($1,$2,$3,$4,$5,$6)`,
     [tenantId,objectApi,revision,entry.path,entry.kind,entry.text]);
  }
 }
 async list(tenantId:string,objectApi:string,limit=100){
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid history pagination');
  const {rows}=await this.db.query<{
   revision:number;action:string;actor_user_id:string|null;recorded_at:Date
  }>(`SELECT revision,action,actor_user_id,recorded_at FROM md_object_metadata_history
    WHERE tenant_id=$1 AND object_api=$2 ORDER BY revision DESC LIMIT $3`,
    [tenantId,objectApi,limit]);
  return rows.map(row=>({apiName:objectApi,revision:row.revision,action:row.action,
   actorUserId:row.actor_user_id??'',at:row.recorded_at,
   beforeRevision:row.revision>1?row.revision-1:null,afterRevision:row.revision}));
 }
 async revision(tenantId:string,objectApi:string,revision:number){
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Invalid metadata revision');
  const load=async(version:number)=>{
   const {rows}=await this.db.query<MetadataValueRow>(`
    SELECT property_path,value_kind,value_text FROM md_object_metadata_history_values
    WHERE tenant_id=$1 AND object_api=$2 AND revision=$3`,
    [tenantId,objectApi,version]);
   return rows.length?decodeMetadataValues(rows).after:undefined;
  };
  const after=await load(revision);
  if(!after)throw new Error('Metadata revision not found');
  const before=revision>1?await load(revision-1):undefined;
  return {revision,...(before?{before}:{}),after};
 }
}
