// Active backend migration regressions. These execute in the canonical
// npm run test:backend entrypoint instead of a silently skipped archive.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {planLegacyMigrationTransition} from '../../src/system-support/system-migrations.ts';
import {tenantDeveloperDomain} from '../../src/system-support/tenant-developer-domain.ts';

// The legacy backend archive has no entries; these tests run directly.
// Keep its empty index for the existing repository reference verifier.
const SOURCES=[];

const source=readFileSync(new URL('../../src/system-support/migrations/20261107-core-baseline.sql',import.meta.url),'utf8');
const originals=[...source.matchAll(/^-- BEGIN ORIGINAL MIGRATION ([0-9a-z-]+\.sql)\n([\s\S]*?)^-- END ORIGINAL MIGRATION \1$/gm)]
 .map(match=>({version:match[1],sql:match[2]}));
const receipts=originals.map(m=>({
 version:m.version,checksum:createHash('sha256').update(m.sql).digest('hex')
}));
const external={
 version:'20270123-normalize-builder-ribbon-properties.sql',
 checksum:'a'.repeat(64)
};

test('canonical backend suite retains all 279 original SQL migrations',()=>{
 assert.equal(originals.length,279);
 assert.equal(new Set(originals.map(m=>m.version)).size,279);
});

test('OCI ribbon normalization receipt is preserved without replay',()=>{
 assert.deepEqual(planLegacyMigrationTransition(source,[...receipts,external]),[]);
 assert.deepEqual(planLegacyMigrationTransition(source,[...receipts.slice(0,-1),external])
  .map(m=>m.name),[originals.at(-1).version],
  'A known out-of-band receipt must not suppress missing core migrations');
});

test('unknown or corrupt SQL receipts still fail closed',()=>{
 assert.throws(()=>planLegacyMigrationTransition(source,[...receipts,{
  version:'20270124-unverified-production.sql',checksum:'a'.repeat(64)
 }]),/Unknown legacy SQL migration receipt/);
 assert.throws(()=>planLegacyMigrationTransition(source,[...receipts,{...external,checksum:'invalid'}]),
  /Unknown legacy SQL migration receipt/);
 assert.throws(()=>planLegacyMigrationTransition(source,[...receipts,external,external]),
  /Duplicate legacy SQL migration receipt/);
 assert.throws(()=>planLegacyMigrationTransition(source,[{...receipts[0],checksum:'b'.repeat(64)}]),
  /SQL system migration changed after application/);
});

test('OCI live telemetry reports collector health and stages without GitHub queries',async()=>{
 const {readOciDeploymentTelemetry}=await import('../../src/system-support/platform-deployment-routes.ts');
 const enabled=process.env.METADRIVE_MCP_OPERATIONS;
 const socket=process.env.METADRIVE_MCP_BROKER_SOCKET;
 process.env.METADRIVE_MCP_OPERATIONS='enabled';
 process.env.METADRIVE_MCP_BROKER_SOCKET='/testing/oci-socket';
 try {
  const status=await readOciDeploymentTelemetry(async()=>({output:[
   'state=running','sha='+'a'.repeat(40),'stage=building',
   'updated_at=2026-11-08T09:51:00Z','log_collector=v2',
   'build_log_state=available','trail_begin',
   '2026-11-08T09:51:00Z building — npm run build','trail_end',
   'build_log_begin','| 2026-11-08T09:51:01Z $ npm run build',
   'build_log_end','journal_begin','journal_end',''
  ].join('\n')}));
  assert.equal(status.active,true);
  assert.equal(status.configured,true);
  assert.equal(status.oci?.logCollector,'ready');
  assert.equal(status.oci?.buildLogState,'available');
  assert.deepEqual(status.oci?.buildLog,['2026-11-08T09:51:01Z $ npm run build']);
  assert.deepEqual(status.oci?.trail,['2026-11-08T09:51:00Z building — npm run build']);
  assert.ok(Number.isFinite(Date.parse(status.checkedAt)));
  const old=await readOciDeploymentTelemetry(async()=>({output:'state=running\nstage=building\n'}));
  assert.equal(old.oci?.logCollector,'outdated','older OCI installations must be diagnosed');
  assert.equal(old.oci?.buildLogState,'unknown');
  const down=await readOciDeploymentTelemetry(async()=>{throw Error('socket closed');});
  assert.equal(down.configured,false);
  assert.match(down.error,/helper is unreachable/);
 } finally {
  if(enabled===undefined)delete process.env.METADRIVE_MCP_OPERATIONS;
  else process.env.METADRIVE_MCP_OPERATIONS=enabled;
  if(socket===undefined)delete process.env.METADRIVE_MCP_BROKER_SOCKET;
  else process.env.METADRIVE_MCP_BROKER_SOCKET=socket;
 }
});


test('tenant developer login host uses a configured or default platform-owned base domain',()=>{
 assert.equal(tenantDeveloperDomain('kingstonexterior','tenants.unesolutions.co.uk'),
   'kingstonexterior.tenants.unesolutions.co.uk');
 assert.equal(tenantDeveloperDomain('New-Tenant',' TENANTS.EXAMPLE.COM '),
   'new-tenant.tenants.example.com');
 assert.equal(tenantDeveloperDomain('mytenant',''),'mytenant.tenants.unesolutions.co.uk');
 assert.equal(tenantDeveloperDomain('mytenant','  '),'mytenant.tenants.unesolutions.co.uk');
 assert.throws(()=>tenantDeveloperDomain('mytenant','https://example.com/'),/base domain is not configured/);
 assert.throws(()=>tenantDeveloperDomain('tenant.name','tenants.example.com'),/Invalid tenant identifier/);
 assert.throws(()=>tenantDeveloperDomain('x'.repeat(55),'tenants.example.com'),/Invalid tenant identifier/);
});

test('mailbox availability endpoint is registered before the dynamic tenant slug route',()=>{
 const routes=readFileSync(new URL('../../src/system-support/server.ts',import.meta.url),'utf8');
 const exact=routes.indexOf("app.get('/api/platform/tenants/developer-email-availability'");
 const dynamic=routes.indexOf("app.get('/api/platform/tenants/:slug'");
 assert.ok(exact>=0&&dynamic>=0&&exact<dynamic,'specific availability route must not be shadowed');
});

test('tenant form uses verified domain, retains mailbox failures, and blocks duplicate identities',()=>{
 const ui=readFileSync(new URL('../../../web/src/core/platform/TenantManagement/TenantManagement.tsx',import.meta.url),'utf8');
 const fields=readFileSync(new URL('../../../web/src/core/platform/TenantManagement/adminTenantFieldMetadata.ts',import.meta.url),'utf8');
 assert.match(ui,/body: JSON\.stringify\(create\)/);
 assert.doesNotMatch(ui,/readOnly=\{field\.key==='developerDomain'\}/);
 assert.doesNotMatch(fields,/key:'developerDomain'/);
 assert.match(ui,/emailCheck\?\.developerDomain/);
 assert.match(ui,/setEmailCheckError\(cause instanceof Error/);
 assert.match(ui,/administratorEmailMatchesDeveloper/);
 assert.match(ui,/disabled=\{!canCreateTenant\}/);
 assert.match(fields,/key:'tenantId'[^\n]*maxLength:54/);
 const service=readFileSync(new URL('../../src/system-files/platform-tenant-service.ts',import.meta.url),'utf8');
 const inspection=readFileSync(new URL('../../src/system-support/tenant-inspection-routes.ts',import.meta.url),'utf8');
 assert.match(service,/domain:expectedDomain/);
 assert.match(service,/x\.developerDomain!==undefined/);
 assert.match(inspection,/domain===tenantDeveloperDomain\(name\)/);
});

test('publishing standalone Page Builder templates does not demand navigation assignments',async()=>{
 const {pageRequiresActivationAssignment}=await import('../../src/system-files/page-layout-version-runtime.ts');
 for(const type of ['Home Page','Record Page'])
  assert.equal(pageRequiresActivationAssignment(type),true,type);
 for(const type of ['App Page','In-Screen Page','Print Template'])
  assert.equal(pageRequiresActivationAssignment(type),false,type);
});

test('Custom-only In-Screen Pages open when the host asks for another layout',async()=>{
 const {PageRuntime}=await import('../../src/system-files/page-runtime.ts');
 const asked=[];
 const db={query:async(_sql,params)=>{asked.push(params[3]);
  return {rows:params[3]==='Custom'&&params[2]==='popup'?[{api_name:'popup'}]:[]};}};
 const runtime=new PageRuntime(db);
 const loads=[];
 runtime.load=async(tenant,api,variant)=>{loads.push([tenant,api,variant]);return {page:{apiName:api}};};
 const page=await runtime.resolveInScreenPage('t1','APP','popup','Desktop');
 assert.equal(page?.page.apiName,'popup');
 assert.deepEqual(asked,['Desktop','Custom'],'exact layout first, then Custom');
 assert.equal(loads[0][2],'Custom','the Custom layout is the one served');
 asked.length=0;
 assert.equal(await runtime.resolveInScreenPage('t1','APP','missing','Custom').catch(e=>e),null);
 assert.deepEqual(asked,['Custom'],'Custom requests do not retry');
 const routes=readFileSync(new URL('../../src/system-support/server.ts',import.meta.url),'utf8');
 assert.match(routes,/throw new Error\('In-Screen Page not found'\)/,'missing popups are 404, not SQL outages');
});

test('validation rules support ISNEW, ISCHANGED and PRIORVALUE',async()=>{
 const {evaluateFlowFormula}=await import('../../src/system-files/flow-formula-runtime.ts');
 // Seeded AceAssist rule that blocked every Invoice save with "Unsupported formula function: ISNEW".
 const rule='AND(NOT(ISNEW()), NOT(ISBLANK(PRIORVALUE($Record.InvoiceNumber))), '+
  'OR(ISCHANGED($Record.InvoiceNumber), ISCHANGED($Record.Total)))';
 const run=(current,prior,stage)=>evaluateFlowFormula(rule,
  name=>name.startsWith('$Record.')?current[name.slice(8)]??null:null,
  {transactionStage:stage,currentRecord:current,priorRecord:prior},'validation_rule');
 assert.equal(run({InvoiceNumber:null,Total:3.7},null,'create'),false,'new invoices pass');
 assert.equal(run({InvoiceNumber:'INV-1',Total:3.7},{InvoiceNumber:'INV-1',Total:3.7},'update'),false,
  'unchanged issued invoice passes');
 assert.equal(run({InvoiceNumber:'INV-1',Total:9},{InvoiceNumber:'INV-1',Total:3.7},'update'),true,
  'changing an issued total is blocked');
 assert.equal(run({InvoiceNumber:'INV-2',Total:3.7},{InvoiceNumber:null,Total:3.7},'update'),false,
  'first numbering is allowed');
 assert.throws(()=>evaluateFlowFormula('ISNEW()',()=>null,{},'flow_formula'),/not available in flow formula/);
});

test('SQL validation path evaluates NOT and record lifecycle functions',async()=>{
 const {evaluateResolvedFormulaSql}=await import('../../src/system-support/formula-sql-runtime.ts');
 const rule='AND(NOT(ISNEW()), NOT(ISBLANK(PRIORVALUE($Record.InvoiceNumber))), '+
  'OR(ISCHANGED($Record.InvoiceNumber), ISCHANGED($Record.Total)))';
 // ISBLANK is SQL-compiled: answer it from the bound child value.
 const db={query:async(_sql,params)=>{const v=params.at(-1);return {rows:[{value:v===null||v===''}]};}};
 const run=(current,prior,stage)=>evaluateResolvedFormulaSql(db,rule,
  name=>name.startsWith('$Record.')?current[name.slice(8)]??null:null,
  {transactionStage:stage,currentRecord:current,priorRecord:prior,timeZone:'UTC',now:new Date()},'validation_rule');
 assert.equal(await run({InvoiceNumber:null,Total:3.7},null,'create'),false,'new invoice saves');
 assert.equal(await run({InvoiceNumber:'INV-1',Total:9},{InvoiceNumber:'INV-1',Total:3.7},'update'),true,
  'issued total change is blocked');
 assert.equal(await run({InvoiceNumber:'INV-1',Total:3.7},{InvoiceNumber:'INV-1',Total:3.7},'update'),false);
});

test('User references resolve against tenant users, not md_records',async()=>{
 const {assertLookupTargetExists}=await import('../../src/relationship-engine/LookupResolver.ts');
 const calls=[];
 const db={query:async(sql,params)=>{calls.push(sql);
  if(sql.includes('md_users'))return {rowCount:params[1]==='u-1'?1:0,rows:[]};
  return {rowCount:0,rows:[]};}};
 await assertLookupTargetExists(db,'t-1','User','u-1','User','u-1');
 assert.equal(calls.length,1);
 await assert.rejects(assertLookupTargetExists(db,'t-1','User','u-2','User','u-1'),/Invalid relationship target: User/);
 await assert.rejects(assertLookupTargetExists(db,'t-1','Customer','u-1','Customer','u-1'),/Invalid relationship target: Customer/);
});


test('Revolut connector exposes verified Merchant API operations without packaged secrets',async()=>{
 const {default:manifest}=await import('../../../connectors/revolut/scripts/install.mjs');
 assert.equal(manifest.appApi,'RevolutConnector');
 assert.equal(manifest.auth,'Bearer');
 assert.equal(manifest.url,'https://sandbox-merchant.revolut.com/');
 assert.ok(manifest.allowedUrls.includes('https://merchant.revolut.com/'));
 assert.equal(manifest.operations.CreateOrder.method,'POST');
 assert.equal(manifest.operations.CreateOrder.path,'api/orders');
 assert.equal(manifest.operations.GetOrder.path,'api/orders/{!OrderId}');
 assert.equal(manifest.operations.CreateOrder.headers,'Revolut-Api-Version: 2026-08-17');
 assert.equal(manifest.fields.find(f=>f.apiName==='public_testPath')?.defaultValue,'api/orders');
 assert.equal(manifest.fields.find(f=>f.apiName==='public_testHeaders')?.defaultValue,
  'Revolut-Api-Version: 2026-08-17');
 assert.equal(JSON.stringify(manifest).includes('sk_'),false,'no secret is bundled');
});

test('Revolut signed webhook accepts raw payload, timestamp and rotated signatures only',async()=>{
 const {verifyRevolutWebhook,revolutEventState,revolutMinorAmount}=await import(
  '../../src/system-support/revolut-checkout-service.ts');
 const {createHmac}=await import('node:crypto');
 const timestamp=String(Date.now());
 const secret='wsk_test_secret_very_long';
 const body=Buffer.from('{"event":"ORDER_COMPLETED","order_id":"6634c172-3398-ac93-aee9-50de0282e3ac"}');
 const sign=raw=>'v1='+createHmac('sha256',secret).update('v1.'+timestamp+'.').update(raw).digest('hex');
 assert.equal(verifyRevolutWebhook(body,timestamp,sign(body),secret),true);
 assert.equal(verifyRevolutWebhook(body,timestamp,'v1='+('0'.repeat(64))+','+sign(body),secret),true);
 assert.equal(verifyRevolutWebhook(Buffer.from(body.toString().replace('ORDER_COMPLETED','ORDER_FAILED')),
  timestamp,sign(body),secret),false);
 assert.equal(verifyRevolutWebhook(body,String(Date.now()-300001),sign(body),secret),false);
 assert.equal(verifyRevolutWebhook(body,timestamp,'sha256='+('a'.repeat(64)),secret),false);
 assert.equal(verifyRevolutWebhook(body,timestamp,sign(body),'different-secret'),false);
 assert.equal(revolutEventState('ORDER_COMPLETED'),'completed');
 assert.equal(revolutEventState('ORDER_AUTHORISED'),'authorised');
 assert.equal(revolutEventState('ORDER_PAYMENT_FAILED'),'failed');
 assert.equal(revolutEventState('INVALID'),null);
 assert.equal(revolutMinorAmount(5,'GBP'),500);
 assert.throws(()=>revolutMinorAmount(-1,'GBP'),/Invalid payment/);
 assert.throws(()=>revolutMinorAmount(0.001,'GBP'),/precision/);
});

test('Revolut checkout is a Page Builder block without an installed application Flow',async()=>{
 const {standardPageComponents}=await import('../../../web/src/core/components/Catalog/catalog.ts');
 assert.ok(standardPageComponents.some(block=>block.apiName==='Revolut Checkout'));
 const {default:manifest}=await import('../../../connectors/revolut/scripts/install.mjs');
 assert.ok(manifest.fields.some(field=>field.apiName==='public_checkoutPublishable'));
 assert.ok(manifest.fields.some(field=>field.apiName==='public_checkoutAmountField'));
 assert.equal(manifest.operations.CreateOrder.method,'POST');
});


test('shared payment orders support independent providers, retries, and verified completion',async()=>{
 const {createPaymentOrder,paymentOrderStatus,recordVerifiedPaymentEvent,
  nextPaymentStatus,paymentAmountMinor,PAYMENT_ORDER_DDL}
  =await import('../../src/system-support/payment-order-service.ts');
 const {LEGACY_REVOLUT_PAYMENT_COPY}=await import('../../src/system-support/revolut-payment-legacy-migration.ts');
 const tenant='11111111-1111-4111-8111-111111111111';
 const user='22222222-2222-4222-8222-222222222222';
 const credential='33333333-3333-4333-8333-333333333333';
 const attempt='44444444-4444-4444-8444-444444444444';
 const cart='55555555-5555-4555-8555-555555555555';
 const secondCart='66666666-6666-4666-8666-666666666666';
 const rows=[];
 const db={query:async(sql,params)=>{
  if(sql.includes('SELECT id,checkout_token,checkout_url,credential_id')){
   const [t,provider,u,key]=params;
   return {rows:rows.filter(x=>x.tenant_id===t&&x.provider===provider
     &&x.created_by===u&&x.attempt_key===key)};
  }
  if(sql.includes('SELECT 1 FROM md_payment_orders')){
   const [t,object,id]=params;
   return {rows:rows.filter(x=>x.tenant_id===t&&x.source_object===object
     &&x.source_record_id===id&&x.status==='completed')};
  }
  if(sql.includes('INSERT INTO md_payment_orders')){
   const [t,provider,cred,u,object,id,key,providerId,token,url,amount,currency]=params;
   const row={id:'77777777-7777-4777-8777-'+String(rows.length+1).padStart(12,'0'),
    tenant_id:t,provider,credential_id:cred,created_by:u,source_object:object,
    source_record_id:id,attempt_key:key,provider_order_id:providerId,
    checkout_token:token,checkout_url:url,amount_minor:amount,currency,status:'pending'};
   rows.push(row);return {rows:[row]};
  }
  if(sql.includes('SELECT status FROM md_payment_orders')){
   const [t,provider,id,u]=params;
   return {rows:rows.filter(x=>x.tenant_id===t&&x.provider===provider
      &&x.id===id&&x.created_by===u)};
  }
  if(sql.includes('UPDATE md_payment_orders')){
   const [t,provider,cred,providerOrderId,status]=params;
   const matching=rows.filter(x=>x.tenant_id===t&&x.provider===provider
      &&x.credential_id===cred&&x.provider_order_id===providerOrderId);
   for(const x of matching)x.status=nextPaymentStatus(x.status,status);
   return {rows:matching.map(x=>({id:x.id}))};
  }
  throw Error('Unexpected payment SQL: '+sql);
 }};
 const records={get:async()=>({Total:4.25})};
 const base={tenantId:tenant,userId:user,credentialId:credential,
  sourceObject:'Cart',recordId:cart,amountField:'Total',currency:'GBP',attemptKey:attempt};
 let calls=0;
 const revolt=async({amountMinor,currency,attemptKey})=>{
  calls++;assert.equal(amountMinor,425);assert.equal(currency,'GBP');assert.equal(attemptKey,attempt);
  return {providerOrderId:'88888888-8888-4888-8888-888888888888',checkoutToken:'tok_1234567890'};
 };
 const first=await createPaymentOrder(db,records,{...base,provider:'Revolut'},revolt);
 assert.equal(first.reused,false);
 assert.equal(first.token,'tok_1234567890');
 const repeated=await createPaymentOrder(db,records,{...base,provider:'Revolut'},revolt);
 assert.equal(repeated.id,first.id);
 assert.equal(repeated.reused,true);
 assert.equal(calls,1,'retry must not create a second provider order');
 assert.equal(await paymentOrderStatus(db,{tenantId:tenant,userId:user,provider:'Revolut'},first.id),'pending');
 assert.equal(await recordVerifiedPaymentEvent(db,{tenantId:tenant,provider:'Revolut',
  credentialId:credential,providerOrderId:'88888888-8888-4888-8888-888888888888',
  eventName:'ORDER_COMPLETED',status:'completed'}),true);
 assert.equal(await paymentOrderStatus(db,{tenantId:tenant,userId:user,provider:'Revolut'},first.id),'completed');
 assert.equal(nextPaymentStatus('completed','authorised'),'completed');
 assert.equal(nextPaymentStatus('completed','failed'),'completed');
 assert.equal(nextPaymentStatus('pending','authorised'),'authorised');
 assert.equal(await recordVerifiedPaymentEvent(db,{tenantId:tenant,provider:'AnotherGateway',
  credentialId:credential,providerOrderId:'88888888-8888-4888-8888-888888888888',
  eventName:'FAKE',status:'failed'}),false,'different provider must not mutate Revolut');
 assert.equal(rows[0].status,'completed');
 await assert.rejects(()=>createPaymentOrder(db,records,{...base,attemptKey:
  '99999999-9999-4999-8999-999999999999',provider:'AnotherGateway'},
  async()=>({providerOrderId:'new-order',checkoutUrl:'https://example.com/pay'})),/already paid/);
 const other=await createPaymentOrder(db,records,{...base,recordId:secondCart,provider:'AnotherGateway'},
  async()=>({providerOrderId:'different-order',checkoutUrl:'https://example.com/pay'}));
 assert.equal(other.checkoutUrl,'https://example.com/pay');
 assert.equal(other.token,undefined);
 assert.equal(await paymentOrderStatus(db,{tenantId:tenant,userId:user,provider:'Revolut'},other.id)
  .catch(e=>e.httpStatus),404,'provider scoped status lookup');
 assert.equal(paymentAmountMinor(4.25,'GBP'),425);
 assert.throws(()=>paymentAmountMinor(4.251,'GBP'),/precision/);
 assert.match(PAYMENT_ORDER_DDL,/UNIQUE\(tenant_id,provider,created_by,attempt_key\)/);
 assert.match(LEGACY_REVOLUT_PAYMENT_COPY,/FROM md_revolut_checkout_orders/);
});
