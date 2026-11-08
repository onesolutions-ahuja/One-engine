import type {PoolClient} from 'pg';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {compileRecordFilters,parseFilterLogic,type RecordFilter,type RecordFilterOperator} from '../system-files/record-query.js';

type Visibility='private'|'all'|'groups';
type Scope='my'|'all'|'my_team'|'queue';
export type PhoneColumnRole='title'|'subtitle'|'badge'|'trailing'|'hidden';
export type ViewInput={
  id?:string;label:string;visibility:Visibility;scope:Scope;
  columns:string[];phoneRoles?:Record<string,PhoneColumnRole>;filters:RecordFilter[];filterLogic?:string;
  sortField?:string;sortDirection?:'asc'|'desc';groupIds?:string[];
};
type ViewRow={id:string;object_api:string;owner_id:string;label:string;visibility:Visibility;scope:Scope;
  filter_logic:string;sort_field:string|null;sort_direction:'asc'|'desc';pinned:boolean};
const api=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scopes=new Set<Scope>(['my','all','my_team','queue']);
const visibilities=new Set<Visibility>(['private','all','groups']);
const operators=new Set<RecordFilterOperator>(['eq','ne','lt','lte','gt','gte','contains','startsWith','includes','excludes','in']);

export class RecordListViewService {
  constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine) {}
  /** Visual-only preferences. Never publish one user's widths to another user,
   * and always use OneEngine object READ before resolving tenant SQL rows. */
  async preferences(tenantId:string,userId:string,objectApi:string) {
    if(!api.test(objectApi))throw new Error('Invalid object name');
    await this.rbac.require(tenantId,userId,objectApi,'read');
    const {rows}=await this.db.query<{split_width_px:number;column_widths:Record<string,number>}>(`
      SELECT split_width_px,column_widths FROM md_record_view_preferences
      WHERE tenant_id=$1 AND user_id=$2 AND object_api=$3`,
    [tenantId,userId,objectApi]);
    return {splitWidthPx:rows[0]?.split_width_px??440,columnWidths:rows[0]?.column_widths??{}};
  }

  async savePreferences(tenantId:string,userId:string,objectApi:string,source:unknown) {
    if(!api.test(objectApi)||!source||typeof source!=='object'||Array.isArray(source))
      throw new Error('Invalid view preferences');
    await this.rbac.require(tenantId,userId,objectApi,'read');
    const input=source as Record<string,unknown>;
    if(Object.keys(input).some(key=>!['splitWidthPx','columnWidths'].includes(key)))
      throw new Error('Invalid view preferences');
    const splitWidthPx=input.splitWidthPx;
    const widths=input.columnWidths;
    if(typeof splitWidthPx!=='number'||!Number.isInteger(splitWidthPx)
      ||splitWidthPx<320||splitWidthPx>800||!widths||typeof widths!=='object'||Array.isArray(widths))
      throw new Error('Invalid view preferences');
    const columnWidths=widths as Record<string,unknown>;
    const entries=Object.entries(columnWidths);
    if(entries.length>50||entries.some(([name,width])=>!api.test(name)
      ||typeof width!=='number'||!Number.isInteger(width)||width<80||width>800))
      throw new Error('Invalid view preferences');
    for(const [name] of entries)
      await this.rbac.require(tenantId,userId,objectApi+'.'+name,'read');
    const {rows:fields}=await this.db.query<{api_name:string}>(`
      SELECT api_name FROM md_field_definitions WHERE tenant_id=$1
       AND object_api=$2 AND deleted_at IS NULL`,[tenantId,objectApi]);
    const available=new Set(fields.map(field=>field.api_name));
    if(entries.some(([name])=>!available.has(name)))
      throw new Error('Invalid view preference field');
    await this.db.query(`
      INSERT INTO md_record_view_preferences
        (tenant_id,user_id,object_api,split_width_px,column_widths)
      VALUES($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT(tenant_id,user_id,object_api) DO UPDATE SET
        split_width_px=EXCLUDED.split_width_px,
        column_widths=EXCLUDED.column_widths,updated_at=now()`,
    [tenantId,userId,objectApi,splitWidthPx,JSON.stringify(columnWidths)]);
    return {splitWidthPx,columnWidths};
  }


  async groups(tenantId:string,userId:string,objectApi:string) {
    await this.rbac.require(tenantId,userId,objectApi,'manage');
    const {rows}=await this.db.query<{id:string;api_name:string;label:string}>(`
      SELECT id,api_name,label FROM md_access_groups
      WHERE tenant_id=$1 AND kind='PublicGroup' ORDER BY label,id LIMIT 200`,
    [tenantId]);
    return rows;
  }

  private async visibleView(tenantId:string,userId:string,objectApi:string,id:string,client?:PoolClient) {
    const {rows}=await (client??this.db).query<ViewRow>(`
      SELECT v.id,v.object_api,v.owner_id,v.label,v.visibility,v.scope,v.filter_logic,
        v.sort_field,v.sort_direction,EXISTS(SELECT 1 FROM md_list_view_pins p
          WHERE p.tenant_id=v.tenant_id AND p.view_id=v.id AND p.user_id=$2) AS pinned
      FROM md_list_views v
      WHERE v.tenant_id=$1 AND v.object_api=$3 AND v.id=$4 AND (
        v.owner_id=$2 OR v.visibility='all' OR
        (v.visibility='groups' AND EXISTS(
          SELECT 1 FROM md_list_view_groups vg
          WHERE vg.tenant_id=v.tenant_id AND vg.view_id=v.id
            AND md_access_member(vg.tenant_id,$2,vg.group_id))))
    `,[tenantId,userId,objectApi,id]);
    return rows[0];
  }

  async list(tenantId:string,userId:string,objectApi:string) {
    await this.rbac.require(tenantId,userId,objectApi,'read');
    const {rows}=await this.db.query<ViewRow>(`
      SELECT v.id,v.object_api,v.owner_id,v.label,v.visibility,v.scope,v.filter_logic,
        v.sort_field,v.sort_direction,EXISTS(SELECT 1 FROM md_list_view_pins p
          WHERE p.tenant_id=v.tenant_id AND p.view_id=v.id AND p.user_id=$2) AS pinned
      FROM md_list_views v
      WHERE v.tenant_id=$1 AND v.object_api=$3 AND (
        v.owner_id=$2 OR v.visibility='all' OR
        (v.visibility='groups' AND EXISTS(
          SELECT 1 FROM md_list_view_groups vg
          WHERE vg.tenant_id=v.tenant_id AND vg.view_id=v.id
            AND md_access_member(vg.tenant_id,$2,vg.group_id))))
      ORDER BY pinned DESC,v.label,v.id LIMIT 100
    `,[tenantId,userId,objectApi]);
    return Promise.all(rows.map(row=>this.detail(tenantId,userId,row)));
  }

  private async detail(tenantId:string,userId:string,row:ViewRow,client?:PoolClient) {
    const query=client??this.db;
    const [columns,filters,groups]=await Promise.all([
      query.query<{field_api:string;phone_role:PhoneColumnRole|null}>(`SELECT field_api,phone_role FROM md_list_view_columns
        WHERE tenant_id=$1 AND view_id=$2 ORDER BY position`,[tenantId,row.id]),
      query.query<{position:number;field_api:string;operator:RecordFilterOperator;value_text:string}>(`
        SELECT position,field_api,operator,value_text FROM md_list_view_filters
        WHERE tenant_id=$1 AND view_id=$2 ORDER BY position`,[tenantId,row.id]),
      query.query<{group_id:string}>(`SELECT group_id FROM md_list_view_groups
        WHERE tenant_id=$1 AND view_id=$2 ORDER BY group_id`,[tenantId,row.id]),
    ]);
    const values=await query.query<{filter_position:number;value_text:string}>(`
      SELECT filter_position,value_text FROM md_list_view_filter_values
      WHERE tenant_id=$1 AND view_id=$2 ORDER BY filter_position,position`,[tenantId,row.id]);
    return {...row,columns:columns.rows.map(item=>item.field_api),
      phoneRoles:Object.fromEntries(columns.rows.filter(item=>item.phone_role).map(item=>[item.field_api,item.phone_role])),
      filters:filters.rows.map(filter=>({
        field:filter.field_api,operator:filter.operator,
        value:filter.operator==='in'?values.rows
          .filter(item=>item.filter_position===filter.position).map(item=>item.value_text)
          :filter.value_text})),
      groupIds:groups.rows.map(item=>item.group_id)};
  }

  async load(tenantId:string,userId:string,objectApi:string,id:string) {
    await this.rbac.require(tenantId,userId,objectApi,'read');
    if(!uuid.test(id))throw new Error('Invalid list view ID');
    const view=await this.visibleView(tenantId,userId,objectApi,id);
    if(!view)throw new Error('List view not found');
    return this.detail(tenantId,userId,view);
  }

  async save(tenantId:string,userId:string,objectApi:string,input:ViewInput) {
    await this.rbac.require(tenantId,userId,objectApi,'read');
    if(!api.test(objectApi)||!input||typeof input!=='object'||Array.isArray(input)
      ||typeof input.label!=='string'||!input.label.trim()||input.label.trim().length>120
      ||!visibilities.has(input.visibility)||!scopes.has(input.scope)
      ||!Array.isArray(input.columns)||input.columns.length>50
      ||!Array.isArray(input.filters)||input.filters.length>20
      ||(input.filterLogic!==undefined&&(typeof input.filterLogic!=='string'||input.filterLogic.length>256))
      ||(input.sortField!==undefined&&(typeof input.sortField!=='string'||!api.test(input.sortField)))
      ||(input.groupIds!==undefined&&(!Array.isArray(input.groupIds)||input.groupIds.length>100))
      ||(input.sortDirection!==undefined&&!['asc','desc'].includes(input.sortDirection))
      ||(input.phoneRoles!==undefined&&(!input.phoneRoles||typeof input.phoneRoles!=='object'||Array.isArray(input.phoneRoles))))
      throw new Error('Invalid list view');
    for(const filter of input.filters)
      if(!filter||typeof filter!=='object'||typeof filter.field!=='string'
        ||typeof filter.operator!=='string'||typeof filter.value!=='string'&&!Array.isArray(filter.value)
        ||Array.isArray(filter.value)&&filter.value.some(value=>typeof value!=='string'))
        throw new Error('Invalid list view filter');
    const groupIds=input.groupIds??[];
    if(new Set(groupIds).size!==groupIds.length||groupIds.some(id=>typeof id!=='string'||!uuid.test(id)))
      throw new Error('Invalid list view groups');
    if(input.visibility==='groups'&&!groupIds.length)throw new Error('Group views require at least one group');
    if(input.visibility!=='groups'&&groupIds.length)throw new Error('Groups are only valid for group views');
    if(input.visibility!=='private')await this.rbac.require(tenantId,userId,objectApi,'manage');
    const {rows:fieldRows}=await this.db.query<{api_name:string;data_type:string;rollup_source_data_type:string|null}>(`
      SELECT f.api_name,f.data_type,
        (SELECT source.data_type FROM md_field_definitions source
         WHERE source.tenant_id=f.tenant_id AND source.object_api=f.rollup_child_object
           AND source.api_name=f.rollup_source_field AND source.deleted_at IS NULL) AS rollup_source_data_type
      FROM md_field_definitions f
      WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.deleted_at IS NULL`,
    [tenantId,objectApi]);
    const fields=new Map(fieldRows.map(field=>[field.api_name,field]));
    const columns=[...new Set(input.columns)];
    for(const fieldApi of columns){
      if(!api.test(fieldApi)||!fields.has(fieldApi))throw new Error('Invalid list view column');
      await this.rbac.require(tenantId,userId,objectApi+'.'+fieldApi,'read');
    }
    const phoneRoles=input.phoneRoles??{};
    const validRoles=new Set<PhoneColumnRole>(['title','subtitle','badge','trailing','hidden']);
    if(Object.keys(phoneRoles).some(name=>!columns.includes(name)||!validRoles.has(phoneRoles[name]))
      ||['title','subtitle','badge','trailing'].some(role=>Object.values(phoneRoles).filter(value=>value===role).length>1)
      ||Object.values(phoneRoles).filter(role=>role!=='hidden').length>4)
      throw new Error('Invalid phone column roles');
    if(input.sortField!==undefined){
      if(!fields.has(input.sortField))throw new Error('Invalid list view sort field');
      await this.rbac.require(tenantId,userId,objectApi+'.'+input.sortField,'read');
    }
    for(const filter of input.filters){
      if(!filter||!fields.has(filter.field)||!operators.has(filter.operator))
        throw new Error('Invalid list view filter');
      await this.rbac.require(tenantId,userId,objectApi+'.'+filter.field,'read');
    }
    compileRecordFilters(input.filters,input.filterLogic,fields,1);
    if(input.id!==undefined&&!uuid.test(input.id))throw new Error('Invalid list view ID');
    return this.db.transaction(async client=>{
      let id=input.id;
      if(id){
        const {rows}=await client.query<{owner_id:string}>(`
          SELECT owner_id FROM md_list_views WHERE tenant_id=$1 AND object_api=$2 AND id=$3 FOR UPDATE`,
        [tenantId,objectApi,id]);
        if(!rows[0])throw new Error('List view not found');
        if(rows[0].owner_id!==userId)await this.rbac.require(tenantId,userId,objectApi,'manage');
        await client.query(`UPDATE md_list_views SET label=$4,visibility=$5,scope=$6,
          filter_logic=$7,sort_field=$8,sort_direction=$9,updated_at=now()
          WHERE tenant_id=$1 AND object_api=$2 AND id=$3`,
        [tenantId,objectApi,id,input.label.trim(),input.visibility,input.scope,input.filterLogic??'',
          input.sortField??null,input.sortDirection??'asc']);
        await client.query('DELETE FROM md_list_view_columns WHERE tenant_id=$1 AND view_id=$2',[tenantId,id]);
        await client.query('DELETE FROM md_list_view_filters WHERE tenant_id=$1 AND view_id=$2',[tenantId,id]);
        await client.query('DELETE FROM md_list_view_groups WHERE tenant_id=$1 AND view_id=$2',[tenantId,id]);
      }else{
        const {rows}=await client.query<{id:string}>(`
          INSERT INTO md_list_views(tenant_id,object_api,owner_id,label,visibility,scope,filter_logic,sort_field,sort_direction)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tenantId,objectApi,userId,input.label.trim(),input.visibility,input.scope,input.filterLogic??'',
          input.sortField??null,input.sortDirection??'asc']);
        id=rows[0].id;
      }
      for(const [position,fieldApi] of columns.entries())
        await client.query(`INSERT INTO md_list_view_columns(tenant_id,view_id,position,field_api,phone_role)
          VALUES($1,$2,$3,$4,$5)`,[tenantId,id,position,fieldApi,phoneRoles[fieldApi]??null]);
      for(const [position,filter] of input.filters.entries()){
        const filterValues=Array.isArray(filter.value)?filter.value:[];
        const valueText=typeof filter.value==='string'?filter.value:'';
        await client.query(`INSERT INTO md_list_view_filters
          (tenant_id,view_id,position,field_api,operator,value_text) VALUES($1,$2,$3,$4,$5,$6)`,
        [tenantId,id,position,filter.field,filter.operator,valueText]);
        for(const [valuePosition,value] of filterValues.entries())
          await client.query(`INSERT INTO md_list_view_filter_values
            (tenant_id,view_id,filter_position,position,value_text) VALUES($1,$2,$3,$4,$5)`,
          [tenantId,id,position,valuePosition,value]);
      }
      for(const groupId of groupIds){
        const group=await client.query(`SELECT 1 FROM md_access_groups
          WHERE tenant_id=$1 AND id=$2 AND kind='PublicGroup'`,[tenantId,groupId]);
        if(!group.rowCount)throw new Error('Invalid list view group');
        await client.query(`INSERT INTO md_list_view_groups(tenant_id,view_id,group_id)
          VALUES($1,$2,$3)`,[tenantId,id,groupId]);
      }
      const view=await this.visibleView(tenantId,userId,objectApi,id,client);
      if(!view)throw new Error('Saved list view is not visible to its owner');
      return this.detail(tenantId,userId,view,client);
    });
  }

  async remove(tenantId:string,userId:string,objectApi:string,id:string) {
    if(!uuid.test(id))throw new Error('Invalid list view ID');
    const {rows}=await this.db.query<{owner_id:string}>(`
      SELECT owner_id FROM md_list_views WHERE tenant_id=$1 AND object_api=$2 AND id=$3`,
    [tenantId,objectApi,id]);
    if(!rows[0])throw new Error('List view not found');
    if(rows[0].owner_id!==userId)await this.rbac.require(tenantId,userId,objectApi,'manage');
    const result=await this.db.query('DELETE FROM md_list_views WHERE tenant_id=$1 AND id=$2',[tenantId,id]);
    if(!result.rowCount)throw new Error('List view not found');
  }

  async pin(tenantId:string,userId:string,objectApi:string,id:string,pinned:boolean) {
    if(!uuid.test(id)||typeof pinned!=='boolean')throw new Error('Invalid list view pin');
    await this.rbac.require(tenantId,userId,objectApi,'read');
    if(!await this.visibleView(tenantId,userId,objectApi,id))throw new Error('List view not found');
    if(pinned)await this.db.query(`INSERT INTO md_list_view_pins(tenant_id,user_id,view_id)
      VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id,view_id) DO NOTHING`,[tenantId,userId,id]);
    else await this.db.query(`DELETE FROM md_list_view_pins
      WHERE tenant_id=$1 AND user_id=$2 AND view_id=$3`,[tenantId,userId,id]);
  }
}
