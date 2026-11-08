import type {PoolClient} from 'pg';
/** The existing SQL rollup implementation, extracted verbatim from RecordEngine. */
export async function rollupParents(client:PoolClient,tenantId:string,childObject:string,recordId:string) {
    const {rows}=await client.query<{
      parent_object:string;relationship_field:string;
    }>(`SELECT object_api AS parent_object,rollup_relationship_field AS relationship_field
      FROM md_field_definitions WHERE tenant_id=$1 AND data_type='rollup'
        AND rollup_child_object=$2 AND deleted_at IS NULL`,
    [tenantId,childObject]);
    const parents=new Map<string,Set<string>>();
    const configs=rows.filter(config=>typeof config.parent_object==='string'
      &&typeof config.relationship_field==='string');
    if(!configs.length)return parents;
    const fields=[...new Set(configs.map(config=>config.relationship_field))];
    const values=await client.query<{field_api:string;reference_record_id:string|null}>(
      `SELECT field_api,reference_record_id FROM md_record_values
       WHERE tenant_id=$1 AND object_api=$2 AND record_id=$3 AND field_api=ANY($4::text[])`,
      [tenantId,childObject,recordId,fields]);
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
    const {rows}=await client.query<{
      parent_object:string;field_api:string;relationship_field:string;operation:string;source_field:string|null;
      source_data_type:string|null;filter_logic:string;
    }>(`SELECT object_api AS parent_object,api_name AS field_api,
        rollup_relationship_field AS relationship_field,rollup_operation AS operation,
        rollup_source_field AS source_field,rollup_filter_logic AS filter_logic,
        (SELECT s.data_type FROM md_field_definitions s
         WHERE s.tenant_id=md_field_definitions.tenant_id
           AND s.object_api=md_field_definitions.rollup_child_object
           AND s.api_name=md_field_definitions.rollup_source_field AND s.deleted_at IS NULL)
          AS source_data_type
      FROM md_field_definitions WHERE tenant_id=$1 AND data_type='rollup'
        AND rollup_child_object=$2 AND deleted_at IS NULL`,
    [tenantId,childObject]);
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
        const filterParams:unknown[]=[tenantId,childObject,rollup.relationship_field,
          rollup.source_field,parentId];
        const filterJoins:string[]=[];
        const filterPredicates:string[]=[];
        for(const [index,filter] of filters.entries()){
          const alias=`rf${index}`;
          const fieldParameter=`$${filterParams.length+1}`;
          filterParams.push(filter.field_api);
          filterJoins.push(`LEFT JOIN md_record_values ${alias}
            ON ${alias}.tenant_id=c.tenant_id AND ${alias}.record_id=c.id
              AND ${alias}.object_api=c.object_api AND ${alias}.field_api=${fieldParameter}`);
          const valueColumn:['value_text'|'value_number'|'value_boolean'|'value_date'|'value_datetime'|'reference_record_id'][number]=
            ['number','currency','percent'].includes(filter.data_type)?'value_number':
            filter.data_type==='boolean'?'value_boolean':filter.data_type==='date'?'value_date':
            filter.data_type==='datetime'?'value_datetime':filter.data_type==='reference'
              ?'reference_record_id':'value_text';
          if(filter.operator==='Is Null'||filter.operator==='Is Not Null'){
            filterPredicates.push(`${alias}.${valueColumn} IS ${filter.operator==='Is Null'?'':'NOT '}NULL`);
            continue;
          }
          const parameter=`$${filterParams.length+1}`;
          filterParams.push(filter.value_text);
          const cast=filter.data_type==='date'?'::date':filter.data_type==='datetime'?'::timestamptz':
            filter.data_type==='time'?'::time':filter.data_type==='boolean'?'::boolean':
            ['number','currency','percent'].includes(filter.data_type)?'::numeric':'';
          const operator=filter.operator==='Equals'?'=':filter.operator==='Not Equal To'?'IS DISTINCT FROM':
            filter.operator==='Greater Than'?'>':filter.operator==='Less Than'?'<':
            filter.operator==='Contains'?null:null;
          if(filter.operator==='Contains'){
            filterPredicates.push(`position(${parameter} in ${alias}.${valueColumn})>0`);
          }else if(operator){
            filterPredicates.push(`${alias}.${valueColumn} ${operator} ${parameter}${cast}`);
          }else throw new Error('Invalid roll-up filter operator');
        }
        const filterPredicate=filterPredicates.length
          ?` AND (${filterPredicates.join(rollup.filter_logic==='Any'?' OR ':' AND ')})`:'';
        const sourceType=rollup.source_data_type;
        const valueColumn=sourceType==='date'?'sv.value_date':
          sourceType==='datetime'?'sv.value_datetime':'sv.value_number';
        const aggregate=operation==='COUNT'?'count(*)::text':
          operation==='SUM'
            ?`COALESCE(sum(CASE WHEN sv.value_text ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN sv.value_number END),0)::text`
            :`${operation.toLowerCase()}(${valueColumn})::text`;
        const result=await client.query<{value:string|null}>(`
          SELECT ${aggregate} AS value
          FROM md_records c
          JOIN md_record_values rel ON rel.tenant_id=c.tenant_id AND rel.record_id=c.id
            AND rel.object_api=c.object_api AND rel.field_api=$3
          LEFT JOIN md_record_values sv
            ON sv.tenant_id=c.tenant_id AND sv.record_id=c.id AND sv.object_api=c.object_api
              AND sv.field_api=$4
          ${filterJoins.join('\n')}
          WHERE c.tenant_id=$1 AND c.object_api=$2 AND c.is_deleted=false AND rel.reference_record_id=$5${filterPredicate}
        `,filterParams);
        const value=result.rows[0]?.value??(operation==='COUNT'||operation==='SUM'?'0':null);
        const numericValue=sourceType==='date'||sourceType==='datetime'?null:value;
        const dateValue=sourceType==='date'?value:null;
        const dateTimeValue=sourceType==='datetime'?value:null;
        await client.query(`INSERT INTO md_record_values
          (tenant_id,record_id,object_api,field_api,value_text,reference_record_id,is_unique,case_sensitive,
           value_number,value_date,value_datetime)
          VALUES($1,$2,$3,$4,$5,NULL,false,false,$6::numeric,$7::date,$8::timestamptz)
          ON CONFLICT(tenant_id,record_id,field_api) DO UPDATE SET value_text=EXCLUDED.value_text,
            reference_record_id=NULL,geo_latitude=NULL,geo_longitude=NULL,address_street=NULL,
            address_city=NULL,address_state=NULL,address_postal_code=NULL,address_country=NULL,
            value_number=EXCLUDED.value_number,value_date=EXCLUDED.value_date,
            value_datetime=EXCLUDED.value_datetime,value_boolean=NULL`,
        [tenantId,parentId,rollup.parent_object,rollup.field_api,value,numericValue,dateValue,dateTimeValue]);
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
