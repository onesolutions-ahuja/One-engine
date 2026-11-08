import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
type Actor={tenant_id:string;user_id:string};
const name=/^[A-Za-z][A-Za-z0-9_]*$/;
type Report={apiName:string;label:string;objectApiName:string;fieldApiNames:string[];format:string;
 filters?:unknown[];crossFilters?:unknown[];groupByFieldApiNames?:string[];summaryOperations?:Record<string,unknown>;
 standardFilters?:{showMe?:string;dateRange?:string};rowLimit?:{limit:number|null};
};
export class SqlReportRuntime {
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,private readonly records:RecordEngine){}
 async run(actor:Actor,definition:unknown,request:unknown){
  await this.rbac.require(actor.tenant_id,actor.user_id,'SystemDefinition:reports','read');
  if(!definition||typeof definition!=='object'||Array.isArray(definition))throw new Error('Invalid report');
  const report=definition as Report;
  if(typeof report.objectApiName!=='string'||!name.test(report.objectApiName)
    ||!Array.isArray(report.fieldApiNames)||report.fieldApiNames.length>100
    ||report.fieldApiNames.some(f=>typeof f!=='string'||!name.test(f)))
    throw new Error('Invalid report definition');
  await this.rbac.require(actor.tenant_id,actor.user_id,report.objectApiName,'read');
  if(!request||typeof request!=='object'||Array.isArray(request))throw new Error('Invalid report request');
  const input=request as Record<string,unknown>;
  const unsupported=['dashboardFilters','dashboardCrossFilters','reportFilterOverrides'].some(k=>
    Array.isArray(input[k])&&(input[k] as unknown[]).length>0);
  if(report.format!=='Tabular'||report.filters?.length||report.crossFilters?.length||
     report.groupByFieldApiNames?.length||Object.keys(report.summaryOperations??{}).length||
     (report.standardFilters?.showMe&&!['All','My','My Descendants'].includes(report.standardFilters.showMe))||
     (report.standardFilters?.dateRange&&report.standardFilters.dateRange!=='All Time')||
     report.rowLimit?.limit!=null||unsupported||input.dashboardApiName||input.dashboardRunningUserId)
    throw new Error('Unsupported report configuration in SQL runtime');
  const {rows:defined}=await this.db.query<{api_name:string}>(
   'SELECT api_name FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2',
   [actor.tenant_id,report.objectApiName]);
  const valid=new Set(defined.map(x=>x.api_name));
  for(const field of report.fieldApiNames)if(!valid.has(field))throw new Error('Unknown field: '+field);
  const offset=input.offset===undefined?0:input.offset,limit=input.limit===undefined?100:input.limit;
  if(typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0||
     typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw new Error('Invalid pagination');
  // Scope is evaluated by the same Record Engine used by ordinary CRUD/Flows.
  const showMe=report.standardFilters?.showMe??'All';
  const scope=showMe==='My'?'my':showMe==='My Descendants'?'my_team':undefined;
  const rawContext=input.recordContext;
  if(rawContext!==undefined&&(!rawContext||typeof rawContext!=='object'||Array.isArray(rawContext)))
    throw new Error('Invalid report record context');
  const context=rawContext as {objectApiName?:unknown;recordId?:unknown;relationshipFieldApiName?:unknown}|undefined;
  if(context&&(typeof context.objectApiName!=='string'||!name.test(context.objectApiName)
    ||typeof context.recordId!=='string'
    ||(context.relationshipFieldApiName!==undefined
      &&(typeof context.relationshipFieldApiName!=='string'||!name.test(context.relationshipFieldApiName)))))
    throw new Error('Invalid report record context');
  if(context&&scope)throw new Error('Record-scoped reports cannot override owner filters');
  let values:{records:Record<string,unknown>[];total:number};
  if(context&&report.objectApiName===context.objectApiName&&!context.relationshipFieldApiName){
    // For a report on the same Object, only the authorised current record
    // participates. get() applies sharing, object and field permissions.
    const record=await this.records.get(actor.tenant_id,actor.user_id,
      report.objectApiName,context.recordId as string);
    values={records:offset===0?[record]:[],total:1};
  }else if(context){
    if(!context.relationshipFieldApiName)
      throw new Error('Select the related-record field for this report chart');
    // The shared record engine checks the parent record and the lookup target.
    const related=await this.records.list(actor.tenant_id,actor.user_id,
      report.objectApiName,limit,offset,{
        relatedField:context.relationshipFieldApiName as string,
        relatedId:context.recordId as string
      });
    values={records:related.records,total:related.total};
  }else{
    const listed=await this.records.list(actor.tenant_id,actor.user_id,
      report.objectApiName,limit,offset,{scope});
    values={records:listed.records,total:listed.total};
  }
  const visible=new Map<string,boolean>();
  for(const field of report.fieldApiNames)visible.set(field,
    await this.rbac.allowed(actor.tenant_id,actor.user_id,report.objectApiName+'.'+field,'read'));
  const rows=values.records.map(row=>{
    const projected:Record<string,unknown>={};
    for(const field of report.fieldApiNames)if(visible.get(field))projected[field]=row[field]??null;
    return projected;
  });
  return {report,rows,summaryRows:[],subtotalRows:[],
   summaryTotals:{rowCount:values.total,sums:{},counts:{},minimums:{},maximums:{}},
   totalRows:values.total,offset,pageSize:limit,truncated:offset+rows.length<values.total,
   generatedAt:new Date().toISOString()};
 }
 async stored(actor:Actor,apiName:string,input:unknown){
  if(!name.test(apiName))throw new Error('Invalid report name');
  await this.rbac.require(actor.tenant_id,actor.user_id,'SystemDefinition:reports','read');
  const {rows}=await this.db.query<{api_name:string;label:string;properties:Record<string,unknown>}>(
   "SELECT api_name,label,properties FROM md_system_definitions WHERE tenant_id=$1 AND kind='reports' AND api_name=$2 AND enabled=true",
   [actor.tenant_id,apiName]);
  if(!rows[0])throw new Error('Report not found');
  return this.run(actor,{...rows[0].properties,apiName:rows[0].api_name,label:rows[0].label},input);
 }
}
