import type {RbacEngine} from './rbac-engine.js';
import type {SqlExecutor,SqlPersistence} from './sql-persistence.js';

export type FlowRecordCondition = {
  field: unknown;
  operator: unknown;
  value?: unknown;
};

type FieldRow = {api_name:string;data_type:string};
type ValueRow = {
  id:string;created_at:Date;updated_at:Date;owner_id:string|null;record_type_id:string|null;
  field_api:string|null;value_text:string|null;reference_record_id:string|null;value_number:string|null;value_boolean:boolean|null;value_date:string|null;value_datetime:string|null;data_type:string|null;
};

function logicSql(logic:string|undefined,conditions:readonly string[]):string {
  if(!conditions.length)return 'TRUE';
  if(logic===undefined||logic==='All')return conditions.map(value=>'('+value+')').join(' AND ');
  if(logic==='Any')return conditions.map(value=>'('+value+')').join(' OR ');
  const tokens=logic.match(/\d+|AND|OR|\(|\)/gi);
  if(!tokens||tokens.join('').toLowerCase()!==logic.replace(/\s+/g,'').toLowerCase())
    throw new Error('Invalid Flow filter logic');
  let position=0;
  const atom=():string=>{
    const token=tokens[position++];
    if(token==='('){
      const nested=or();
      if(tokens[position++]!==')')throw new Error('Invalid Flow filter logic');
      return '('+nested+')';
    }
    if(!token||!/^\d+$/.test(token))throw new Error('Invalid Flow filter logic');
    const index=Number(token)-1;
    if(!Number.isSafeInteger(index)||index<0||index>=conditions.length)
      throw new Error('Flow filter logic references an unknown condition');
    return '('+conditions[index]+')';
  };
  const and=():string=>{
    let value=atom();
    while(tokens[position]?.toUpperCase()==='AND'){position++;value='('+value+' AND '+atom()+')';}
    return value;
  };
  const or=():string=>{
    let value=and();
    while(tokens[position]?.toUpperCase()==='OR'){position++;value='('+value+' OR '+and()+')';}
    return value;
  };
  const result=or();
  if(position!==tokens.length)throw new Error('Invalid Flow filter logic');
  return result;
}

export class FlowRecordQuery {
  constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine) {}

  async find(tenantId:string,userId:string,objectApi:string,
    conditions:readonly FlowRecordCondition[],conditionLogic?:string,
    options:{sortField?:string;sortOrder?:string;limit?:number;ownerScope?:'all'|'own'|'direct'|'descendants'}={},
    executor:SqlExecutor=this.db) {
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)||conditions.length>50)
      throw new Error('Invalid Flow record query');
    await this.rbac.require(tenantId,userId,objectApi,'read');
    const {rows:fields}=await executor.query<FieldRow>(
      'SELECT api_name,data_type FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2',
      [tenantId,objectApi]);
    const definitions=new Map(fields.map(field=>[field.api_name,field]));
    const params:unknown[]=[tenantId,objectApi,userId];
    const predicates:string[]=[];
    for(const item of conditions){
      if(!item||typeof item!=='object'||typeof item.field!=='string'
        ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(item.field))
        throw new Error('Invalid Flow filter field');
      const systemField=item.field==='Id'||item.field==='OwnerId';
      const field=systemField?undefined:definitions.get(item.field);
      if(!systemField&&!field)throw new Error('Unknown Flow filter field: '+item.field);
      if(field&&!await this.rbac.allowed(tenantId,userId,objectApi+'.'+field.api_name,'read'))
        throw new Error('Flow filter field is not readable: '+field.api_name);
      const operator=String(item.operator??'Equals').trim().toLowerCase().replace(/[\s_-]+/g,'');
      const valueExpression=item.field==='Id'?'r.id::text'
        :item.field==='OwnerId'?'COALESCE(r.owner_id,r.owner_queue_id)::text':`(
        SELECT COALESCE(v.value_text,v.reference_record_id::text,v.value_boolean::text,v.value_number::text,v.value_date::text,v.value_datetime::text)
        FROM md_record_values v
        WHERE v.tenant_id=r.tenant_id AND v.record_id=r.id AND v.object_api=r.object_api
          AND v.field_api=${'$'+(params.length+1)}
      )`;
      if(field)params.push(field.api_name);
      const expression=valueExpression;
      if(operator==='isnull'||operator==='isnotnull'){
        predicates.push(expression+(operator==='isnull'?' IS NULL':' IS NOT NULL'));
        continue;
      }
      if(!['equals','notequals','greaterthan','greaterthanorequalto','lessthan',
        'lessthanorequalto','contains','startswith','endswith','doesnotcontain','notcontains'].includes(operator))
        throw new Error('Unsupported Flow query operator: '+String(item.operator));
      const value=item.value;
      if(value===undefined||value===null){
        if(operator==='equals')predicates.push(expression+' IS NULL');
        else if(operator==='notequals')predicates.push(expression+' IS NOT NULL');
        else throw new Error('Flow query comparison requires a value');
        continue;
      }
      if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')
        throw new Error('Flow query values must be scalar');
      params.push(value);
      const valueParam='$'+params.length;
      if(['contains','startswith','endswith','doesnotcontain','notcontains'].includes(operator)){
        if(typeof value!=='string')throw new Error('Flow text query requires a text value');
        if(field&&!['text','email','phone','url','textarea','longtext','richtext',
          'picklist','multipicklist'].includes(field.data_type))
          throw new Error('Flow text query operator requires a text field');
        const textExpression=`lower(${expression})`;
        const searchParam='$'+params.length;
        params[params.length-1]=value.toLowerCase();
        predicates.push(operator==='contains'
          ?`strpos(${textExpression},${searchParam})>0`
          :operator==='startswith'
            ?`left(${textExpression},length(${searchParam}))=${searchParam}`
            :operator==='endswith'
              ?`right(${textExpression},length(${searchParam}))=${searchParam}`
              :`strpos(${textExpression},${searchParam})=0 AND ${textExpression} IS NOT NULL`);
      }else if(field&&['number','currency','percent'].includes(field.data_type)){
        if((typeof value!=='number'&&typeof value!=='string')
          ||! /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(String(value)))
          throw new Error('Invalid numeric Flow query value');
        const numeric=`CASE WHEN ${expression} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${expression}::numeric END`;
        const op={equals:'=',notequals:'<>',greaterthan:'>',greaterthanorequalto:'>=',
          lessthan:'<',lessthanorequalto:'<='}[operator]!;
        predicates.push(`${numeric} ${op} ${valueParam}::numeric`);
      }else{
        const op={equals:'=',notequals:'<>',greaterthan:'>',greaterthanorequalto:'>=',
          lessthan:'<',lessthanorequalto:'<='}[operator]!;
        predicates.push(`${expression} ${op} ${typeof value==='boolean'?valueParam+'::text':valueParam}`);
      }
    }
    const logic=logicSql(conditionLogic,predicates);
    const ownerScope=options.ownerScope??'all';
    if(!['all','own','direct','descendants'].includes(ownerScope))throw new Error('Invalid Flow owner scope');
    const ownerPredicate=ownerScope==='all'?'TRUE':ownerScope==='own'?'r.owner_id=$3':
      `r.owner_id IS NOT NULL AND md_reporting_scope($1,$3,r.owner_id,'${ownerScope}')`;
    const limit=options.limit===undefined?200:Number(options.limit);
    if(!Number.isSafeInteger(limit)||limit<1||limit>200)
      throw new Error('Flow record query limit must be between 1 and 200');
    let sort='r.created_at ASC,r.id ASC';
    if(options.sortField!==undefined){
      if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(options.sortField))throw new Error('Invalid Flow sort field');
      const systemSort=['Id','OwnerId','CreatedAt','LastModifiedDate'].includes(options.sortField);
      const sortField=systemSort?undefined:definitions.get(options.sortField);
      if(!systemSort&&!sortField)throw new Error('Unknown Flow sort field');
      if(sortField&&!await this.rbac.allowed(tenantId,userId,objectApi+'.'+sortField.api_name,'read'))
        throw new Error('Flow sort field is not readable');
      if(options.sortOrder!==undefined&&!['Ascending','Descending','asc','desc'].includes(options.sortOrder))
        throw new Error('Invalid Flow sort order');
      const direction=['Descending','desc'].includes(options.sortOrder??'')?'DESC':'ASC';
      sort=options.sortField==='Id'?`r.id ${direction}`:
        options.sortField==='OwnerId'?`COALESCE(r.owner_id,r.owner_queue_id) ${direction} NULLS LAST,r.id ASC`:
        options.sortField==='CreatedAt'?`r.created_at ${direction},r.id ASC`:
        options.sortField==='LastModifiedDate'?`r.updated_at ${direction},r.id ASC`:`(
        SELECT COALESCE(sv.value_text,sv.reference_record_id::text,sv.value_boolean::text,sv.value_number::text,sv.value_date::text,sv.value_datetime::text)
        FROM md_record_values sv
        WHERE sv.tenant_id=$1 AND sv.record_id=r.id AND sv.object_api=$2
          AND sv.field_api=${'$'+(params.length+1)}
      ) ${direction} NULLS LAST,r.id ASC`;
      if(sortField)params.push(sortField.api_name);
    }
    params.push(limit);
    const result=await executor.query<ValueRow>(`
      WITH matching AS (
        SELECT r.id,r.created_at,r.updated_at,COALESCE(r.owner_id,r.owner_queue_id) AS owner_id,
          r.record_type_id
        FROM md_records r
        WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false AND md_record_access($1,$3,r.id,'read')
          AND (${logic}) AND (${ownerPredicate})
        ORDER BY ${sort} LIMIT $${params.length}
      )
      SELECT m.id,m.created_at,m.updated_at,m.owner_id,m.record_type_id,
        v.field_api,v.value_text,v.reference_record_id,v.value_number,v.value_boolean,v.value_date,v.value_datetime,f.data_type
      FROM matching m
      LEFT JOIN md_record_values v ON v.tenant_id=$1 AND v.record_id=m.id AND v.object_api=$2
      LEFT JOIN md_field_definitions f ON f.tenant_id=$1 AND f.object_api=$2 AND f.api_name=v.field_api
      ORDER BY m.created_at,m.id,v.field_api
    `,params);
    const readableFields=[...new Set(result.rows.map(row=>row.field_api)
      .filter((field):field is string=>Boolean(field)&&field!=='OwnerId'))];
    const grants=await this.rbac.allowedMany(tenantId,userId,
      readableFields.map(field=>({resource:objectApi+'.'+field,action:'read'})));
    const readable=new Set(readableFields.filter((_field,index)=>grants[index]));
    const records=new Map<string,Record<string,unknown>>();
    for(const row of result.rows){
      if(!records.has(row.id))records.set(row.id,{Id:row.id,CreatedAt:row.created_at.toISOString(),
        LastModifiedDate:row.updated_at.toISOString(),OwnerId:row.owner_id,RecordTypeId:row.record_type_id});
      if(!row.field_api||row.field_api==='OwnerId'||!readable.has(row.field_api))continue;
      const value=row.reference_record_id??row.value_text??row.value_number??row.value_boolean??row.value_date??row.value_datetime;
      records.get(row.id)![row.field_api]=value===null?null:
        ['number','currency','percent'].includes(String(row.data_type))?Number(value):
          row.data_type==='boolean'?(value===true||value==='true'):value;
    }
    return [...records.values()];
  }
}
