import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {SystemDefinitionService} from '../system-files/system-definition-service.js';
const key=/^[A-Za-z][A-Za-z0-9_]*$/;
type C={id:string;title:string;type:string;objectApiName:string;
 aggregation:string;measureFieldApiName?:string|null;groupByFieldApiName?:string|null;
 displayFieldApiNames?:string[];reportApiName?:string;chartType?:string;
 chartSortOrder?:string;chartLimit?:number;[k:string]:unknown};
type F={objectApiName:string;fieldApiName:string;operator:string;value:string};
type D={apiName:string;ownerUserId?:string;visibility?:string;sharedUserIds?:string[];
 status?:string;filterLogic?:string;components:C[];filters?:F[]};
type Actor={tenant_id:string;user_id:string};
type Row=Record<string,unknown>;
export class DashboardSnapshotService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
  private readonly records:RecordEngine,private readonly definitions:SystemDefinitionService){}
 private async dashboard(actor:Actor,api:string):Promise<D>{
  if(!key.test(api))throw Error('Invalid dashboard');
  const definitions=await this.definitions.list(actor.tenant_id,actor.user_id,'dashboards');
  const value=definitions.find(x=>x.apiName===api) as D|undefined;
  if(!value||value.status!=='Deployed')throw Error('Dashboard unavailable');
  if(value.visibility!=='All Users'&&value.ownerUserId!==actor.user_id&&
    !(value.sharedUserIds??[]).includes(actor.user_id))throw Error('Permission denied');
  if(!Array.isArray(value.components)||value.components.length>40)throw Error('Invalid dashboard');
  return value;
 }
 private match(row:Row,f:F):boolean{
  const value=row[f.fieldApiName],text=String(value??'');
  switch(f.operator){
   case 'Equals':return text===f.value;
   case 'Not Equal To':return text!==f.value;
   case 'Contains':return text.toLowerCase().includes(f.value.toLowerCase());
   case 'Starts With':return text.toLowerCase().startsWith(f.value.toLowerCase());
   case 'Greater Than':return Number(value)>Number(f.value);
   case 'Less Than':return Number(value)<Number(f.value);
   case 'Is Null':return value===null||value===undefined||value==='';
   case 'Is Not Null':return value!==null&&value!==undefined&&value!=='';
   default:throw Error('Unsupported dashboard filter');
  }
 }
 private async recordsFor(actor:Actor,api:string):Promise<Row[]>{
  if(!key.test(api))throw Error('Invalid dashboard object');
  const first=await this.records.list(actor.tenant_id,actor.user_id,api,100,0);
  if(first.total>1000)throw Error('Snapshot row limit exceeded; narrow dashboard filters');
  const rows=[...first.records];
  for(let i=100;i<first.total;i+=100){
   const page=await this.records.list(actor.tenant_id,actor.user_id,api,100,i);
   rows.push(...page.records);
  }
  return rows;
 }
 private aggregate(rows:Row[],c:C):number{
  if(c.aggregation==='Count')return rows.length;
  const name=c.measureFieldApiName;
  if(!name||!key.test(name))throw Error('Invalid dashboard measure');
  const nums=rows.map(r=>Number(r[name])).filter(Number.isFinite);
  if(!nums.length)return 0;
  switch(c.aggregation){
   case 'Sum':return nums.reduce((a,b)=>a+b,0);
   case 'Average':return nums.reduce((a,b)=>a+b,0)/nums.length;
   case 'Minimum':return Math.min(...nums);
   case 'Maximum':return Math.max(...nums);
   default:throw Error('Unsupported dashboard aggregation');
  }
 }
 async create(actor:Actor,api:string,body:unknown){
  const dashboard=await this.dashboard(actor,api);
  await this.rbac.require(actor.tenant_id,actor.user_id,'SystemDefinition:dashboards','manage');
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid dashboard snapshot');
  const input=body as Record<string,unknown>;
  if(typeof input.label!=='string'||!input.label.trim()||input.label.length>200||
   !Array.isArray(input.filters)||input.filters.length>20||
   !Array.isArray(input.crossFilters)||input.crossFilters.length>0||
   !Array.isArray(input.customComponents)||input.customComponents.length>0||
   input.runningUserId!==undefined&&input.runningUserId!==actor.user_id)
    throw Error('Unsupported dashboard snapshot request');
  const filters=input.filters as F[];
  if(filters.some(f=>!f||typeof f!=='object'||!key.test(f.objectApiName)||
    !key.test(f.fieldApiName)||typeof f.value!=='string'||f.value.length>1000))
    throw Error('Invalid dashboard filters');
  const allFilters=[...(dashboard.filters??[]),...filters];
  const cache=new Map<string,Row[]>();
  const components:Record<string,unknown>[]=[];
  for(const c of dashboard.components){
   if(!c||!key.test(c.id)||!['Metric','Chart','Table','Rich Text','Image'].includes(c.type))
    throw Error('Unsupported snapshot component');
   if(c.reportApiName)throw Error('Report-driven snapshots require the published report runtime');
   const base:Record<string,unknown>={
    componentId:c.id,title:c.title,type:c.type,chartType:c.chartType??null,
    chartSortOrder:c.chartSortOrder??'Descending',chartLimit:c.chartLimit??10,
    aggregation:c.aggregation,gaugeMin:c.gaugeMin??0,gaugeMax:c.gaugeMax??100,
    gaugeRange1EndPercent:c.gaugeRange1EndPercent??33,gaugeRange2EndPercent:c.gaugeRange2EndPercent??66,
    showLegend:c.showLegend??true,showValues:c.showValues??true,
    objectApiName:c.objectApiName??'',groupByLabel:null,totalRows:0,metricValue:null,
    columns:[],buckets:[],rows:[]
   };
   for(const prop of ['subtitle','footer','width','height','chartColorPalette','chartXAxisMinimum',
    'chartXAxisMaximum','chartYAxisMinimum','chartYAxisMaximum','chartValueFormat','chartCurrencyCode',
    'chartDecimalPlaces','xAxisFieldApiName','xAxisTitle','yAxisTitle','chartDataLabelPosition',
    'showGridlines','legendPosition','richTextContent','imageUrl','imageAltText'])
    if(c[prop]!==undefined)base[prop]=c[prop];
   if(c.type!=='Rich Text'&&c.type!=='Image'){
    if(!key.test(c.objectApiName))throw Error('Invalid dashboard object');
    const referenced=[c.measureFieldApiName,c.groupByFieldApiName,...(c.displayFieldApiNames??[]),
      ...allFilters.filter(f=>f.objectApiName===c.objectApiName).map(f=>f.fieldApiName)]
      .filter((x):x is string=>typeof x==='string'&&Boolean(x));
    for(const field of new Set(referenced)){
     if(!key.test(field))throw Error('Invalid dashboard field');
     await this.rbac.require(actor.tenant_id,actor.user_id,c.objectApiName+'.'+field,'read');
    }
    if(!cache.has(c.objectApiName))cache.set(c.objectApiName,await this.recordsFor(actor,c.objectApiName));
    const matches=cache.get(c.objectApiName)!.filter(row=>{
     const scoped=allFilters.filter(f=>f.objectApiName===c.objectApiName);
     return dashboard.filterLogic==='Any'?scoped.some(f=>this.match(row,f)):scoped.every(f=>this.match(row,f));
    });
    base.sourceRecordIds=matches.map(row=>row.Id).filter((id):id is string=>typeof id==='string');
    base.sourceFieldApiNames=[...new Set(referenced)];
    base.totalRows=matches.length;
    base.metricValue=this.aggregate(matches,c);
    if(c.type==='Table'){
     const columns=c.displayFieldApiNames??[];
     if(columns.length>30)throw Error('Too many snapshot columns');
     base.columns=columns.map(apiName=>({apiName,label:apiName}));
     base.rows=matches.slice(0,100).map(row=>Object.fromEntries(columns.map(n=>[n,row[n]??null])));
    }else if(c.groupByFieldApiName){
     const buckets=new Map<string,Row[]>();
     for(const row of matches){
      const label=String(row[c.groupByFieldApiName]??'');
      if(!buckets.has(label))buckets.set(label,[]);
      buckets.get(label)!.push(row);
     }
     base.groupByLabel=c.groupByFieldApiName;
     base.buckets=[...buckets].map(([label,records])=>({label,value:this.aggregate(records,c)}))
      .sort((a,b)=>c.chartSortOrder==='Ascending'?a.value-b.value:b.value-a.value)
      .slice(0,Math.min(100,c.chartLimit??10));
    }
   }
   components.push(base);
  }
  const content={dashboardApiName:api,label:input.label.trim(),createdBy:actor.user_id,
   ...(input.runningUserId?{runningUserId:actor.user_id}:{}),filters,
   crossFilters:[],components};
  const {rows}=await this.db.query<{id:string;created_at:Date}>(`
    INSERT INTO md_dashboard_snapshots(tenant_id,dashboard_api,label,created_by,content)
    VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id,created_at`,
    [actor.tenant_id,api,content.label,actor.user_id,JSON.stringify(content)]);
  return {...content,components:this.publicComponents(components),id:rows[0].id,
   createdAt:rows[0].created_at.toISOString()};
 }
 private publicComponents(components:Record<string,unknown>[]):Record<string,unknown>[]{
  return components.map(component=>{
   const {sourceRecordIds:_sourceRecordIds,sourceFieldApiNames:_sourceFieldApiNames,...output}=component;
   return output;
  });
 }
 private async canReadSnapshot(actor:Actor,content:Record<string,unknown>):Promise<boolean>{
  if(!Array.isArray(content.components))return false;
  for(const component of content.components){
   if(!component||typeof component!=='object'||Array.isArray(component))return false;
   const c=component as Record<string,unknown>;
   if(!Array.isArray(c.sourceRecordIds))continue;
   if(typeof c.objectApiName!=='string'||!key.test(c.objectApiName))return false;
   const ids=[...new Set(c.sourceRecordIds)];
   if(ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))return false;
   try {
    await this.rbac.require(actor.tenant_id,actor.user_id,c.objectApiName,'read');
    const fields=c.sourceFieldApiNames;
    if(!Array.isArray(fields)||fields.some(f=>typeof f!=='string'||!key.test(f)))return false;
    for(const field of fields)await this.rbac.require(actor.tenant_id,actor.user_id,c.objectApiName+'.'+field,'read');
   }catch{return false;}
   if(ids.length){
    const {rows}=await this.db.query<{n:number}>(`
     SELECT count(*)::integer AS n FROM md_records WHERE tenant_id=$1 AND object_api=$2
       AND id=ANY($3::uuid[]) AND md_record_access($1,$4,id,'read')`,
      [actor.tenant_id,c.objectApiName,ids,actor.user_id]);
    if(rows[0]?.n!==ids.length)return false;
   }
  }
  return true;
 }
 async list(actor:Actor,api:string){
  await this.dashboard(actor,api);
  const {rows}=await this.db.query<{id:string;content:Record<string,unknown>;created_at:Date}>(`
   SELECT id,content,created_at FROM md_dashboard_snapshots
   WHERE tenant_id=$1 AND dashboard_api=$2 AND created_by=$3
   ORDER BY created_at DESC LIMIT 100`,[actor.tenant_id,api,actor.user_id]);
  const visible=[];
  for(const row of rows){
   if(!(await this.canReadSnapshot(actor,row.content)))continue;
   const components=this.publicComponents(row.content.components as Record<string,unknown>[]);
   visible.push({...row.content,components,id:row.id,createdAt:row.created_at.toISOString()});
  }
  return visible;
 }
 async remove(actor:Actor,api:string,id:string){
  await this.dashboard(actor,api);
  await this.rbac.require(actor.tenant_id,actor.user_id,'SystemDefinition:dashboards','manage');
  if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid snapshot ID');
  const {rowCount}=await this.db.query(`
   DELETE FROM md_dashboard_snapshots WHERE tenant_id=$1 AND dashboard_api=$2
     AND id=$3 AND created_by=$4`,[actor.tenant_id,api,id,actor.user_id]);
  if(!rowCount)throw Error('Snapshot not found');
 }
}
