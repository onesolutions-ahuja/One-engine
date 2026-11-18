import type {PoolClient} from 'pg';

/**
 * Auto Number "Number separately for each <field>": one counter per value of a Lookup or
 * Picklist field on the same Object (Invoice by Location, Product by Product Group …), or
 * per combination of two such fields (Location + InvoiceType: INV and SRN series per shop).
 * {FieldName} in the format shows a field's value in the number ("{InvoiceType}-{0}").
 * Blank setting = one counter for the whole Object (unchanged behaviour). The counter is a
 * single atomic SQL upsert, so any number of users saving at once never get the same number.
 * An admin may move a counter forward (to continue an old system's numbers), never back.
 *
 * "Records can't be deleted" (per Object): delete is refused, so a numbered document stays
 * and is set to Cancelled instead.
 */
export const AUTO_NUMBER_SCOPE_DDL=`
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS auto_number_scope_field text;
CREATE TABLE IF NOT EXISTS md_auto_number_scoped_counters (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 object_api text NOT NULL,
 field_api text NOT NULL,
 scope_value text NOT NULL CHECK(length(scope_value) BETWEEN 1 AND 255),
 next_value bigint NOT NULL DEFAULT 1 CHECK(next_value > 0),
 PRIMARY KEY(tenant_id,object_api,field_api,scope_value),
 FOREIGN KEY(tenant_id,object_api,field_api)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
ALTER TABLE md_object_definitions ADD COLUMN IF NOT EXISTS prevent_delete boolean NOT NULL DEFAULT false;
`;

/** "Location" or "Location,InvoiceType": at most two fields split the series. */
export const AUTO_NUMBER_MAX_SCOPE_FIELDS=2;
export function autoNumberScopeFields(stored:string|null|undefined):string[]{
 return (stored??'').split(',').map(part=>part.trim()).filter(Boolean).slice(0,AUTO_NUMBER_MAX_SCOPE_FIELDS);
}
/** One series per combination of values; a blank value is its own series (∅). */
export function autoNumberSeriesKey(values:ReadonlyArray<unknown>):string{
 return values.map(value=>value===null||value===undefined||value===''?'\u2205':String(value)).join('|').slice(0,255);
}
/** {FieldName} in the format puts that field's value in the number: "{InvoiceType}-{0}" -> SRN-12.
 * {0…} (the running number) and {YYYY} are kept for formatAutoNumberValue. */
export function autoNumberFieldTokens(format:string,valueOf:(field:string)=>unknown):string{
 return format.replace(/\{([A-Za-z][A-Za-z0-9_]{0,79})\}/g,(token,name:string)=>{
  if(name==='YYYY')return token;
  const value=valueOf(name);
  return value===null||value===undefined?'':String(value).replace(/[{}]/g,'');
 });
}
/** Field types a series can be split by: one value per record, stable, chosen from a list. */
export const AUTO_NUMBER_SCOPE_TYPES=['reference','lookup','masterdetail','picklist'] as const;
export const autoNumberScopeTypeAllowed=(dataType:string)=>
 (AUTO_NUMBER_SCOPE_TYPES as readonly string[]).includes(dataType.toLowerCase().replace(/[^a-z]/g,''));

/** Take the next number of one series (atomic: concurrent saves get different numbers). */
export async function nextScopedAutoNumber(client:PoolClient,tenantId:string,objectApi:string,
 fieldApi:string,scopeValue:string):Promise<number>{
 const {rows}=await client.query<{sequence:string}>(`INSERT INTO md_auto_number_scoped_counters
   (tenant_id,object_api,field_api,scope_value,next_value) VALUES($1,$2,$3,$4,2)
   ON CONFLICT(tenant_id,object_api,field_api,scope_value)
   DO UPDATE SET next_value=md_auto_number_scoped_counters.next_value+1
   RETURNING (next_value-1)::text AS sequence`,[tenantId,objectApi,fieldApi,scopeValue]);
 const sequence=Number(rows[0]?.sequence);
 if(!Number.isSafeInteger(sequence)||sequence<1)throw Error('Unable to allocate auto-number value');
 return sequence;
}

/** Admin: the next number one series will give (forward only). Returns the number now set. */
export async function setScopedAutoNumberStart(client:PoolClient,tenantId:string,objectApi:string,
 fieldApi:string,scopeValue:string,next:number):Promise<number>{
 if(!Number.isSafeInteger(next)||next<1||next>9_000_000_000_000)throw Error('Next number must be a whole number above 0');
 if(!scopeValue||scopeValue.length>255)throw Error('Choose which value this number is for');
 const {rows}=await client.query<{next_value:string}>(`INSERT INTO md_auto_number_scoped_counters
   (tenant_id,object_api,field_api,scope_value,next_value) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(tenant_id,object_api,field_api,scope_value)
   DO UPDATE SET next_value=EXCLUDED.next_value WHERE md_auto_number_scoped_counters.next_value<=EXCLUDED.next_value
   RETURNING next_value::text`,[tenantId,objectApi,fieldApi,scopeValue,next]);
 if(!rows[0])throw Error('Numbers can only move forward: this series has already passed '+next);
 return Number(rows[0].next_value);
}
