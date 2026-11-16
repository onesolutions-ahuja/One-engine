import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {REVOLUT_PAYMENT_DDL} from '../src/system-support/revolut-checkout-service.ts';
import {PAYMENT_ORDER_DDL,LEGACY_REVOLUT_PAYMENT_COPY,
 paymentOrderStatus,recordVerifiedPaymentEvent} from '../src/system-support/payment-order-service.ts';

// Uses the disposable CI PostgreSQL database. Transaction rolls back every fixture.
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')
 throw Error('Requires disposable metadrive_native_copy_test database');
const pool=new Pool({connectionString:url});
const client=await pool.connect();
const tenant='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const credential='33333333-3333-4333-8333-333333333333';
const attempt='44444444-4444-4444-8444-444444444444';
const source='55555555-5555-4555-8555-555555555555';
const localId='66666666-6666-4666-8666-666666666666';
const providerId='77777777-7777-4777-8777-777777777777';
const db={query:(sql,params)=>client.query(sql,params)};
try{
 await client.query('BEGIN');
 await client.query('CREATE SCHEMA payment_order_smoke');
 await client.query('SET LOCAL search_path TO payment_order_smoke');
 await client.query('CREATE TABLE md_tenants(id uuid PRIMARY KEY)');
 await client.query('CREATE TABLE md_users(id uuid PRIMARY KEY)');
 await client.query('CREATE TABLE md_named_credentials(id uuid PRIMARY KEY)');
 await client.query('INSERT INTO md_tenants VALUES($1)',[tenant]);
 await client.query('INSERT INTO md_users VALUES($1)',[user]);
 await client.query('INSERT INTO md_named_credentials VALUES($1)',[credential]);
 await client.query(REVOLUT_PAYMENT_DDL);
 await client.query(PAYMENT_ORDER_DDL);
 await client.query(`INSERT INTO md_revolut_checkout_orders
  (id,tenant_id,credential_id,created_by,source_object,source_record_id,
   attempt_key,revolut_order_id,public_token,amount_minor,currency)
  VALUES($1,$2,$3,$4,'Cart',$5,$6,$7,'tok_1234567890',425,'GBP')`,
  [localId,tenant,credential,user,source,attempt,providerId]);
 // Retain the same local order UUID so an open till can still poll after deployment.
 await client.query(LEGACY_REVOLUT_PAYMENT_COPY);
 await client.query(LEGACY_REVOLUT_PAYMENT_COPY);
 let result=await client.query('SELECT * FROM md_payment_orders');
 assert.equal(result.rows.length,1,'migration is idempotent');
 assert.equal(result.rows[0].id,localId);
 assert.equal(result.rows[0].provider,'Revolut');
 assert.equal(result.rows[0].checkout_token,'tok_1234567890');
 assert.equal(await paymentOrderStatus(db,{tenantId:tenant,userId:user,provider:'Revolut'},localId),'pending');
 await client.query(`INSERT INTO md_payment_orders
 (tenant_id,provider,credential_id,created_by,source_object,source_record_id,
 attempt_key,provider_order_id,checkout_url,amount_minor,currency)
 VALUES($1,'AnotherGateway',$2,$3,'Cart',$4,$5,'external-123',
 'https://example.com/checkout',425,'GBP')`,
 [tenant,credential,user,source,attempt]);
 assert.equal(await recordVerifiedPaymentEvent(db,{
  tenantId:tenant,provider:'Revolut',credentialId:credential,
  providerOrderId:providerId,eventName:'ORDER_COMPLETED',status:'completed'}),true);
 assert.equal(await paymentOrderStatus(db,{tenantId:tenant,userId:user,provider:'Revolut'},localId),'completed');
 // Out-of-order events must not downgrade a completed payment.
 await recordVerifiedPaymentEvent(db,{
  tenantId:tenant,provider:'Revolut',credentialId:credential,
  providerOrderId:providerId,eventName:'ORDER_AUTHORISED',status:'authorised'});
 assert.equal(await paymentOrderStatus(db,{tenantId:tenant,userId:user,provider:'Revolut'},localId),'completed');
 result=await client.query("SELECT status FROM md_payment_orders WHERE provider='AnotherGateway'");
 assert.equal(result.rows[0].status,'pending','other provider remains isolated');
 assert.equal(await recordVerifiedPaymentEvent(db,{
  tenantId:tenant,provider:'AnotherGateway',credentialId:credential,
  providerOrderId:providerId,eventName:'FAKE',status:'failed'}),false);
 assert.equal(await paymentOrderStatus(db,{tenantId:tenant,userId:user,provider:'AnotherGateway'},localId)
   .catch(error=>error.httpStatus),404);
 console.info('Shared payment order PostgreSQL migration and provider isolation: OK');
}finally{
 await client.query('ROLLBACK').catch(()=>{});
 client.release();
 await pool.end();
}
