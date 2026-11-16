import type {PoolClient} from 'pg';
export type RecordStoredValue={value_text:string|null;reference_record_id:string|null;
 value_number?:string|null;value_date?:string|null;value_datetime?:Date|null;value_boolean?:boolean|null;
 geo_latitude?:number|null;geo_longitude?:number|null;address_street?:string|null;address_city?:string|null;
 address_state?:string|null;address_postal_code?:string|null;address_country?:string|null;
 multi_values?:string[];is_unique:boolean;case_sensitive:boolean};
const slots=['value_text','reference_record_id','is_unique','case_sensitive','geo_latitude','geo_longitude',
 'address_street','address_city','address_state','address_postal_code','address_country','value_number',
 'value_date','value_datetime','value_boolean'];
/** One network statement for all scalar fields. Existing SQL constraints and all
 * BEFORE/AFTER triggers still execute, including the synchronous native store.
 */
export async function writeRecordValues(client:PoolClient,tenantId:string,objectApi:string,id:string,
 values:ReadonlyMap<string,RecordStoredValue>,update:boolean){
 const fields=[...values].filter(([name])=>!name.startsWith('__'));
 if(!fields.length)return;
 await client.query(`INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,${slots.join(',')})
  SELECT $1,$2,$3,v.field_api,${slots.map(s=>'v.'+s).join(',')}
  FROM jsonb_to_recordset($4::jsonb) AS v(field_api text,value_text text,reference_record_id uuid,
   is_unique boolean,case_sensitive boolean,geo_latitude double precision,geo_longitude double precision,
   address_street text,address_city text,address_state text,address_postal_code text,address_country text,
   value_number numeric,value_date date,value_datetime timestamptz,value_boolean boolean)
  ${update?`ON CONFLICT(tenant_id,record_id,field_api) DO UPDATE SET ${slots.map(s=>s+'=EXCLUDED.'+s).join(',')}`:''}`,
  [tenantId,id,objectApi,JSON.stringify(fields.map(([field_api,value])=>({field_api,...value})))]);
 const multiple=fields.filter(([,v])=>v.multi_values!==undefined);
 if(update&&multiple.length)await client.query(`DELETE FROM md_record_multi_values
  WHERE tenant_id=$1 AND record_id=$2 AND field_api=ANY($3::text[])`,[tenantId,id,multiple.map(([f])=>f)]);
 const selections=multiple.flatMap(([field_api,v])=>v.multi_values!.map((value,sort_order)=>({field_api,value,sort_order})));
 if(selections.length)await client.query(`INSERT INTO md_record_multi_values(tenant_id,record_id,object_api,field_api,value,sort_order)
  SELECT $1,$2,$3,v.field_api,v.value,v.sort_order FROM jsonb_to_recordset($4::jsonb) AS v(field_api text,value text,sort_order integer)`,
  [tenantId,id,objectApi,JSON.stringify(selections)]);
}
