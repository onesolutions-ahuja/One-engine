import type {PoolClient} from 'pg';
import {objectSetup,objectNativeFields} from '../system-files/object-save-setup.js';
import {nativeTableSql,nativeValueSql} from '../system-files/native-object-query.js';
import {writeNativeValues} from '../system-files/native-values.js';
/** The existing SQL rollup implementation, extracted verbatim from RecordEngine. */
export async function rollupParents(client:PoolClient,tenantId:string,childObject:string,recordId:string) {
    const {rows}=await objectSetup<{
      parent_object:string;relationship_field:string;
    }>(client,'rollup-parents',tenantId,childObject);
    const parents=new Map<string,Set<string>>();
    const configs=rows.filter(config=>typeof config.parent_object==='string'
      &&typeof config.relationship_field==='string');
    if(!configs.length)return parents;
    const fields=[...new Set(configs.map(config=>config.relationship_field))];
    const native=await objectNativeFields(client,tenantId,childObject);
    const slots=fields.map((field,index)=>
      `(${nativeValueSql(native,field,'nr')},$${index+3}::text)`).join(',');
    const values=await client.query<{field_api:string;reference_record_id:string|null}>(`
      SELECT found.field_api,found.reference_record_id
      FROM ${nativeTableSql(native)} nr
      JOIN LATERAL (VALUES ${slots}) AS found(reference_record_id,field_api) ON true
      WHERE nr.tenant_id=$1 AND nr.id=$2`,[tenantId,recordId,...fields]);
    const parentForField=new Map(configs.map(config=>[config.relationship_field,config.parent_object]));
    for(const value of values.rows){
      const parentObject=parentForField.get(value.field_api);
      if(!parentObject||!value.reference_record_id)continue;
      const ids=parents.get(parentObject)??new Set<string>();
      ids.add(value.reference_record_id);parents.set(parentObject,ids);
    }
    return parents;
  }
/** rollupParents for many records of one Object in one read (parents merged). */
export async function rollupParentsMany(client:PoolClient,tenantId:string,childObject:string,recordIds:readonly string[]) {
    const parents=new Map<string,Set<string>>();
    if(!recordIds.length)return parents;
    const {rows}=await objectSetup<{parent_object:string;relationship_field:string}>(client,'rollup-parents',tenantId,childObject);
    const configs=rows.filter(config=>typeof config.parent_object==='string'
      &&typeof config.relationship_field==='string');
    if(!configs.length)return parents;
    const fields=[...new Set(configs.map(config=>config.relationship_field))];
    const native=await objectNativeFields(client,tenantId,childObject);
    const slots=fields.map((field,index)=>
      `(${nativeValueSql(native,field,'nr')},$${index+3}::text)`).join(',');
    const values=await client.query<{field_api:string;reference_record_id:string|null}>(`
      SELECT found.field_api,found.reference_record_id
      FROM ${nativeTableSql(native)} nr
      JOIN LATERAL (VALUES ${slots}) AS found(reference_record_id,field_api) ON true
      WHERE nr.tenant_id=$1 AND nr.id=ANY($2::uuid[])`,[tenantId,[...recordIds],...fields]);
    const parentForField=new Map(configs.map(config=>[config.relationship_field,config.parent_object]));
    for(const value of values.rows){
      const parentObject=parentForField.get(value.field_api);
      if(!parentObject||!value.reference_record_id)continue;
      const ids=parents.get(parentObject)??new Set<string>();
      ids.add(value.reference_record_id);parents.set(parentObject,ids);
    }
    return parents;
  }
export async function refreshRollups(client:PoolClient,tenantId:string,childObject:string,
    parentIds:Map<string,Set<string>>,visited=new Set<string>(),depth=0) {
    if(!parentIds.size)return;
    if(depth>50)throw new Error('Roll-Up Summary nesting limit exceeded');
    const {rows}=await objectSetup<{
      parent_object:string;field_api:string;relationship_field:string;operation:string;source_field:string|null;
      source_data_type:string|null;filter_logic:string;
    }>(client,'rollups',tenantId,childObject);
    const native=await objectNativeFields(client,tenantId,childObject);
    const table=nativeTableSql(native);
    const rollups=rows.filter(rollup=>typeof rollup.parent_object==='string'
      &&typeof rollup.field_api==='string'&&typeof rollup.relationship_field==='string'
      &&typeof rollup.operation==='string');
    for(const rollup of rollups){
      for(const parentId of parentIds.get(rollup.parent_object)??[]){
        const operation=rollup.operation.toUpperCase();
        if(!['COUNT','SUM','MIN','MAX'].includes(operation))
          throw new Error('Invalid roll-up summary operation');
        if(operation!=='COUNT'&&!rollup.source_field)
          throw new Error('Roll-up summary source field is required');
        const {rows:filters}=await client.query<{
          field_api:string;operator:string;value_text:string;data_type:string;
        }>(`SELECT f.filter_field_api AS field_api,f.operator,f.value_text,d.data_type
          FROM md_field_rollup_filters f JOIN md_field_definitions d
            ON d.tenant_id=f.tenant_id AND d.object_api=f.child_object
              AND d.api_name=f.filter_field_api AND d.deleted_at IS NULL
          WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.rollup_field_api=$3
          ORDER BY f.sort_order`,[tenantId,rollup.parent_object,rollup.field_api]);
        const filterParams:unknown[]=[tenantId,childObject,parentId];
        const filterPredicates:string[]=[];
        for(const filter of filters){
          const typed=['number','currency','percent','boolean','date','datetime','reference'].includes(filter.data_type);
          const expression=nativeValueSql(native,filter.field_api,'n',!typed);
          if(filter.operator==='Is Null'||filter.operator==='Is Not Null'){
            filterPredicates.push(`${expression} IS ${filter.operator==='Is Null'?'':'NOT '}NULL`);
            continue;
          }
          filterParams.push(filter.value_text);
          const parameter=`$${filterParams.length}`;
          const cast=filter.data_type==='date'?'::date':filter.data_type==='datetime'?'::timestamptz':
            filter.data_type==='time'?'::time':filter.data_type==='boolean'?'::boolean':
            ['number','currency','percent'].includes(filter.data_type)?'::numeric':
            filter.data_type==='reference'?'::uuid':'';
          const operator=filter.operator==='Equals'?'=':filter.operator==='Not Equal To'?'IS DISTINCT FROM':
            filter.operator==='Greater Than'?'>':filter.operator==='Less Than'?'<':null;
          if(filter.operator==='Contains')
            filterPredicates.push(`position(${parameter} in ${expression})>0`);
          else if(operator)
            filterPredicates.push(`${expression} ${operator} ${parameter}${cast}`);
          else throw new Error('Invalid roll-up filter operator');
        }
        const filterPredicate=filterPredicates.length
          ?` AND (${filterPredicates.join(rollup.filter_logic==='Any'?' OR ':' AND ')})`:'';
        const sourceType=rollup.source_data_type;
        const relation=nativeValueSql(native,rollup.relationship_field,'n');
        const source=operation==='COUNT'?null:nativeValueSql(native,rollup.source_field!,'n');
        const aggregate=operation==='COUNT'?'count(*)::text':
          operation==='SUM'?`COALESCE(sum(${source}),0)::text`:
            `${operation.toLowerCase()}(${source})::text`;
        const result=await client.query<{value:string|null}>(`
          SELECT ${aggregate} AS value
          FROM md_records c JOIN ${table} n ON n.tenant_id=c.tenant_id AND n.id=c.id
          WHERE c.tenant_id=$1 AND c.object_api=$2 AND c.is_deleted=false AND NOT n.is_deleted
            AND ${relation}=$3${filterPredicate}
        `,filterParams);
        const value=result.rows[0]?.value??(operation==='COUNT'||operation==='SUM'?'0':null);
        const numericValue=sourceType==='date'||sourceType==='datetime'?null:value;
        const dateValue=sourceType==='date'?value:null;
        const dateTimeValue=sourceType==='datetime'?value:null;
        await writeNativeValues(client,tenantId,rollup.parent_object,parentId,new Map([[
          rollup.field_api,{value_text:value,reference_record_id:null,
            value_number:numericValue,value_date:dateValue,
            value_datetime:dateTimeValue===null?null:new Date(dateTimeValue),
            is_unique:false,case_sensitive:false}
        ]]));
        await client.query('UPDATE md_records SET updated_at=now() WHERE tenant_id=$1 AND object_api=$2 AND id=$3',
          [tenantId,rollup.parent_object,parentId]);
      }
    }
    const ancestorsByChild=new Map<string,Map<string,Set<string>>>();
    for(const [parentObject,ids] of parentIds)for(const parentId of ids){
      const visitKey=JSON.stringify([childObject,parentObject,parentId]);
      if(visited.has(visitKey))continue;
      visited.add(visitKey);
      const higher=await rollupParents(client,tenantId,parentObject,parentId);
      for(const [ancestorObject,ancestorIds] of higher){
        const ancestors=ancestorsByChild.get(parentObject)??new Map<string,Set<string>>();
        const collected=ancestors.get(ancestorObject)??new Set<string>();
        for(const ancestorId of ancestorIds)collected.add(ancestorId);
        ancestors.set(ancestorObject,collected);
        ancestorsByChild.set(parentObject,ancestors);
      }
    }
    for(const [parentObject,ancestors] of ancestorsByChild)
      await refreshRollups(client,tenantId,parentObject,ancestors,visited,depth+1);
  }
