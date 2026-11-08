import type {PoolClient} from 'pg';
import type {SqlPersistence} from './sql-persistence.js';

export type LookupFilterMetadata = {
 id:string;fieldApiName:string;relatedObject:string;relatedFieldApiName:string;
 operator:'Equals'|'Not Equal To'|'Contains'|'Starts With'|'Greater Than'|'Less Than'|'Is Null'|'Is Not Null';
 value:string;valueFieldApiName?:string;required:boolean;
};
export type LookupFilterControls = {
 relatedLookupFilters:LookupFilterMetadata[];
 relatedLookupFilterLogic:Record<string,'All'|'Any'>;
};
const operations=new Set<LookupFilterMetadata['operator']>([
 'Equals','Not Equal To','Contains','Starts With','Greater Than','Less Than','Is Null','Is Not Null'
]);
const apiName=(v:unknown):v is string =>
 typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(v)&&v.length<=128;

export async function loadObjectLookupFilters(
 db:SqlPersistence,tenantId:string,objectApis:readonly string[]
):Promise<Map<string,LookupFilterControls>>{
 const result=new Map<string,LookupFilterControls>();
 if(!objectApis.length)return result;
 const [filters,logic]=await Promise.all([
  db.query<{object_api:string;filter_id:string;field_api:string;related_object:string;
   related_field_api:string;operator:LookupFilterMetadata['operator'];value_text:string;
   value_field_api:string|null;required:boolean}>(`
    SELECT l.object_api,l.filter_id,l.field_api,f.related_object,l.related_field_api,
      l.operator,l.value_text,l.value_field_api,l.required
    FROM md_object_lookup_filters l JOIN md_field_definitions f
      ON f.tenant_id=l.tenant_id AND f.object_api=l.object_api AND f.api_name=l.field_api
    WHERE l.tenant_id=$1 AND l.object_api=ANY($2::text[])
    ORDER BY l.object_api,l.sort_order,l.filter_id`,[tenantId,objectApis]),
  db.query<{object_api:string;field_api:string;logic:'All'|'Any'}>(
   'SELECT object_api,field_api,logic FROM md_object_lookup_filter_logic WHERE tenant_id=$1 AND object_api=ANY($2::text[])',
   [tenantId,objectApis])
 ]);
 const get=(key:string)=>{
  let item=result.get(key);
  if(!item){item={relatedLookupFilters:[],relatedLookupFilterLogic:{}};result.set(key,item);}
  return item;
 };
 for(const row of filters.rows)get(row.object_api).relatedLookupFilters.push({
  id:row.filter_id,fieldApiName:row.field_api,relatedObject:row.related_object,
  relatedFieldApiName:row.related_field_api,operator:row.operator,value:row.value_text,
  ...(row.value_field_api?{valueFieldApiName:row.value_field_api}:{}),required:row.required
 });
 for(const row of logic.rows)get(row.object_api).relatedLookupFilterLogic[row.field_api]=row.logic;
 return result;
}

export async function persistObjectLookupFilters(
 client:PoolClient,tenantId:string,objectApi:string,input:Record<string,unknown>
):Promise<void>{
 if(input.relatedLookupFilters===undefined&&input.relatedLookupFilterLogic===undefined)return;
 if(!Array.isArray(input.relatedLookupFilters)||input.relatedLookupFilters.length>300
   ||!input.relatedLookupFilterLogic||typeof input.relatedLookupFilterLogic!=='object'
   ||Array.isArray(input.relatedLookupFilterLogic))throw Error('Invalid lookup filter configuration');
 const filters=input.relatedLookupFilters as Record<string,unknown>[];
 const logic=input.relatedLookupFilterLogic as Record<string,unknown>;
 const fields=await client.query<{api_name:string;data_type:string;related_object:string|null}>(
  'SELECT api_name,data_type,related_object FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND deleted_at IS NULL',
  [tenantId,objectApi]);
 const source=new Map(fields.rows.map(f=>[f.api_name,f]));
 const destinations=[...new Set(fields.rows.filter(f=>f.data_type==='reference'&&f.related_object).map(f=>f.related_object as string))];
 const targetFields=destinations.length?await client.query<{object_api:string;api_name:string;data_type:string}>(
  'SELECT object_api,api_name,data_type FROM md_field_definitions WHERE tenant_id=$1 AND object_api=ANY($2::text[]) AND deleted_at IS NULL',
  [tenantId,destinations]):{rows:[]};
 const targets=new Map(targetFields.rows.map(r=>[r.object_api+'.'+r.api_name,r.data_type]));
 const family=(type:string)=>['number','currency','percent'].includes(type)?'number':
   ['text','textarea','longtext','richtext','email','phone','url','picklist','autonumber'].includes(type)?'text':
   type==='reference'?'reference':type;

 const seen=new Set<string>();
 for(const row of filters){
  if(!row||typeof row!=='object'||Array.isArray(row)
    ||typeof row.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(row.id)
    ||seen.has(row.id)||!apiName(row.fieldApiName)||!apiName(row.relatedObject)
    ||!apiName(row.relatedFieldApiName)||!operations.has(row.operator as LookupFilterMetadata['operator'])
    ||typeof row.value!=='string'||row.value.length>1000||typeof row.required!=='boolean'
    ||(row.valueFieldApiName!==undefined&&!apiName(row.valueFieldApiName)))
    throw Error('Invalid lookup filter');
  const relation=source.get(row.fieldApiName);
  if(!relation||relation.data_type!=='reference'||relation.related_object!==row.relatedObject
    ||(!targets.has(row.relatedObject+'.'+row.relatedFieldApiName)&&row.relatedFieldApiName!=='Id')
    ||(row.valueFieldApiName&&!source.has(row.valueFieldApiName)))
    throw Error('Invalid lookup filter field reference');
  if((row.operator==='Is Null'||row.operator==='Is Not Null')
    &&(row.value!==''||row.valueFieldApiName!==undefined))
    throw Error('Invalid null lookup filter comparison');
  // Field-vs-field criteria must compare compatible value families. A text
  // literal remains supported by the existing canonical comparator.
  if(row.valueFieldApiName){
    const sourceType=source.get(row.valueFieldApiName)?.data_type;
    const targetType=row.relatedFieldApiName==='Id'?'reference':
      targets.get(row.relatedObject+'.'+row.relatedFieldApiName);
    if(!sourceType||!targetType||family(sourceType)!==family(targetType))
      throw Error('Lookup filter source and target field types are incompatible');
  }
  if(['Contains','Starts With'].includes(String(row.operator))){
    const targetType=row.relatedFieldApiName==='Id'?'reference':
      targets.get(row.relatedObject+'.'+row.relatedFieldApiName);
    if(!targetType||family(targetType)!=='text')
      throw Error('Text lookup operators require a text target field');
  }
  seen.add(row.id);
 }
 for(const [fieldApi,operator] of Object.entries(logic)){
  if(!apiName(fieldApi)||!filters.some(f=>f.fieldApiName===fieldApi)
    ||!['All','Any'].includes(String(operator)))throw Error('Invalid lookup filter logic');
 }
 // Entire metadata save runs in the Object Definition transaction. Validation
 // precedes all mutations, so bad drafts never partially replace good filters.
 await client.query('DELETE FROM md_object_lookup_filter_logic WHERE tenant_id=$1 AND object_api=$2',
   [tenantId,objectApi]);
 await client.query('DELETE FROM md_object_lookup_filters WHERE tenant_id=$1 AND object_api=$2',
   [tenantId,objectApi]);
 for(const [order,row] of filters.entries())await client.query(`
  INSERT INTO md_object_lookup_filters(tenant_id,object_api,filter_id,field_api,
    related_field_api,operator,value_text,value_field_api,required,sort_order)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [tenantId,objectApi,row.id,row.fieldApiName,row.relatedFieldApiName,row.operator,row.value,
   row.valueFieldApiName??null,row.required,order]);
 for(const [fieldApi,operator] of Object.entries(logic))await client.query(`
  INSERT INTO md_object_lookup_filter_logic(tenant_id,object_api,field_api,logic)
    VALUES($1,$2,$3,$4)`,[tenantId,objectApi,fieldApi,operator]);
}

export function compareLookupFilter(
 actualValue:unknown,expectedValue:unknown,operator:LookupFilterMetadata['operator']
):boolean{
 const nullValue=(v:unknown)=>v===null||v===undefined||v==='';
 if(operator==='Is Null')return nullValue(actualValue);
 if(operator==='Is Not Null')return !nullValue(actualValue);
 const actual=actualValue===undefined||actualValue===null?'':String(actualValue);
 const expected=expectedValue===undefined||expectedValue===null?'':String(expectedValue);
 if(operator==='Equals')return actual===expected;
 if(operator==='Not Equal To')return actual!==expected;
 if(operator==='Contains')return actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
 if(operator==='Starts With')return actual.toLocaleLowerCase().startsWith(expected.toLocaleLowerCase());
 const a=Number(actual),b=Number(expected);
 if(actual!==''&&expected!==''&&Number.isFinite(a)&&Number.isFinite(b))
  return operator==='Greater Than'?a>b:a<b;
 return operator==='Greater Than'?actual.localeCompare(expected)>0:actual.localeCompare(expected)<0;
}
