import type {PoolClient} from 'pg';
import type {SqlPersistence} from './sql-persistence.js';

// Object Manager controls share the SQL metadata lifecycle and its transaction.
// The published Record Workspace only reads the loaded metadata.
export type CompactLayout = {id:string;label:string;fieldApiNames:string[]};
export type CompactLayoutAssignment = {profileId:string;recordTypeId:string;compactLayoutId:string};
export type ObjectLayoutControls = {
 compactLayouts:CompactLayout[];
 compactLayoutAssignments:CompactLayoutAssignment[];
 listViewButtons:string[];
};
const allowedButtons=['New','Change Owner','Import','Printable View'] as const;
const validId=(v:unknown):v is string =>
 typeof v==='string'&&v.length>0&&v.length<=128&&/^[A-Za-z0-9_*-]+$/.test(v);

export async function loadObjectLayoutControls(
 db:SqlPersistence, tenantId:string, objectApis:readonly string[]
):Promise<Map<string,ObjectLayoutControls>> {
 const result=new Map<string,ObjectLayoutControls>();
 if(!objectApis.length)return result;
 const [layouts,fields,assignments,buttons]=await Promise.all([
  db.query<{object_api:string;layout_id:string;label:string}>(
   'SELECT object_api,layout_id,label FROM md_object_compact_layouts WHERE tenant_id=$1 AND object_api=ANY($2::text[]) ORDER BY object_api,sort_order,layout_id',
   [tenantId,objectApis]),
  db.query<{object_api:string;layout_id:string;field_api:string}>(
   'SELECT object_api,layout_id,field_api FROM md_object_compact_layout_fields WHERE tenant_id=$1 AND object_api=ANY($2::text[]) ORDER BY object_api,layout_id,sort_order',
   [tenantId,objectApis]),
  db.query<{object_api:string;profile_id:string;record_type_id:string;layout_id:string}>(
   'SELECT object_api,profile_id,record_type_id,layout_id FROM md_object_compact_layout_assignments WHERE tenant_id=$1 AND object_api=ANY($2::text[]) ORDER BY object_api,profile_id,record_type_id',
   [tenantId,objectApis]),
  db.query<{object_api:string;button_name:string;enabled:boolean}>(
   'SELECT object_api,button_name,enabled FROM md_object_list_view_buttons WHERE tenant_id=$1 AND object_api=ANY($2::text[]) ORDER BY object_api,sort_order',
   [tenantId,objectApis])
 ]);
 const get=(objectApi:string)=>{
  let item=result.get(objectApi);
  if(!item){item={compactLayouts:[],compactLayoutAssignments:[],listViewButtons:[]};result.set(objectApi,item);}
  return item;
 };
 for(const row of layouts.rows)get(row.object_api).compactLayouts.push({
  id:row.layout_id,label:row.label,fieldApiNames:[]
 });
 for(const row of fields.rows){
  const layout=get(row.object_api).compactLayouts.find(item=>item.id===row.layout_id);
  if(layout)layout.fieldApiNames.push(row.field_api);
 }
 for(const row of assignments.rows)get(row.object_api).compactLayoutAssignments.push({
  profileId:row.profile_id,recordTypeId:row.record_type_id,compactLayoutId:row.layout_id
 });
 const configured=new Set<string>();
 for(const row of buttons.rows){
  configured.add(row.object_api);
  if(row.enabled)get(row.object_api).listViewButtons.push(row.button_name);
 }
 // Before an admin chooses list actions, preserve the legacy New button.
 for(const objectApi of objectApis){
  const current=get(objectApi);
  if(!configured.has(objectApi))current.listViewButtons=['New'];
 }
 return result;
}

export async function persistObjectLayoutControls(
 client:PoolClient, tenantId:string, objectApi:string, input:Record<string,unknown>,
 fieldNames:Set<string>
):Promise<void> {
 if(input.compactLayouts!==undefined||input.compactLayoutAssignments!==undefined){
  if(!Array.isArray(input.compactLayouts)||!Array.isArray(input.compactLayoutAssignments)
   ||input.compactLayouts.length>100||input.compactLayoutAssignments.length>1000)
   throw new Error('Invalid compact layout metadata');
  const layouts=input.compactLayouts as Record<string,unknown>[];
  const seen=new Set<string>();
  for(const layout of layouts){
   if(!layout||typeof layout!=='object'||Array.isArray(layout)
    ||!validId(layout.id)||seen.has(layout.id)
    ||typeof layout.label!=='string'||!layout.label.trim()||layout.label.length>200
    ||!Array.isArray(layout.fieldApiNames)||layout.fieldApiNames.length>20
    ||layout.fieldApiNames.some(v=>typeof v!=='string'||!fieldNames.has(v))
    ||new Set(layout.fieldApiNames).size!==layout.fieldApiNames.length)
    throw new Error('Invalid compact layout');
   seen.add(layout.id);
  }
  const assignments=input.compactLayoutAssignments as Record<string,unknown>[];
  const seenAssignments=new Set<string>();
  const recordTypes=await client.query<{record_type_id:string}>(
   'SELECT record_type_id FROM md_object_record_types WHERE tenant_id=$1 AND object_api=$2',
   [tenantId,objectApi]);
  const validRecordTypes=new Set(recordTypes.rows.map(row=>row.record_type_id));
  for(const assignment of assignments){
   if(!assignment||typeof assignment!=='object'||Array.isArray(assignment)
    ||!validId(assignment.profileId)||!validId(assignment.recordTypeId)
    ||!validId(assignment.compactLayoutId)||!seen.has(assignment.compactLayoutId)
    ||(assignment.recordTypeId!=='*'&&!validRecordTypes.has(assignment.recordTypeId)))
    throw new Error('Invalid compact layout assignment');
   const key=assignment.profileId+':'+assignment.recordTypeId;
   if(seenAssignments.has(key))throw new Error('Duplicate compact layout assignment');
   seenAssignments.add(key);
  }
  await client.query(
   'DELETE FROM md_object_compact_layouts WHERE tenant_id=$1 AND object_api=$2',
   [tenantId,objectApi]);
  for(const [order,layout] of layouts.entries()){
   await client.query(
    'INSERT INTO md_object_compact_layouts(tenant_id,object_api,layout_id,label,sort_order) VALUES($1,$2,$3,$4,$5)',
    [tenantId,objectApi,layout.id,(layout.label as string).trim(),order]);
   for(const [position,field] of (layout.fieldApiNames as string[]).entries())
    await client.query(
     'INSERT INTO md_object_compact_layout_fields(tenant_id,object_api,layout_id,field_api,sort_order) VALUES($1,$2,$3,$4,$5)',
     [tenantId,objectApi,layout.id,field,position]);
  }
  for(const assignment of assignments)await client.query(
   'INSERT INTO md_object_compact_layout_assignments(tenant_id,object_api,profile_id,record_type_id,layout_id) VALUES($1,$2,$3,$4,$5)',
   [tenantId,objectApi,assignment.profileId,assignment.recordTypeId,assignment.compactLayoutId]);
 }
 if(input.listViewButtons!==undefined){
  const buttons=input.listViewButtons;
  if(!Array.isArray(buttons)||buttons.some(b=>!allowedButtons.includes(b))
   ||new Set(buttons).size!==buttons.length)
   throw new Error('Invalid list view button configuration');
  await client.query('DELETE FROM md_object_list_view_buttons WHERE tenant_id=$1 AND object_api=$2',[tenantId,objectApi]);
  for(const [order,button] of allowedButtons.entries())await client.query(
   'INSERT INTO md_object_list_view_buttons(tenant_id,object_api,button_name,enabled,sort_order) VALUES($1,$2,$3,$4,$5)',
   [tenantId,objectApi,button,buttons.includes(button),order]);
 }
}
