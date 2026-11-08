import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Real PostgreSQL relational integrity test, exercised against a disposable
// tenant on CI. No production business records are used.
export async function runApiCasefoldSqlSmoke(db){
 const slug='api-casefold-'+randomUUID().slice(0,8);
 const tenant=(await db.query('INSERT INTO md_tenants(slug,name) VALUES($1,$1) RETURNING id',[slug])).rows[0].id;
 const other=(await db.query('INSERT INTO md_tenants(slug,name) VALUES($1,$1) RETURNING id',[slug+'-other'])).rows[0].id;
 for(const id of [tenant,other]){
  await db.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label)
    VALUES($1,'CasefoldInvoice__c','Invoice Display Label')`,[id]);
  await db.query(`INSERT INTO md_field_definitions
    (tenant_id,object_api,api_name,label,data_type)
    VALUES($1,'CasefoldInvoice__c','CodeValue__c','Code Value','Text(80)')`,[id]);
 }
 const record=(await db.query(`INSERT INTO md_records(tenant_id,object_api)
   VALUES($1,'CasefoldInvoice__c') RETURNING id`,[tenant])).rows[0].id;
 await db.query(`INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,value_text)
   VALUES($1,$2,'CasefoldInvoice__c','CodeValue__c','Preserve Business Value')`,[tenant,record]);
 const page=(await db.query(`INSERT INTO md_page_definitions(tenant_id,api_name,title)
   VALUES($1,'CasefoldPAGE','Page Display Name') RETURNING id`,[tenant])).rows[0].id;
 await db.query(`INSERT INTO md_flow_definitions(tenant_id,api_name,label,version)
  VALUES($1,'CasefoldPaymentFlow','Cash Payment',1)`,[tenant]);
 await db.query(`INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key)
  VALUES($1,'CasefoldComponent','shared:test')`,[tenant]);
 await db.query(`INSERT INTO md_page_properties(tenant_id,page_id,api_name,value_text)
  VALUES($1,$2,'selectedFlow','CasefoldPaymentFlow')`,[tenant,page]);
 const normalized=await db.query('SELECT md_casefold_tenant_api_names($1) AS count',[tenant]);
 assert.ok(Number(normalized.rows[0].count)>0);
 const object=(await db.query(`SELECT id,api_name,label FROM md_object_definitions
  WHERE tenant_id=$1`,[tenant])).rows[0];
 assert.equal(object.api_name,'casefoldinvoice__c');
 assert.equal(object.label,'Invoice Display Label');
 assert.equal((await db.query(`SELECT object_api,api_name FROM md_field_definitions
  WHERE tenant_id=$1`,[tenant])).rows[0].api_name,'codevalue__c');
 assert.equal((await db.query(`SELECT object_api FROM md_records WHERE id=$1`,[record]))
  .rows[0].object_api,'casefoldinvoice__c');
 const values=(await db.query(`SELECT object_api,field_api,value_text
  FROM md_record_values WHERE record_id=$1`,[record])).rows[0];
 assert.deepEqual(values,{
  object_api:'casefoldinvoice__c',
  field_api:'codevalue__c',
  value_text:'Preserve Business Value'
 });
 assert.equal((await db.query(`SELECT title FROM md_page_definitions WHERE id=$1`,[page]))
  .rows[0].title,'Page Display Name');
 assert.equal((await db.query(`SELECT value_text FROM md_page_properties WHERE page_id=$1`,[page]))
  .rows[0].value_text,'casefoldpaymentflow');
 assert.equal((await db.query(`SELECT api_name FROM md_object_definitions WHERE tenant_id=$1`,[other]))
  .rows[0].api_name,'CasefoldInvoice__c','Other tenant must remain unchanged');
 const replay=await db.query('SELECT md_casefold_tenant_api_names($1) AS count',[tenant]);
 assert.equal(Number(replay.rows[0].count),0,'Repeated migration must be idempotent');
 console.info('Tenant API casefold SQL smoke: idempotent, relational FKs preserved, no cross-tenant updates');
}
