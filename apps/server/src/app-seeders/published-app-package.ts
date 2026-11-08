import type {PoolClient} from 'pg';

/** Transactional, non-destructive materialisation of published SQL application templates.
 * Only this tenant's chosen package is inspected; nothing app-specific runs at startup.
 */
export async function seedPublishedAppPackage(
  client:PoolClient,tenantId:string,appId:string,version:number
):Promise<void> {
  const created=async(kind:'Object'|'Field'|'Component'|'App Page'|'Page Component',
    parent:string,key:string,sql:string,args:unknown[])=>{
    const {rows:receipts}=await client.query<{resource_type:string}>(`
      SELECT resource_type FROM md_app_package_seed_receipts
      WHERE tenant_id=$1 AND app_id=$2 AND resource_type=$3 AND parent_api=$4 AND api_name=$5
    `,[tenantId,appId,kind,parent,key]);
    if(receipts.length)return; // Preserve tenant-edited metadata across upgrades and reinstalls.
    const result=await client.query(sql,args);
    if(!result.rowCount)throw new Error('App package metadata conflict: '+kind+' '+(parent?parent+'.':'')+key);
    await client.query(`
      INSERT INTO md_app_package_seed_receipts
        (tenant_id,app_id,resource_type,parent_api,api_name)
      VALUES($1,$2,$3,$4,$5)
    `,[tenantId,appId,kind,parent,key]);
  };

  const {rows:objects}=await client.query<{api_name:string;label:string}>(`
    SELECT api_name,label FROM md_app_package_object_templates
    WHERE app_id=$1 AND version=$2 ORDER BY api_name
  `,[appId,version]);
  for(const item of objects)await created('Object','',item.api_name,`
    INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
    VALUES($1,$2,$3,false) ON CONFLICT DO NOTHING
  `,[tenantId,item.api_name,item.label]);

  const {rows:fields}=await client.query<{
    object_api:string;api_name:string;label:string;data_type:string;
    related_object:string|null;max_length:number|null;required:boolean
  }>(`
    SELECT object_api,api_name,label,data_type,related_object,max_length,required
    FROM md_app_package_field_templates
    WHERE app_id=$1 AND version=$2 ORDER BY object_api,api_name
  `,[appId,version]);
  for(const item of fields)await created('Field',item.object_api,item.api_name,`
    INSERT INTO md_field_definitions
      (tenant_id,object_api,api_name,label,data_type,related_object,max_length,required)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING
  `,[tenantId,item.object_api,item.api_name,item.label,item.data_type,
    item.related_object,item.max_length,item.required]);

  const {rows:components}=await client.query<{api_name:string;renderer_key:string}>(`
    SELECT api_name,renderer_key FROM md_app_package_component_templates
    WHERE app_id=$1 AND version=$2 ORDER BY api_name
  `,[appId,version]);
  for(const item of components){
    const apiName=item.api_name;
    const rendererKey=item.renderer_key;
    if(rendererKey==='smart-bundled:'+apiName){
      // Exact historical built-in registrations may have been safely disabled
      // after their last page reference disappeared. An explicit app installation
      // may reactivate that trusted key, but must never seize a tenant renderer.
      const {rows:existing}=await client.query<{renderer_key:string;enabled:boolean}>(`
        SELECT renderer_key,enabled FROM md_component_definitions
        WHERE tenant_id=$1 AND api_name=$2
      `,[tenantId,apiName]);
      if(existing[0]?.renderer_key===rendererKey){
        if(!existing[0].enabled)await client.query(`
          UPDATE md_component_definitions SET enabled=true
          WHERE tenant_id=$1 AND api_name=$2 AND renderer_key=$3 AND enabled=false
        `,[tenantId,apiName,rendererKey]);
        continue;
      }
    }
    await created('Component','',apiName,`
      INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
      VALUES($1,$2,$3,true) ON CONFLICT DO NOTHING
    `,[tenantId,apiName,rendererKey]);
  }

  const {rows:pages}=await client.query<{api_name:string;title:string}>(`
    SELECT api_name,title FROM md_app_package_page_templates
    WHERE app_id=$1 AND version=$2 ORDER BY api_name
  `,[appId,version]);
  for(const item of pages)await created('App Page','',item.api_name,`
    INSERT INTO md_page_definitions(tenant_id,api_name,title,enabled)
    VALUES($1,$2,$3,true) ON CONFLICT DO NOTHING
  `,[tenantId,item.api_name,item.title]);

  const {rows:homePages}=await client.query<{page_api:string;form_factor:'desktop'|'tablet'|'phone'}>(`
    SELECT page_api,form_factor FROM md_app_package_home_page_templates
    WHERE app_id=$1 AND version=$2 ORDER BY form_factor
  `,[appId,version]);
  for(const item of homePages){
    const {rows:page}=await client.query<{id:string}>(`
      SELECT id FROM md_page_definitions
      WHERE tenant_id=$1 AND api_name=$2 AND enabled=true
    `,[tenantId,item.page_api]);
    if(!page.length)throw new Error('App package Home Page dependency missing: '+item.page_api);
    await client.query(`
      INSERT INTO md_app_home_pages(tenant_id,app_id,form_factor,page_id)
      VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,app_id,form_factor) DO NOTHING
    `,[tenantId,appId,item.form_factor,page[0].id]);
  }

  const {rows:pageParts}=await client.query<{
    page_api:string;component_api:string;slot:string;sort_order:number
  }>(`
    SELECT page_api,component_api,slot,sort_order
    FROM md_app_package_page_component_templates
    WHERE app_id=$1 AND version=$2 ORDER BY page_api,sort_order,component_api
  `,[appId,version]);
  for(const item of pageParts){
    const componentApi=item.component_api;
    const {rows:page}=await client.query<{id:string}>(`
      SELECT id FROM md_page_definitions
      WHERE tenant_id=$1 AND api_name=$2 AND enabled=true
    `,[tenantId,item.page_api]);
    const {rows:component}=await client.query<{api_name:string}>(`
      SELECT api_name FROM md_component_definitions
      WHERE tenant_id=$1 AND api_name=$2 AND enabled=true
    `,[tenantId,componentApi]);
    if(!page.length||!component.length)
      throw new Error('App package Page Component dependency missing');
    const key=componentApi+'@'+item.slot+'#'+item.sort_order;
    // Never duplicate page components when reinstalling a published package.
    const {rows:existingParts}=await client.query<{id:string}>(`
      SELECT id FROM md_page_components
      WHERE tenant_id=$1 AND page_id=$2 AND component_api=$3
        AND slot=$4 AND sort_order=$5
    `,[tenantId,page[0].id,componentApi,item.slot,item.sort_order]);
    if(existingParts.length)continue;
    await created('Page Component',item.page_api,key,`
      INSERT INTO md_page_components(tenant_id,page_id,component_api,slot,sort_order)
      VALUES($1,$2,$3,$4,$5)
    `,[tenantId,page[0].id,componentApi,item.slot,item.sort_order]);
  }
  const {rows:properties}=await client.query<{
    page_api:string;component_api:string;slot:string;sort_order:number;
    property_path:string;data_type:string;value_text:string|null;
    reference_kind:'Object'|'Field'|'Flow'|null;reference_api:string|null;reference_parent_api:string|null
  }>(`
    SELECT page_api,component_api,slot,sort_order,property_path,data_type,value_text,
      reference_kind,reference_api,reference_parent_api
    FROM md_app_package_page_property_templates
    WHERE app_id=$1 AND version=$2 ORDER BY page_api,component_api,slot,property_path
  `,[appId,version]);
  for(const property of properties){
    const componentApi=property.component_api;
    const {rows:instances}=await client.query<{id:string}>(`
      SELECT part.id FROM md_page_components part
      JOIN md_page_definitions page ON page.id=part.page_id AND page.tenant_id=part.tenant_id
      WHERE part.tenant_id=$1 AND page.api_name=$2 AND part.component_api=$3
        AND part.slot=$4 AND part.sort_order=$5
    `,[tenantId,property.page_api,componentApi,property.slot,property.sort_order]);
    if(instances.length!==1)throw new Error('App package Page Component property target unavailable or ambiguous');
    let objectId:string|null=null,fieldId:string|null=null,flowId:string|null=null;
    if(property.data_type==='reference'){
      let query:string;
      let args:unknown[];
      if(property.reference_kind==='Object'){
        query='SELECT id FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2';
        args=[tenantId,property.reference_api];
      }else if(property.reference_kind==='Field'&&property.reference_parent_api){
        query='SELECT id FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL';
        args=[tenantId,property.reference_parent_api,property.reference_api];
      }else if(property.reference_kind==='Flow'){
        query=`SELECT id FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2
          AND active=true AND archived=false ORDER BY version DESC LIMIT 1`;
        args=[tenantId,property.reference_api];
      }else throw new Error('Invalid app package Page Component metadata reference');
      const {rows:target}=await client.query<{id:string}>(query,args);
      if(!target.length)throw new Error('Unresolved app package Page Component reference: '+property.reference_api);
      if(property.reference_kind==='Object')objectId=target[0].id;
      if(property.reference_kind==='Field')fieldId=target[0].id;
      if(property.reference_kind==='Flow')flowId=target[0].id;
    }else if(property.reference_kind||property.reference_api||property.reference_parent_api)
      throw new Error('Invalid non-reference app property');
    if(property.data_type==='number'&&(property.value_text===null
      ||!Number.isFinite(Number(property.value_text))))
      throw new Error('Invalid numeric app property');
    if(property.data_type==='boolean'&&!['true','false'].includes(property.value_text??''))
      throw new Error('Invalid boolean app property');
    await client.query(`
      INSERT INTO md_page_component_properties
        (tenant_id,component_id,property_path,value_text,data_type,object_id,field_id,flow_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING
    `,[tenantId,instances[0].id,property.property_path,
      property.data_type==='reference'?null:property.value_text,
      property.data_type,objectId,fieldId,flowId]);
  }

}
