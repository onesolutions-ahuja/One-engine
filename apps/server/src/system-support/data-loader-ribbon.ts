import {createHash} from 'node:crypto';
import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {readLoaderWorkbook,writeLoaderWorkbook,type LoaderTable} from './metadata-loader-xlsx.js';

type Actor={tenant_id:string;user_id:string};
type Req=Request & {actor?:Actor};
type Item={excelRow:number;cells:Record<string,string>;status:'Valid'|'Error'|'Success'|'Skipped';
 message:string;result:string;componentApi:string;propertyKey:string;enabled:boolean};
type InventoryRow={component_api:string;property_key:string;label:string;tab:string;section_group:string;
 default_enabled:boolean;override_enabled:boolean|null};
const columns=['Action','ComponentApi','PropertyKey','PropertyLabel','Tab','Section','Enabled','DefaultEnabled'];
const keyPattern=/^[A-Za-z][A-Za-z0-9_]*$/;
const val=(x:unknown)=>String(x??'').trim();
const parse=(input:unknown)=>{
 if(typeof input!=='string'||input.length>14_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(input))
  throw Error('Invalid Excel workbook');
 return Buffer.from(input,'base64');
};
const summary=(rows:Item[])=>({total:rows.length,valid:rows.filter(x=>x.status==='Valid').length,
 success:rows.filter(x=>x.status==='Success').length,error:rows.filter(x=>x.status==='Error').length,
 skipped:rows.filter(x=>x.status==='Skipped').length});
function report(source:LoaderTable,rows:Item[]){
 const original=source.columns.filter(c=>!['Status','Message','Result'].includes(c));
 const all:Record<string,string>[]=rows.map(row=>({...row.cells,ExcelRow:String(row.excelRow),Status:row.status,
  Message:row.message,Result:row.result}));
 const mini=['ExcelRow','Action','ComponentApi','PropertyKey','Enabled','Status','Result','Message'];
 const filtered=(subset:typeof all)=>subset.map(row=>Object.fromEntries(mini.map(c=>[c,row[c]??''])));
 return writeLoaderWorkbook([
  {name:'Smart Properties',columns:[...original,'Status','Result','Message'],rows:all},
  {name:'All Rows',columns:mini,rows:filtered(all)},
  {name:'Successful',columns:mini,rows:filtered(all.filter(x=>x.Status==='Success'))},
  {name:'Errors',columns:mini,rows:filtered(all.filter(x=>x.Status==='Error'))},
  {name:'Skipped',columns:mini,rows:filtered(all.filter(x=>x.Status==='Skipped'))}
 ]).toString('base64');
}
export function registerDataLoaderRibbonRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine){
 const route=(fn:(req:Req,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>
  void fn(req as Req,res).catch(next);
 const canRead=async(actor:Actor)=>{
  await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
  await rbac.require(actor.tenant_id,actor.user_id,'ComponentDefinition','read');
 };
 const canManage=async(actor:Actor)=>{
  await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
  await rbac.require(actor.tenant_id,actor.user_id,'ComponentDefinition','create');
 };
 const inventory=async(tenantId:string)=>{
  const {rows}=await db.query<InventoryRow>(
   'SELECT r.component_api,r.property_key,p.label,p.tab,p.section_group,'
   +'r.enabled AS default_enabled,v.enabled AS override_enabled '
   +'FROM md_builder_ribbon_component_rules r '
   +'JOIN md_builder_shared_properties p ON p.property_key=r.property_key '
   +'JOIN md_builder_ribbon_components c ON c.component_api=r.component_api '
   +'LEFT JOIN md_data_loader_ribbon_visibility v ON v.tenant_id=$1 '
   +'AND v.component_api=r.component_api AND v.property_key=r.property_key '
   +'ORDER BY r.component_api,p.sort_order',[tenantId]);
  return rows;
 };
 app.post('/api/data-loader/ribbon/export',route(async(req,res)=>{
  const actor=req.actor!;await canRead(actor);
  const component=val(req.body?.componentApi);
  if(component&&!keyPattern.test(component))throw Error('Invalid component API');
  const data=(await inventory(actor.tenant_id)).filter(r=>!component||component===r.component_api);
  if(component&&!data.length)throw Error('Component not registered in ribbon property library');
  if(data.length>10000)throw Error('Ribbon inventory exceeds workbook maximum');
  const rows=data.map(r=>({
   Action:'Upsert',ComponentApi:r.component_api,PropertyKey:r.property_key,
   PropertyLabel:r.label,Tab:r.tab,Section:r.section_group,
   Enabled:String(r.override_enabled??r.default_enabled).toUpperCase(),
   DefaultEnabled:String(r.default_enabled).toUpperCase()
  }));
  const workbook=writeLoaderWorkbook([{name:'Smart Properties',columns,rows}]);
  res.set('Cache-Control','private, no-store');
  res.json({workbook:workbook.toString('base64'),count:rows.length,
   filename:'Smart_Ribbon_Properties.xlsx'});
 }));
 const prepare=async(actor:Actor,buffer:Buffer)=>{
  await canRead(actor);await canManage(actor);
  const sheets=readLoaderWorkbook(buffer),table=sheets.find(x=>x.name==='Smart Properties');
  if(!table||!table.columns.includes('ComponentApi')||!table.columns.includes('PropertyKey')
   ||!table.columns.includes('Enabled')||!table.columns.includes('Action'))
   throw Error('Smart Properties requires Action, ComponentApi, PropertyKey and Enabled');
  if(table.rows.length>4000)throw Error('Maximum 4,000 ribbon property rows per upload');
  const byKey=new Map((await inventory(actor.tenant_id)).map(r=>[r.component_api+'|'+r.property_key,r]));
  const seen=new Set<string>();
  const rows:Item[]=table.rows.map((cells,i)=>({
   excelRow:Number(cells.__excelRow??i+2),cells,
   status:'Valid',message:'Ready',result:'',componentApi:val(cells.ComponentApi),
   propertyKey:val(cells.PropertyKey),enabled:val(cells.Enabled).toLowerCase()==='true'}));
  for(const row of rows)try{
   if(!['Upsert','Update'].includes(val(row.cells.Action)))throw Error('Action must be Upsert or Update');
   if(!keyPattern.test(row.componentApi)||!keyPattern.test(row.propertyKey))
    throw Error('Invalid component/property key');
   if(!/^(true|false)$/i.test(val(row.cells.Enabled)))throw Error('Enabled must be TRUE or FALSE');
   const id=row.componentApi+'|'+row.propertyKey;
   if(seen.has(id))throw Error('Duplicate component/property pair');
   seen.add(id);
   const existing=byKey.get(id);
   if(!existing)throw Error('Component/property pair is not registered in Smart Ribbon Library');
   if(row.cells.DefaultEnabled&&val(row.cells.DefaultEnabled).toLowerCase()!==String(existing.default_enabled))
    throw Error('DefaultEnabled is read-only; download current workbook');
   row.result=row.enabled?'Enable':'Disable';row.message='Validated';
  }catch(e){row.status='Error';row.message=e instanceof Error?e.message:String(e);}
  return {table,rows};
 };
 app.post('/api/data-loader/ribbon/validate',route(async(req,res)=>{
  const actor=req.actor!,buffer=parse(req.body?.workbook),data=await prepare(actor,buffer);
  res.set('Cache-Control','private, no-store');
  res.json({digest:createHash('sha256').update(buffer).digest('hex'),
   summary:summary(data.rows),rows:data.rows,report:report(data.table,data.rows)});
 }));
 app.post('/api/data-loader/ribbon/execute',route(async(req,res)=>{
  const actor=req.actor!,buffer=parse(req.body?.workbook);
  if(req.body?.digest!==createHash('sha256').update(buffer).digest('hex')
   ||req.body?.confirmation!=='PROCEED_EXCLUDING_ERRORS')
   throw Error('Validate the exact workbook and confirm execution');
  const data=await prepare(actor,buffer);
  for(const row of data.rows){
   if(row.status!=='Valid')continue;
   try{
    await canManage(actor);
    await db.transaction(async client=>{
     const existing=await client.query<{enabled:boolean}>(
      'SELECT COALESCE(v.enabled,r.enabled) AS enabled FROM md_builder_ribbon_component_rules r '
      +'LEFT JOIN md_data_loader_ribbon_visibility v ON v.tenant_id=$1 '
      +'AND v.component_api=r.component_api AND v.property_key=r.property_key '
      +'WHERE r.component_api=$2 AND r.property_key=$3 FOR UPDATE OF r',
      [actor.tenant_id,row.componentApi,row.propertyKey]);
     if(!existing.rows[0])throw Error('Ribbon property no longer exists');
     await client.query(
      'INSERT INTO md_data_loader_ribbon_visibility(tenant_id,component_api,property_key,enabled,changed_by) '
      +'VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,component_api,property_key) DO UPDATE '
      +'SET enabled=EXCLUDED.enabled,changed_by=EXCLUDED.changed_by,changed_at=now()',
      [actor.tenant_id,row.componentApi,row.propertyKey,row.enabled,actor.user_id]);
     if(existing.rows[0].enabled!==row.enabled)
      await client.query('INSERT INTO md_data_loader_ribbon_audit '
       +'(tenant_id,actor_user_id,component_api,property_key,previous_enabled,enabled) '
       +'VALUES($1,$2,$3,$4,$5,$6)',
       [actor.tenant_id,actor.user_id,row.componentApi,row.propertyKey,existing.rows[0].enabled,row.enabled]);
    });
    row.status='Success';row.message='Ribbon visibility updated';
   }catch(e){row.status='Error';row.message=e instanceof Error?e.message:String(e);}
  }
  res.set('Cache-Control','private, no-store');
  res.json({summary:summary(data.rows),rows:data.rows,report:report(data.table,data.rows)});
 }));
}
