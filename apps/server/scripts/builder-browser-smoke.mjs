import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {chromium,webkit} from 'playwright';
const browserName=process.env.METADRIVE_BROWSER_ENGINE || 'chromium';
if(!['chromium','webkit'].includes(browserName))throw new Error('Unsupported browser engine: '+browserName);
const browserType=browserName==='webkit'?webkit:chromium;
const built=new URL('../dist-system/system-files/',import.meta.url);
const support=new URL('../dist-system/system-support/',import.meta.url);
const [{SqlPersistence},{AuthenticationService},{createSystemServer}]=await Promise.all([
 import(new URL('sql-persistence.js',built).href),
 import(new URL('authentication.js',built).href),
 import(new URL('server.js',support).href)
]);

const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url)throw new Error('SQL test database is required');
const db=new SqlPersistence(url);
// The Design 2 smoke owns a disposable PostgreSQL database. Run the same
// authoritative SQL bootstrap and idempotent migrations as other SQL E2E
// workflows before inserting fixture users and opening the browser.
if(process.env.METADRIVE_BROWSER_TARGET==='design2'){
 const {readFileSync}=await import('node:fs');
 const {applySystemMigrations}=await import(new URL('system-migrations.js',support).href);
 const schema=readFileSync(new URL('../src/system-files/schema.sql',import.meta.url),'utf8');
 await db.query(schema);
 await applySystemMigrations(db);
 await applySystemMigrations(db);
 await db.verifySchema();
}
const api=createSystemServer(db),listener=api.listen(0,'127.0.0.1');
let frontend,browser,page;
try{
 if(!listener.listening)await once(listener,'listening');
 const apiPort=listener.address().port;
 const password='BrowserTestPassphrase!2026';
 const hash=await new AuthenticationService(db).hashPassword(password);
 const tenant=await db.query("INSERT INTO md_tenants(slug,name) VALUES($1,$2) RETURNING id",
  ['builder-browser-smoke','Builder Browser Smoke']);
 const tenantId=tenant.rows[0].id;
 const user=await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id",
  [tenantId,'developer@example.invalid',hash]);
 const userId=user.rows[0].id;
 await db.query('INSERT INTO md_tenant_domains(domain,tenant_id) VALUES($1,$2)',[
  '127.0.0.1',tenantId]);
 // Only for the disposable database: the published frontend Origin must
 // resolve to this CI fixture tenant when exercising the real login form.
 if(process.env.METADRIVE_BROWSER_LIVE_ORIGIN)
  await db.query('INSERT INTO md_tenant_domains(domain,tenant_id) VALUES($1,$2)',[
   'unesolutions.co.uk',tenantId]);
 const set=await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'BuilderE2E') RETURNING id",[tenantId]);
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',
  [tenantId,userId,set.rows[0].id]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",
  [tenantId,set.rows[0].id]);
 await db.query("INSERT INTO md_object_definitions(tenant_id,api_name,label) VALUES($1,'ReviewCase','Review Case')",
  [tenantId]);
 const reviewCase=await db.query(`
  INSERT INTO md_records(tenant_id,object_api,owner_id)
  VALUES($1,'ReviewCase',$2) RETURNING id
 `,[tenantId,userId]);
 const caseId=reviewCase.rows[0].id;

 // Create lifecycle fixture before the browser authenticates and caches landing metadata.
 const {ObjectDefinitionService:EarlyObjectDefinition}=await import(new URL('object-definition.js',built).href);
 const EarlyRecordEngine=(await import(new URL('record-engine.js',built).href)).RecordEngine;
 const EarlyRbacEngine=(await import(new URL('rbac-engine.js',built).href)).RbacEngine;
 const recycleDefinition=await new EarlyObjectDefinition(db).create(tenantId,'BrowserRecycle__c',
  'Browser Recycle',[{apiName:'Name',label:'Name',dataType:'Text(80)',required:true}]);
 assert.ok(recycleDefinition);
 await db.query(`INSERT INTO md_object_actions
   (tenant_id,object_api,action_id,label,action_type,enabled,sort_order)
   VALUES($1,'BrowserRecycle__c','Delete','Delete','Standard',true,0)
   ON CONFLICT(tenant_id,object_api,action_id) DO NOTHING`,[tenantId]);
 const recycleSetup=new EarlyRecordEngine(db,new EarlyRbacEngine(db));
 const recycleId=await recycleSetup.create(tenantId,userId,'BrowserRecycle__c',{Name:'Browser recovery test'});
 await recycleSetup.remove(tenantId,userId,'BrowserRecycle__c',recycleId);

 const tokens=await new AuthenticationService(db).signIn(tenantId,'developer@example.invalid',password);
 // Optionally run the same authenticated browser suite against the actual
 // production CDN bundle while isolating every API request in CI PostgreSQL.
 // Never send test login details or records to a production API.
 const publishedSite=process.env.METADRIVE_BROWSER_LIVE_ORIGIN;
 const origin=publishedSite ? new URL(publishedSite).origin : 'http://127.0.0.1:4173';
 if(publishedSite && origin!=='https://unesolutions.co.uk')
  throw new Error('Live browser verification requires the approved production origin');
 if(!publishedSite){
  // Exercise immutable built chunks. Vite's dev optimizer can invalidate lazy
  // imports during WebKit navigation and trigger the application's reload recovery.
  // Force same-origin API routing so PR credentials never reach production.
  if(process.env.METADRIVE_BROWSER_PREBUILT==='1'){
   // CI compiled this exact checkout before installing browser-only packages.
   // Installing Playwright with npm --no-save can re-resolve React types; a
   // redundant TypeScript build afterwards does not test the published bundle.
   assert.ok(existsSync(new URL('../../web/dist/index.html',import.meta.url)),
    'Prebuilt browser smoke requires the checked frontend dist/index.html');
  }else{
  const build=spawn('npm',['run','build','--workspace','apps/web'],{
   cwd:new URL('../../../',import.meta.url).pathname,
   env:{...process.env,GITHUB_PAGES:'true',GITHUB_PAGES_BASE_PATH:'/',VITE_API_BASE_URL:'/api'},
   stdio:'inherit'
  });
  const [buildCode]=await once(build,'exit');
  assert.equal(buildCode,0,'Browser smoke frontend build failed');
  }
  frontend=spawn('npm',['run','preview','--workspace','apps/web','--','--host','127.0.0.1','--port','4173','--strictPort'],{
   cwd:new URL('../../../',import.meta.url).pathname,
   env:{...process.env,METADRIVE_API_PROXY_TARGET:'http://127.0.0.1:'+apiPort},
   stdio:'ignore'
  });
  let ready=false;
  for(let attempt=0;attempt<50;attempt++){
   try{if((await fetch(origin)).ok){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw new Error('Vite test frontend did not start');
 }
 browser=await browserType.launch({headless:true});
 // Block production service workers: their fetch handlers can bypass Playwright
 // route interception in WebKit, escaping the disposable CI API boundary.
 const context=await browser.newContext({
  viewport:{width:1440,height:900},
  ...(publishedSite?{serviceWorkers:'block'}:{})
 });
 if(!publishedSite)await context.addCookies([{name:'md_refresh',value:tokens.refreshToken,
  domain:'127.0.0.1',path:'/api/auth',httpOnly:true,sameSite:'Lax'}]);
 // The published UI signs in through its real login form and must not inherit
 // a pre-seeded refresh cookie from the local-only browser smoke.
 page=await context.newPage();
 let isolatedCalls=0;
 if(publishedSite){
  // Intercept at the browser-context level, including WebKit's cross-origin
  // requests, and do not allow an unmatched production API request through.
  await context.route('**/*',async route=>{
   const candidate=new URL(route.request().url());
   if(!candidate.pathname.startsWith('/api/')){
    if(candidate.hostname==='api.unesolutions.co.uk')
     throw new Error('Unexpected production API request outside isolated /api/ routing');
    await route.continue();
    return;
   }
   const request=route.request();
   const source=new URL(request.url());
   if(!['unesolutions.co.uk','api.unesolutions.co.uk'].includes(source.hostname))
    throw new Error('Unexpected remote API target during production browser test');
   const cors={
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Credentials':'true',
    'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':'content-type,authorization,x-metadrive-request-source,x-csrf-token'
   };
   if(request.method()==='OPTIONS'){
    await route.fulfill({status:204,headers:cors,body:''});
    return;
   }
   isolatedCalls++;
   const forwarded=new Headers(request.headers());
   forwarded.delete('host');forwarded.delete('content-length');
   forwarded.delete('accept-encoding');
   const response=await fetch('http://127.0.0.1:'+apiPort+source.pathname+source.search,{
    method:request.method(),headers:forwarded,
    body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer()??undefined,
    redirect:'manual'
   });
   if(source.pathname.startsWith('/api/auth/')){
    // The intercepted response is synthetic for the real CDN origin.
    // Synchronize only our CI-issued rotating refresh cookie with Chromium:
    // the browser can otherwise retain the pre-rotation token on navigation.
    const cookie=response.headers.get('set-cookie')?.match(/^md_refresh=([^;]+)/);
    if(cookie)await context.addCookies([{name:'md_refresh',value:cookie[1],
      domain:'.unesolutions.co.uk',path:'/api/auth',httpOnly:true,
      sameSite:'None',secure:true}]);
    console.info('Isolated CI auth route:',request.method(),source.pathname,response.status);
   }
   const headers=Object.fromEntries(response.headers);
   delete headers['content-length'];delete headers['content-encoding'];
   await route.fulfill({status:response.status,headers:{...headers,...cors},
    body:Buffer.from(await response.arrayBuffer())});
  });
  console.info('Using published production frontend with isolated CI API routing; no production data access');
  page.once('close',()=>{if(!isolatedCalls)console.error('No isolated API calls observed');});
 }
 const failures=[];
 page.on('pageerror',error=>{console.error('Browser JS exception:',error.stack??error.message);failures.push(error.message);});
 if(publishedSite){
  await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Email',{exact:true}).fill('developer@example.invalid');
  await page.getByLabel('Password',{exact:true}).fill(password);
  const login=page.waitForResponse(r=>r.url().includes('/api/auth/login?landing=1')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  assert.ok(isolatedCalls>0,'Published test login bypassed isolated CI API interception');
  assert.equal((await login).status(),200,'Published login form rejected the disposable CI tenant');
  await page.getByRole('button',{name:'User profile'}).waitFor({timeout:15000});
  console.info('Production frontend login form authenticated into CI SQL tenant');
 }
 if(process.env.METADRIVE_BROWSER_TARGET==='design2'){
  const {runDesign2BrowserCheck}=await import('./design2-browser-check.mjs');
  await runDesign2BrowserCheck({page,origin,db,tenantId,token:tokens.accessToken});
  const {runPageCreateBrowserCheck}=await import('./page-create-browser-check.mjs');
  await runPageCreateBrowserCheck({page,origin,db,tenantId,token:tokens.accessToken});
 }else if(process.env.METADRIVE_BROWSER_TARGET==='object-lifecycle'){
  const {runObjectSchemaLifecycleBrowserCheck}=await import('./object-schema-lifecycle-browser-check.mjs');
  await runObjectSchemaLifecycleBrowserCheck({page,origin,db,tenantId});
 }else if(process.env.METADRIVE_BROWSER_TARGET==='field-catalogue'){
  const {runFieldCatalogueBrowserCheck}=await import('./field-catalogue-browser-check.mjs');
  await runFieldCatalogueBrowserCheck({page,origin,db,tenantId});
 }else if(process.env.METADRIVE_BROWSER_TARGET==='relationship-integrity'){
  const {runRelationshipGraphBrowserCheck}=await import('./relationship-graph-browser-check.mjs');
  await runRelationshipGraphBrowserCheck({page,origin,db,tenantId,token:tokens.accessToken});
 }else if(process.env.METADRIVE_BROWSER_TARGET==='ui-route-audit'){
  const {auditAuthenticatedCoreRoutes}=await import('./authenticated-core-100pct-audit.mjs');
  await auditAuthenticatedCoreRoutes({page,origin,caseId});
 }else{
 await page.goto(origin+'/une/setup/flow-builder',{waitUntil:'domcontentloaded'});
 await page.getByText('Existing flows',{exact:true}).waitFor({state:'visible',timeout:20000});
 await page.screenshot({path:new URL('../artifacts/flow-builder.png',import.meta.url).pathname});
 await page.getByRole('button',{name:'New Flow',exact:true}).waitFor({timeout:30000});
 const title=await page.title();
 assert.ok(title.length>0,'UI document failed to mount');
 const status=await page.evaluate(async ({token})=>{
  const request=async (path,init={})=>{
   const response=await fetch('/api'+path,{
    ...init,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...init.headers}
   });
   const json=await response.json().catch(()=>({}));
   return {code:response.status,json};
  };
  const name='BrowserScreenFlow';
  const graph={apiName:name,label:'Browser Screen Flow',flowType:'Screen Flow',
   status:'Active',triggerObject:null,startConfig:{},resources:[],tests:[],versions:[],
   elements:[
    {id:1,type:'Start',label:'Start',config:{}},
    {id:2,type:'Screen',label:'Welcome',config:{fields:[{apiName:'Accepted',type:'Checkbox',label:'Accept',required:true}]}},
    {id:3,type:'End',label:'End',config:{}}
   ],connectors:[
    {id:'a',from:1,to:2,kind:'normal',label:'default'},
    {id:'b',from:2,to:3,kind:'normal',label:'Next'}
   ]};
  const saved=await request('/metadata/flows/'+name,{method:'PUT',body:JSON.stringify(graph)});
  if(saved.code!==200)return {failed:'Save',saved};
  const started=await request('/flows/'+name+'/execute',{method:'POST',body:'{}'});
  if(started.code!==200||started.json.screen?.id!==2)
   return {failed:'Start',started};
  const pending=await request('/flow-interviews/'+started.json.interviewId+'/next',{
   method:'POST',body:JSON.stringify({values:{Accepted:true}})});
  if(pending.code!==200||pending.json.completed!==true)
   return {failed:'Complete',pending};
  const history=await request('/metadata/flow-history?status=completed&limit=10');
  if(history.code!==200||!Array.isArray(history.json.runs)
    ||!history.json.runs.some(run=>run.flowApiName===name&&run.status==='completed'
      &&Number.isFinite(run.durationMs)))
    return {failed:'Flow history',history};
  const debug=await request('/flows/'+name+'/debug',{method:'POST',body:'{}'});
  if(debug.code!==200||debug.json.dryRun!==true||debug.json.status!=='waiting'
    ||!Array.isArray(debug.json.debugTrace)
    ||!debug.json.debugTrace.every(step=>typeof step.durationMs==='number'
      &&step.variables!==undefined))
    return {failed:'Flow debug trace',debug};
  const deleted=await request('/metadata/flows/'+name,{method:'DELETE'});
  return {saved:saved.code,started:started.code,completed:pending.code,
   history:history.code,debug:debug.code,archived:deleted.code};
 },{token:tokens.accessToken});
 assert.deepEqual(status,{saved:200,started:200,completed:200,history:200,debug:200,archived:204},
  'Real browser builder save/Screen Flow API check: '+JSON.stringify(status));


 // P0: exercise the actual SQL/HTTP contracts with a least-privilege kiosk user.
 await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3)",[
   tenantId,'kiosk-device@example.invalid',hash]);
 const kioskTokens=await new AuthenticationService(db).signIn(
   tenantId,'kiosk-device@example.invalid',password);
 const http=async(token,path,method='GET',body)=>{
   const response=await fetch('http://127.0.0.1:'+apiPort+'/api'+path,{
     method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
     ...(body?{body:JSON.stringify(body)}:{})
   });
   return {status:response.status,data:await response.json().catch(()=>({}))};
 };
 assert.equal((await http(kioskTokens.accessToken,'/metadata/permissions')).status,403,
   'Restricted kiosk actor accessed tenant administration');
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9SQCQAAAAASUVORK5CYII=';
 const media=await http(tokens.accessToken,'/media-assets','POST',{
   name:'demo-brand.png',contentType:'image/png',contentBase64:png
 });
 assert.equal(media.status,201,'Tenant asset upload failed: '+JSON.stringify(media));
 assert.ok(/^asset:[0-9a-f-]{36}$/i.test(media.data.assetRef));
 const loadedAsset=await http(tokens.accessToken,'/media-assets/'+media.data.id);
 assert.equal(loadedAsset.status,200,'Tenant asset retrieval failed');
 assert.equal(loadedAsset.data.contentBase64,png);
 assert.equal((await http(kioskTokens.accessToken,'/media-assets/'+media.data.id)).status,403,
   'Kiosk actor read private media without Files permission');
 const checkoutApi='P0CheckoutReplay';
 const graph={apiName:checkoutApi,label:'P0 Checkout Replay',flowType:'Autolaunched Flow',
   status:'Active',triggerObject:null,startConfig:{},tests:[],versions:[],
   resources:[{name:'requestId',label:'Request ID',type:'Variable',dataType:'Text',
     isCollection:false,availableForInput:true,availableForOutput:true,value:''}],
   elements:[{id:1,type:'Start',label:'Start',config:{}},
     {id:2,type:'End',label:'End',config:{}}],
   connectors:[{id:'s',from:1,to:2,kind:'normal',label:'Next'}]};
 const savedCheckout=await http(tokens.accessToken,'/metadata/flows/'+checkoutApi,'PUT',graph);
 assert.equal(savedCheckout.status,200,'Idempotent Flow metadata save failed: '+JSON.stringify(savedCheckout));
 const requestId='00000000-0000-4000-8000-000000000999';
 const initial=await http(tokens.accessToken,'/flows/'+checkoutApi+'/execute','POST',{requestId});
 assert.equal(initial.status,200,'First checkout execution failed: '+JSON.stringify(initial));
 const replay=await http(tokens.accessToken,'/flows/'+checkoutApi+'/execute','POST',{requestId});
 assert.equal(replay.status,200,'Checkout replay failed: '+JSON.stringify(replay));
 const result=await db.query(`
   SELECT count(*)::int AS count FROM md_flow_runs r
   JOIN md_flow_definitions f ON f.tenant_id=r.tenant_id AND f.id=r.flow_id
   WHERE f.tenant_id=$1 AND f.api_name=$2`,[tenantId,checkoutApi]);
 assert.equal(result.rows[0]?.count,1,'Duplicate checkout request created a second Flow run');
 const mismatch=await http(tokens.accessToken,'/flows/'+checkoutApi+'/execute','POST',
   {requestId,ChangedPrice:199});
 assert.ok(mismatch.status>=400,'Replayed checkout request accepted altered inputs');
 await http(tokens.accessToken,'/metadata/flows/'+checkoutApi,'DELETE');
 console.info('P0 SQL media, restricted kiosk RBAC and idempotent Flow replay verified');

 const choicesResult=await page.evaluate(async token=>{
   const request=async(path,init={})=>{
     const response=await fetch('/api'+path,{
       ...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}
     });
     return {code:response.status,body:await response.json().catch(()=>({}))};
   };
   const api='BrowserChoiceSetFlow';
   const graph={apiName:api,label:'Browser Choice Set Flow',flowType:'Screen Flow',
    status:'Active',triggerObject:null,startConfig:{},tests:[],versions:[],
    resources:[{name:'MealChoices',label:'Meal Choices',type:'Choice Set',dataType:'Text',
     isCollection:false,availableForInput:false,availableForOutput:false,value:'Burger\nWrap'}],
    elements:[{id:1,type:'Start',label:'Start',config:{}},
     {id:2,type:'Screen',label:'Choose',config:{fields:[{
       apiName:'Meal',label:'Meal',type:'Picklist',required:true,choiceSetResource:'MealChoices'
     }]}},{id:3,type:'End',label:'End',config:{}}],
    connectors:[{id:'a',from:1,to:2,kind:'normal',label:'Default'},
     {id:'b',from:2,to:3,kind:'normal',label:'Next'}]};
   const saved=await request('/metadata/flows/'+api,{method:'PUT',body:JSON.stringify(graph)});
   if(saved.code!==200)return {failed:'Choice Set save',saved};
   const badInterview=await request('/flows/'+api+'/execute',{method:'POST',body:'{}'});
   if(badInterview.code!==200)return {failed:'Choice Set launch',badInterview};
   const choices=badInterview.body.screen?.config?.fields?.[0]?.choices;
   if(!Array.isArray(choices)||choices.join('|')!=='Burger|Wrap')
     return {failed:'Choice Set hydration',choices,badInterview};
   const invalid=await request('/flow-interviews/'+badInterview.body.interviewId+'/next',{
     method:'POST',body:JSON.stringify({values:{Meal:'Not a valid meal'}})});
   if(invalid.code===200)return {failed:'Choice Set invalid-value rejection',invalid};
   const goodInterview=await request('/flows/'+api+'/execute',{method:'POST',body:'{}'});
   if(goodInterview.code!==200)return {failed:'Choice Set second launch',goodInterview};
   const valid=await request('/flow-interviews/'+goodInterview.body.interviewId+'/next',{
     method:'POST',body:JSON.stringify({values:{Meal:'Burger'}})});
   if(valid.code!==200||valid.body.completed!==true)
     return {failed:'Choice Set selected value',valid};
   const deleted=await request('/metadata/flows/'+api,{method:'DELETE'});
   return {saved:saved.code,invalid:invalid.code,completed:valid.code,deleted:deleted.code};
 },tokens.accessToken);
 assert.deepEqual(choicesResult,{saved:200,invalid:400,completed:200,deleted:204},
   'Browser SQL Choice Set runtime contract: '+JSON.stringify(choicesResult));

 // Phase 5: SQL-backed approval stage goes from active Flow to waiting and
 // atomically queues one resume after a human decision; no browser polling timer.
 const orchestration=await page.evaluate(async({token,caseId,userId})=>{
   const request=async(path,init={})=>{
     const response=await fetch('/api'+path,{
       ...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}
     });
     return {code:response.status,body:await response.json().catch(()=>({}))};
   };
   const api='BrowserApprovalFlow';
   const graph={apiName:api,label:'Browser Approval Flow',flowType:'Flow Orchestration',
    status:'Active',triggerObject:null,startConfig:{},tests:[],versions:[],resources:[],
    elements:[
     {id:1,type:'Start',label:'Start',config:{}},
     {id:2,type:'Orchestration Stage',label:'Manager Approval',config:{
       objectApiName:'ReviewCase',recordId:caseId,approverIds:userId,
       approvalMode:'ANY',comments:'Approval requested in browser contract test'
     }},
     {id:3,type:'End',label:'End',config:{}}
    ],
    connectors:[
     {id:'start',from:1,to:2,kind:'normal',label:''},
     {id:'approved',from:2,to:3,kind:'normal',label:'Approved'},
     {id:'rejected',from:2,to:3,kind:'normal',label:'Rejected'}
    ]};
   const saved=await request('/metadata/flows/'+api,{method:'PUT',body:JSON.stringify(graph)});
   if(saved.code!==200)return {failed:'Orchestration save',saved};
   const started=await request('/flows/'+api+'/execute',{method:'POST',body:'{}'});
   if(started.code!==200||started.body.status!=='waiting')
     return {failed:'Orchestration pause',started};
   const pending=await request('/metadata/flow-interviews');
   if(pending.code!==200||!pending.body.interviews.some(item=>
     item.id===started.body.interviewId&&item.kind==='orchestration'))
     return {failed:'Orchestration pending work',pending,started};
   const inbox=await request('/approvals/inbox');
   const approval=inbox.body.requests?.find(item=>item.flowApiName===api);
   if(inbox.code!==200||!approval)return {failed:'Orchestration approval inbox',inbox};
   const decision=await request('/approvals/'+approval.id+'/decision',{
     method:'POST',body:JSON.stringify({decision:'Approved',comments:'Accepted'})});
   if(decision.code!==200)return {failed:'Orchestration decision',decision};
   const second=await request('/approvals/'+approval.id+'/decision',{
     method:'POST',body:JSON.stringify({decision:'Rejected'})});
   if(second.code===200)return {failed:'Approval accepted twice',second};
   return {saved:saved.code,started:started.code,decision:decision.code,
     interviewId:started.body.interviewId,api};
 },{token:tokens.accessToken,caseId,userId});
 assert.ok(!orchestration.failed,'Browser orchestration: '+JSON.stringify(orchestration));
 const queued=await db.query(`
   SELECT j.id FROM md_durable_jobs j
   WHERE j.tenant_id=$1 AND j.resource_id=$2 AND j.job_type='flow.resume' AND j.status='queued'
 `,[tenantId,orchestration.interviewId]);
 assert.equal(queued.rows.length,1,'Human approval did not queue exactly one durable resume');
 const {FlowRuntime}=await import(new URL('flow-runtime.js',built).href);
 const {RbacEngine}=await import(new URL('rbac-engine.js',built).href);
 const {RecordEngine}=await import(new URL('record-engine.js',built).href);
 const rbac=new RbacEngine(db);
 const resumed=await new FlowRuntime(db,rbac,new RecordEngine(db,rbac))
   .resumeWaitingInterview(tenantId,userId,orchestration.interviewId,1);
 assert.equal(resumed.status,'completed','Approval decision did not resume the published Flow');
 const completed=await db.query(
   'SELECT status FROM md_flow_runs WHERE tenant_id=$1 AND id=$2',
   [tenantId,orchestration.interviewId]);
 assert.equal(completed.rows[0].status,'completed');



 // Phase 1: confirm SQL metadata and the actual no-code browser controls agree.
 const capabilities=await page.evaluate(async(token)=>{
   const response=await fetch('/api/metadata/flow-capabilities',{
     headers:{Authorization:'Bearer '+token}
   });
   return {status:response.status,body:await response.json()};
 },tokens.accessToken);
 assert.equal(capabilities.status,200,'Flow capability endpoint denied the builder');
 for(const flowType of ['Record-Triggered Flow','Schedule-Triggered Flow',
   'Platform Event-Triggered Flow'])
   assert.ok(capabilities.body.flowTypes.some(type=>type.type===flowType&&type.createEnabled),
     'Missing browser Flow type: '+flowType);
 for(const elementType of ['Get Records','Update Records','Delete Records','Subflow',
   'Collection Filter','Collection Sort','Transform','Publish Platform Event']){
   const element=capabilities.body.elements.find(item=>item.type===elementType);
   assert.ok(element?.builderEnabled&&element.builderFlowTypes.includes('Autolaunched Flow'),
     'Missing builder capability: '+elementType);
   const readOnly=['Get Records','Loop','Collection Filter','Collection Sort','Transform'];
   assert.equal(element.beforeSaveAllowed,readOnly.includes(elementType),
     'Incorrect before-save data-action gate: '+elementType);
 }
 await page.getByRole('button',{name:/Autolaunched Flow/}).first().click();
 await page.locator('#flow-start-label').fill('Phase One Browser Test');
 await page.getByRole('button',{name:'Create Flow',exact:true}).click();
 await page.locator('.flow-element-option').filter({hasText:'Get Records'}).waitFor();

 // Capture the real authenticated Flow Builder at the audit's phone/tablet widths.
 // Resize the same mounted React screen so this exercises the actual builder markup,
 // responsive CSS and Setup shell rather than a hand-built visual fixture.
 await (await import('node:fs/promises')).mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
 for(const {width,height} of [
   {width:390,height:844},
   {width:700,height:1100},
   {width:768,height:1024},
   {width:834,height:1194},
   {width:1024,height:768}
 ]){
   await page.setViewportSize({width,height});
   await page.waitForTimeout(150);
   const responsiveMetrics=await page.evaluate(()=>{
     const measure=selector=>{
       const element=document.querySelector(selector);
       if(!element)return null;
       const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
       return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,
         display:style.display,position:style.position,gridColumns:style.gridTemplateColumns};
     };
     return {viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,
       header:measure('.salesforce-header'),setupSidebar:measure('.setup-sidebar'),
       flowWorkarea:measure('.flow-workarea'),flowSettings:measure('.flow-settings')};
   });
   assert.ok(responsiveMetrics.flowWorkarea,
     'Actual Flow Builder canvas missing at '+width+'px');
   assert.ok(responsiveMetrics.documentWidth<=width+2,
     'Actual workspace horizontal overflow at '+width+'px: '+JSON.stringify(responsiveMetrics));
   assert.ok(responsiveMetrics.header&&responsiveMetrics.header.height<=56,
     'Actual workspace header exceeds 56px at '+width+'px: '+JSON.stringify(responsiveMetrics.header));
   if(width<600){
     // Phone mode uses a vertical step list and a tap-to-inspect sheet, not desktop dock.
     const steps=page.locator('.flow-mobile-step');
     try{
       await steps.first().waitFor({state:'visible',timeout:5000});
     }catch{
       const device=await page.evaluate(()=>({
         width:innerWidth,rootWidth:document.documentElement.clientWidth,
         phoneMedia:matchMedia('(max-width: 599px)').matches,
         coarse:matchMedia('(pointer:coarse)').matches,
         count:document.querySelectorAll('.flow-mobile-step').length,
         flowClasses:document.querySelector('.flow-workarea')?.className
       }));
       throw new Error('Phone Flow Builder steps missing: '+JSON.stringify(device));
     }
     await steps.first().click();
     const opened=await page.locator('.flow-settings').evaluate(element=>({
       display:getComputedStyle(element).display,position:getComputedStyle(element).position
     }));
     assert.ok(opened.display!=='none'&&opened.position==='fixed',
       'Phone step inspector must open as a bottom sheet: '+JSON.stringify(opened));
     await page.locator('.flow-mobile-inspector-header button').click();
     await page.locator('.flow-settings').waitFor({state:'hidden',timeout:2000});
   }else{
     assert.ok(responsiveMetrics.flowSettings&&responsiveMetrics.flowSettings.display!=='none',
       'Actual Flow Builder settings panel is hidden at '+width+'px: '+JSON.stringify(responsiveMetrics.flowSettings));
   }
   if(width>=600&&width<=820){
     assert.ok(['static','absolute'].includes(responsiveMetrics.flowSettings.position),
       'Actual Flow Builder inspector must remain visible at '+width+'px: '+JSON.stringify(responsiveMetrics.flowSettings));
   }else if(width>820){
     const columns=responsiveMetrics.flowWorkarea.gridColumns;
     assert.ok(width<1024 ? (/^56px/.test(columns)||columns===width+'px') : /^56px/.test(columns),
       'Flow Builder must show its tablet canvas or collapsible toolbox rail: '+JSON.stringify(responsiveMetrics.flowWorkarea));
     assert.equal(responsiveMetrics.flowSettings.position,'absolute',
       'Actual tablet inspector should overlay the canvas: '+JSON.stringify(responsiveMetrics.flowSettings));
   }
   if(width===834){
     await page.emulateMedia({colorScheme:'dark'});
     const darkInk=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--md-text').trim());
     assert.ok(darkInk!==''&&darkInk!=='#1d1d1f','iPad dark mode token not applied: '+darkInk);
     await page.screenshot({path:new URL('../artifacts/flow-builder-responsive-834-dark.png',import.meta.url).pathname,fullPage:true});
     await page.emulateMedia({colorScheme:'light'});
   }
   await page.screenshot({path:new URL('../artifacts/flow-builder-responsive-'+width+'.png',import.meta.url).pathname,fullPage:true});
   console.info('Actual Flow Builder responsive screenshot passed at '+width+'px',JSON.stringify(responsiveMetrics));
 }
 await page.setViewportSize({width:1440,height:900});
 await page.waitForTimeout(150);
 for(const elementType of ['Get Records','Update Records','Delete Records','Subflow',
   'Collection Filter','Collection Sort','Transform','Publish Platform Event'])
   assert.equal(await page.locator('.flow-element-option').filter({hasText:elementType}).count(),1,
     'Missing browser toolbox entry: '+elementType);
 await page.locator('.flow-element-option').filter({hasText:'Get Records'}).click();
 await page.getByText('Filter Records',{exact:true}).waitFor();
 const flowEditor=await page.evaluate(()=>document.querySelector('.flow-settings')?.textContent??'');
 assert.ok(flowEditor.includes('How Many Records to Store')&&flowEditor.includes('Filter Records'),
   'Get Records browser configuration is incomplete');

 // Phase 4: graph editing is an actual browser workflow, not merely toolbar decoration.
 await page.getByRole('button',{name:/Review graph/}).click();
 await page.getByRole('region',{name:'Flow graph review'}).waitFor();
 const beforeGraphNodes=await page.locator('.flow-graph-node').count();
 assert.ok(beforeGraphNodes>=3,'A new Flow must show connected graph nodes');
 const assignment=page.locator('.flow-element-option').filter({hasText:'Assignment'});
 await assignment.dragTo(page.locator('.flow-edge-insert').first());
 assert.equal(await page.locator('.flow-graph-node').count(),beforeGraphNodes+1,
   'Dragging an element onto a branch did not split the connector');
 await page.getByRole('button',{name:'Duplicate selected element'}).click();
 assert.equal(await page.locator('.flow-graph-node').count(),beforeGraphNodes+2,
   'Duplicating a selected graph element did not create a connected copy');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal(await page.locator('.flow-graph-node').count(),beforeGraphNodes+1,
   'Undo did not restore prior graph metadata');
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 assert.equal(await page.locator('.flow-graph-node').count(),beforeGraphNodes+2,
   'Redo did not reapply graph metadata');
 const pathTargets=await page.locator('.flow-edge-insert').count();
 assert.ok(pathTargets>=3,'Connectors must expose accessible insertion targets');

 const pageStatus=await page.evaluate(async ({token})=>{
  const payload={apiName:'BrowserPage',label:'Browser Page',targetObject:'',
   pageType:'Home Page',layoutMode:'free-canvas',canvasWidth:1280,canvasHeight:900,
   status:'Draft',devices:['Desktop'],components:[],activationAssignments:[]};
  const http=async(path,method='GET',body)=>{
   const result=await fetch('/api'+path,{
    method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})
   });
   return {status:result.status,content:result.status===204?null:await result.json().catch(()=>null)};
  };
  const saved=await http('/metadata/pages/BrowserPage','PUT',payload);
  const loaded=await http('/metadata/pages/BrowserPage');
  const deleted=await http('/metadata/pages/BrowserPage','DELETE');
  return {save:saved.status,load:loaded.status,delete:deleted.status,
   label:loaded.content?.page?.label??loaded.content?.label};
 },{token:tokens.accessToken});
 assert.equal(pageStatus.save,200,'Page Builder SQL save failed: '+JSON.stringify(pageStatus));
 assert.equal(pageStatus.load,200,'Page Builder SQL load failed: '+JSON.stringify(pageStatus));
 assert.equal(pageStatus.delete,204,'Page Builder SQL archive failed: '+JSON.stringify(pageStatus));
 const deactivation=await page.evaluate(async({token})=>{
   const call=async(path,method='GET',data)=>{
     const response=await fetch('/api'+path,{method,headers:{
       Authorization:'Bearer '+token,'Content-Type':'application/json'
     },...(data?{body:JSON.stringify(data)}:{})});
     return {code:response.status,body:response.status===204?null:await response.json().catch(()=>null)};
   };
   const name='Browser_Deactivate_Probe';
   const meta={apiName:name,label:'Deactivation Probe',targetObject:'',
     pageType:'App Page',layoutMode:'template',canvasWidth:1280,canvasHeight:900,
     status:'Draft',devices:['Desktop'],components:[],activationAssignments:[]};
   const create=await call('/metadata/pages/'+name,'PUT',meta);
   const draft=await call('/metadata/pages/'+name+'/layouts/Desktop/draft','PUT',{...meta,draftRevision:0});
   const publish=await call('/metadata/pages/'+name+'/layouts/Desktop/publish','POST',{
     draftRevision:draft.body?.page?.draftRevision});
   const before=await call('/metadata/pages/'+name);
   const stop=await call('/metadata/pages/'+name+'/deactivate','POST');
   const after=await call('/metadata/pages/'+name);
   const history=await call('/metadata/pages/'+name+'/layouts/Desktop/history');
   const restart=await call('/metadata/pages/'+name+'/layouts/Desktop/publish','POST',{
     draftRevision:draft.body?.page?.draftRevision});
   const reactivated=await call('/metadata/pages/'+name);
   await call('/metadata/pages/'+name,'DELETE');
   return {create:create.code,draft:draft.code,publish:publish.code,
     before:before.body?.page?.status,stop:stop.code,after:after.body?.page?.status,
     retained:history.body?.versions?.some(v=>v.published),
     restart:restart.code,reactivated:reactivated.body?.page?.status};
 },{token:tokens.accessToken});
 assert.equal(deactivation.create,200,'Deactivation test page creation failed');
 assert.equal(deactivation.draft,200,'Deactivation draft save failed');
 assert.equal(deactivation.publish,200,'Deactivation publish failed');
 assert.equal(deactivation.before,'Active');
 assert.equal(deactivation.stop,204);
 assert.equal(deactivation.after,'Draft');
 assert.equal(deactivation.retained,true,'Deactivation erased published history');
 assert.equal(deactivation.restart,200,'Reactivate must reuse the preserved draft');
 assert.equal(deactivation.reactivated,'Active');
 await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
 await page.waitForTimeout(1100);
 const {mkdir}=await import('node:fs/promises');
 await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
 await page.screenshot({path:new URL('../artifacts/page-builder.png',import.meta.url).pathname});

 // Guard against OS-dark CSS pairing a dark table with light-mode text (or
 // light table with dark-mode text) on the actual authenticated Page Builder.
 await page.emulateMedia({colorScheme:'dark'});
 const pageBuilderDarkOsContrast=await page.evaluate(()=>{
   const shell=document.querySelector('.lightning.md-setup-light');
   const table=document.querySelector('.page-manager-table');
   const heading=table?.querySelector('thead th');
   const cell=table?.querySelector('tbody td');
   if(!shell||!heading)return {missing:true};
   const luminance=(value)=>{
     const numbers=(value.match(/\d+(?:\.\d+)?/g)||[]).map(Number);
     if(numbers.length<3)return -1;
     const rgb=numbers.slice(0,3).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
     return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
   };
   const contrast=(element)=>{
     const style=getComputedStyle(element);
     const fg=luminance(style.color),bg=luminance(style.backgroundColor);
     return fg<0||bg<0?0:(Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05);
   };
   return {missing:false,scheme:getComputedStyle(shell).colorScheme,
     surface:getComputedStyle(shell).getPropertyValue('--md-surface').trim(),
     headingRatio:contrast(heading),cellRatio:cell?contrast(cell):null};
 });
 assert.equal(pageBuilderDarkOsContrast.missing,false,
   'Authenticated Page Builder page list was missing');
 assert.equal(pageBuilderDarkOsContrast.scheme,'light',
   'OS dark preference unexpectedly recoloured Setup');
 assert.ok(pageBuilderDarkOsContrast.headingRatio>=4.5,
   'Page Builder column heading is unreadable under OS dark preference: '+JSON.stringify(pageBuilderDarkOsContrast));
 assert.ok(pageBuilderDarkOsContrast.cellRatio===null||pageBuilderDarkOsContrast.cellRatio>=4.5,
   'Page Builder table cells are unreadable under OS dark preference: '+JSON.stringify(pageBuilderDarkOsContrast));
 await page.screenshot({path:new URL('../artifacts/page-builder-dark-os.png',import.meta.url).pathname});
 await page.emulateMedia({colorScheme:'light'});

 const {runPageCreateBrowserCheck}=await import('./page-create-browser-check.mjs');
 await runPageCreateBrowserCheck({page,origin,db,tenantId,token:tokens.accessToken});

 // Record Page ownership is Object Manager only. The general Page Builder
 // must not offer Record Page creation, while the shared editor remains reusable.
 assert.equal(await page.getByRole('radio',{name:/Record Page/i}).count(),0,
  'General Page Builder unexpectedly exposes Record Page creation');
 // Wait for the actual editor after navigation, not a fixed render delay.
 const recordManagerUrl=origin+'/une/setup/object-manager/ReviewCase/LightningRecordPages';
 await page.goto(recordManagerUrl,{waitUntil:'domcontentloaded'});
 await page.getByRole('region',{name:'Create Record Page'}).getByLabel('Page name').fill('Browser Verified Record');
 await page.getByRole('region',{name:'Create Record Page'}).getByLabel('Record operation').selectOption('View');
 const createDraftResponse=page.waitForResponse(r=>r.url().endsWith(
  '/api/metadata/pages/Browser_Verified_Record')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'Create Draft'}).click();
 assert.equal((await createDraftResponse).status(),200,'Object Manager failed to create SQL Record Page draft');
 // Object Manager must open the selected published/draft device editor directly,
 // without the redundant read-only "View → Edit" summary.
 assert.equal(await page.locator('.slds-table').getByRole('button',{name:'View',exact:true}).count(),0,
  'Record Pages still have an unnecessary read-only View action');
 for(const variant of ['Mobile','Tablet','Custom','Desktop']){
  await page.getByRole('button',{name:'Edit '+variant+' layout for Browser Verified Record'}).click();
  await page.getByLabel('Choose page layout').waitFor();
  await page.waitForFunction(expected=>
    document.querySelector('select[aria-label="Choose page layout"]')?.value===expected,
    variant,{timeout:10000});
  assert.ok(decodeURIComponent(new URL(page.url()).pathname).endsWith(
   '/ReviewCase/LightningRecordPages/Browser_Verified_Record/'+variant),
   'Record Page deep link did not preserve '+variant+' layout');
  await page.getByRole('button',{name:'Back to page list'}).click();
  await page.getByRole('button',{name:'Edit '+variant+' layout for Browser Verified Record'}).waitFor();
 }
 await page.getByRole('button',{name:'Edit Desktop layout for Browser Verified Record'}).click();
 await page.getByLabel('Choose page layout').waitFor();
 await page.getByRole('button',{name:'Page settings',exact:true}).click();
 await page.getByRole('button',{name:'Add Record Page Assignment'}).click();
 // Select the MAIN region first: adding from a prior component selection may nest inside Tabs.
 await page.getByRole('button',{name:'Edit main section'}).click();
 await page.getByRole('button',{name:'Sections',exact:true}).click();
 await page.getByRole('button',{name:'Add Container to canvas'}).click();
 await page.getByRole('button',{name:'Container component'}).first().waitFor({timeout:15000});
 const firstSave=page.waitForResponse(r=>r.url().endsWith(
  '/api/metadata/pages/Browser_Verified_Record/layouts/Desktop/draft')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'Save page'}).click();
 assert.equal((await firstSave).status(),200,'Builder Save did not create a private revision');
 const sqlPageRuntime=(await import(new URL('page-runtime.js',built).href)).PageRuntime;
 const sqlPage=new sqlPageRuntime(db);
 assert.equal((await sqlPage.metadata(tenantId,'Browser_Verified_Record')).status,'Draft',
  'Save must not silently activate a new page');
 assert.ok((await sqlPage.editor(tenantId,'Browser_Verified_Record','Desktop')).components.some(component=>component.type==='Container'),
  'New Record Page draft did not preserve the extra block');
 const initialPublish=page.waitForResponse(r=>r.url().endsWith(
  '/api/metadata/pages/Browser_Verified_Record/layouts/Desktop/publish')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Activate',exact:true}).click();
 assert.equal((await initialPublish).status(),200,'New page Activate UI failed to publish immutable layout');
 assert.equal((await sqlPage.metadata(tenantId,'Browser_Verified_Record')).status,'Active');
 assert.ok((await sqlPage.metadata(tenantId,'Browser_Verified_Record')).components.some(component=>component.type==='Container'),
  'Published Record Page did not retain the extra block');

 const browserRecordBaseWidth=(await sqlPage.metadata(tenantId,'Browser_Verified_Record','Desktop')).canvasWidth;
 // Publish distinct Mobile, Tablet and Custom layouts through the UI, then
 // reload each editor to prove SQL persistence instead of local React state.
 const layoutWidths={Mobile:430,Tablet:1120,Custom:1680};
 for(const [variant,width] of Object.entries(layoutWidths)){
  // A previously loaded editor may be served from the verified metadata cache
  // without another GET. Assert the selected UI state and published SQL outcome
  // instead of requiring an incidental network request on every switch.
  await page.getByLabel('Choose page layout').selectOption(variant);
  await page.waitForFunction(expected=>{
    const picker=document.querySelector('select[aria-label="Choose page layout"]');
    return picker?.value===expected;
  },variant,{timeout:5000});
  if(variant==='Custom'){
   // The Custom Canvas width/height controls live in the same left Design
   // dock as Smart component settings. Replacing digits must not snap back
   // while the number is temporarily empty or below the minimum.
   await page.locator('.page-preview-area [data-component-id]').first().click({position:{x:5,y:5}});
   await page.getByRole('tab',{name:'Design',exact:true}).click();
   const replaceCanvasNumber=async(input,next)=>{
    await input.focus();
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    assert.equal(await input.inputValue(),'');
    await input.pressSequentially(next);
    assert.equal(await input.inputValue(),next);
    await input.blur();
    assert.equal(await input.inputValue(),next);
   };
   const widthField=page.getByRole('spinbutton',{name:'Page width'});
   const heightField=page.getByRole('spinbutton',{name:'Page height'});
   await replaceCanvasNumber(widthField,'1680');
   const previousHeight=await heightField.inputValue();
   await replaceCanvasNumber(heightField,'994');
   await replaceCanvasNumber(heightField,previousHeight);
  }
  await page.getByRole('button',{name:'Page settings',exact:true}).click();
  await page.getByText('These settings belong only to the selected '+variant+' layout.').waitFor();
  await page.locator('.builder-layout-dimensions input').first().fill(String(width));
  const save=page.waitForResponse(r=>r.url().endsWith(
   '/api/metadata/pages/Browser_Verified_Record/layouts/'+variant+'/draft')&&r.request().method()==='PUT');
  await page.getByRole('button',{name:'Save page'}).click();
  assert.equal((await save).status(),200,variant+' UI Save failed');
  assert.notEqual((await sqlPage.metadata(tenantId,'Browser_Verified_Record',variant)).canvasWidth,width,
   variant+' draft was exposed before Publish');
  const publish=page.waitForResponse(r=>r.url().endsWith(
   '/api/metadata/pages/Browser_Verified_Record/layouts/'+variant+'/publish')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Publish',exact:true}).click();
  assert.equal((await publish).status(),200,variant+' UI Publish failed');
  assert.equal((await sqlPage.metadata(tenantId,'Browser_Verified_Record',variant)).canvasWidth,width);
 }
 assert.equal((await sqlPage.metadata(tenantId,'Browser_Verified_Record','Desktop')).canvasWidth,browserRecordBaseWidth,
  'Publishing other layouts must not change Desktop');
 assert.equal((await sqlPage.resolveRecordPage(tenantId,'ReviewCase','Records','','master','Desktop'))?.apiName,
  'Browser_Verified_Record','Publishing a new device layout must retain live Desktop routing');

 // Restore the Custom version only after the device switch has hydrated.
 // A stale Desktop route must never silently restore a different variant.
 await page.getByLabel('Choose page layout').selectOption('Custom');
 await page.waitForFunction(()=>{
  const selected=document.querySelector('select[aria-label="Choose page layout"]');
  return selected?.value==='Custom';
 },undefined,{timeout:10000});
 await page.getByRole('button',{name:'Version history'}).click();
 await page.getByRole('button',{name:'Restore draft'}).last().waitFor();
 page.once('dialog',dialog=>void dialog.accept());
 const restored=page.waitForResponse(r=>r.url().includes(
  '/api/metadata/pages/Browser_Verified_Record/layouts/')&&r.url().endsWith('/restore')
  &&r.request().method()==='POST');
 await page.getByRole('button',{name:'Restore draft'}).last().click();
 const layoutRestoreResponse=await restored;
 assert.ok(layoutRestoreResponse.url().endsWith('/layouts/Custom/restore'),
  'Restored wrong layout variant: '+layoutRestoreResponse.url());
 assert.equal(layoutRestoreResponse.status(),200,'Restore draft UI action failed');
 assert.equal((await sqlPage.metadata(tenantId,'Browser_Verified_Record','Custom')).canvasWidth,1680,
  'Restore must not modify the published layout');
 assert.equal((await sqlPage.editor(tenantId,'Browser_Verified_Record','Custom')).canvasWidth,browserRecordBaseWidth);
 const reSave=page.waitForResponse(r=>r.url().endsWith(
  '/api/metadata/pages/Browser_Verified_Record/layouts/Custom/draft')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'Save page'}).click();
 assert.equal((await reSave).status(),200,'Saving a restored draft failed');
 const rePublish=page.waitForResponse(r=>r.url().endsWith(
  '/api/metadata/pages/Browser_Verified_Record/layouts/Custom/publish')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Publish',exact:true}).click();
 assert.equal((await rePublish).status(),200,'Publishing a restored draft failed');
 assert.equal((await sqlPage.metadata(tenantId,'Browser_Verified_Record','Custom')).canvasWidth,browserRecordBaseWidth);
 assert.equal((await sqlPage.metadata(tenantId,'Browser_Verified_Record','Mobile')).canvasWidth,430);
 assert.equal((await sqlPage.metadata(tenantId,'Browser_Verified_Record','Tablet')).canvasWidth,1120);
 // Verify OneEngine is enforced on every variant endpoint, even though the
 // read/write owner can use exactly the same paths through the Page Builder.
 assert.equal((await http(kioskTokens.accessToken,
  '/metadata/pages/Browser_Verified_Record/layouts/Custom/editor')).status,403,
  'Unprivileged tenant user could read a private Page draft');
 assert.equal((await http(kioskTokens.accessToken,
  '/metadata/pages/Browser_Verified_Record/layouts/Custom/history')).status,403,
  'Unprivileged tenant user could read private Page history');
 assert.equal((await http(kioskTokens.accessToken,
  '/metadata/pages/Browser_Verified_Record/layouts/Custom/draft','PUT',
  await sqlPage.editor(tenantId,'Browser_Verified_Record','Custom'))).status,403,
  'Unprivileged tenant user could save a Page draft');
 assert.equal((await http(kioskTokens.accessToken,
  '/metadata/pages/Browser_Verified_Record/layouts/Custom/publish','POST',{draftRevision:1})).status,403,
  'Unprivileged tenant user could publish Page metadata');
 assert.equal((await http(kioskTokens.accessToken,
  '/metadata/pages/Browser_Verified_Record/layouts/Custom/restore','POST',{version:1})).status,403,
  'Unprivileged tenant user could restore a Page version');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByLabel('Choose page layout').waitFor();
 const mobileReload=page.waitForResponse(r=>r.url().endsWith(
  '/api/metadata/pages/Browser_Verified_Record/layouts/Mobile/editor')&&r.request().method()==='GET');
 await page.getByLabel('Choose page layout').selectOption('Mobile');
 assert.equal((await mobileReload).status(),200,'Mobile editor failed after page reload');
 await page.getByRole('button',{name:'Page settings',exact:true}).click();
 await page.getByText('These settings belong only to the selected Mobile layout.').waitFor();
 assert.equal(await page.locator('.builder-layout-dimensions input').first().inputValue(),'430',
  'Mobile published layout did not hydrate after a real browser reload');
 await page.screenshot({path:new URL('../artifacts/page-builder-published.png',import.meta.url).pathname});
 console.info('Authenticated Page Builder: create, add block, save, activate, device publish, restore, reload passed');

 // Flow Builder's actual list screen was captured at the initial visit.
 // Avoid reopening a lazy route solely for an extra screenshot.
 await page.goto(origin+'/une/setup/flow-builder',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'New Flow',exact:true}).waitFor({timeout:30000});
 await page.screenshot({path:new URL('../artifacts/flow-builder.png',import.meta.url).pathname});
 // Exercise the actual permission-editor Save button, refresh and SQL round-trip.
 await page.goto(origin+'/une/setup/rbac',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Profiles',exact:true}).click();
 await page.getByRole('button',{name:'New Profile',exact:true}).click();
 await page.getByLabel('Label',{exact:true}).fill('Browser Cashier Profile');
 await page.getByLabel('API Name',{exact:true}).fill('BrowserCashierProfile');
 const savedProfile=page.waitForResponse(r=>r.url().endsWith('/api/metadata/permissions')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'Save Changes',exact:true}).click();
 const profileResponse=await savedProfile;
 assert.equal(profileResponse.status(),200,await profileResponse.text());
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Profiles',exact:true}).click();
 await page.getByRole('button',{name:/Browser Cashier Profile/}).click();
 assert.equal(await page.getByLabel('Label',{exact:true}).inputValue(),'Browser Cashier Profile');
 const sqlProfile=await db.query('SELECT label FROM md_profiles WHERE tenant_id=$1 AND api_name=$2',[tenantId,'BrowserCashierProfile']);
 assert.equal(sqlProfile.rows[0]?.label,'Browser Cashier Profile');
 await page.getByRole('button',{name:'Permission Sets',exact:true}).click();
 await page.getByRole('button',{name:'New Permission Set',exact:true}).click();
 await page.getByLabel('Label',{exact:true}).fill('Browser Cashier Set');
 await page.getByLabel('API Name',{exact:true}).fill('BrowserCashierSet');
 await page.getByLabel('Description',{exact:true}).fill('Saved from the real browser');
 const savedSet=page.waitForResponse(r=>r.url().endsWith('/api/metadata/permissions')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'Save Changes',exact:true}).click();
 const setResponse=await savedSet;
 assert.equal(setResponse.status(),200,await setResponse.text());
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Permission Sets',exact:true}).click();
 await page.getByRole('button',{name:/Browser Cashier Set/}).click();
 assert.equal(await page.getByLabel('Description',{exact:true}).inputValue(),'Saved from the real browser');
 await page.screenshot({path:new URL('../artifacts/rbac-editor.png',import.meta.url).pathname});
 console.info('RBAC browser Save/refresh/SQL checks passed for profile creation and permission-set metadata');
 // Phase 1: verify the actual Records browser can restore a SQL-tombstoned record
 // and the tenant administrator can publish an audited retention policy.
 const recordEngine=new RecordEngine(db,rbac);
 await page.goto(origin+'/une/o/BrowserRecycle__c/list',{waitUntil:'domcontentloaded'});
 const recycleButton=page.getByRole('button',{name:'Recycle Bin',exact:true});
 await recycleButton.waitFor({state:'visible',timeout:15000});
 await recycleButton.click();
 await page.getByRole('heading',{name:'Browser Recycle Recycle Bin'}).waitFor({timeout:12000});
 await page.getByText(recycleId,{exact:true}).waitFor({timeout:12000});
 await page.getByLabel('Record retention days').fill('30');
 page.once('dialog',dialog=>void dialog.accept());
 const policyResponse=page.waitForResponse(resp=>resp.url().endsWith('/api/recycle-bin/retention')
   &&resp.request().method()==='PUT');
 await page.getByRole('button',{name:'Save Retention'}).click();
 assert.equal((await policyResponse).status(),200,'Browser retention policy save failed');
 assert.equal((await db.query(
  'SELECT retention_days FROM md_record_retention_settings WHERE tenant_id=$1',[tenantId]
 )).rows[0].retention_days,30);
 page.once('dialog',dialog=>void dialog.accept());
 const recycleRestoreResponse=page.waitForResponse(resp=>resp.url().endsWith(
  '/api/recycle-bin/records/BrowserRecycle__c/'+recycleId+'/restore'));
 await page.getByRole('button',{name:'Restore',exact:true}).click();
 assert.equal((await recycleRestoreResponse).status(),200,'Browser record recovery failed');
 assert.equal((await recordEngine.get(tenantId,userId,'BrowserRecycle__c',recycleId)).Name,
   'Browser recovery test');
 await page.screenshot({path:new URL('../artifacts/recycle-bin.png',import.meta.url).pathname});
 console.info('Browser Recycle Bin and policy editor restore/SQL checks passed');
 // Phase 2: configure a global action without code, publish to tenant SQL,
 // then verify the generic Records browser exposes and routes it.
 // Object Manager now starts with an Object directory; each setting opens a
 // read-only list/detail before its existing metadata editor is activated.
 await page.goto(origin+'/une/setup/object-manager',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Object Manager',exact:true}).waitFor({timeout:15000});
 await page.getByRole('table').getByText('BrowserRecycle__c',{exact:true}).waitFor({timeout:15000});
 await page.goto(origin+'/une/setup/object-manager/BrowserRecycle__c/Details',
   {waitUntil:'domcontentloaded'});
 await page.getByText('Object definition · Read only').waitFor({timeout:15000});
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await page.getByRole('heading',{name:'Edit Details',exact:true}).waitFor();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByText('Object definition · Read only').waitFor();
 await page.goto(origin+'/une/setup/object-manager/BrowserRecycle__c/ValidationRules',
   {waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Validation Rules',exact:true}).waitFor({timeout:15000});
 await page.getByRole('button',{name:'New Rule',exact:true}).waitFor();
 // Legacy Page Layout bookmarks are redirected into the unified Object Record Pages editor.
 await page.goto(origin+'/une/setup/object-manager/BrowserRecycle__c/PageLayouts',
   {waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Lightning Record Pages',exact:true}).waitFor({timeout:15000});
 await page.getByRole('button',{name:'Create Draft',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Page Layouts',exact:true}).count(),0,
   'Separate Page Layouts editor is still exposed in Object Manager');
 await page.goto(origin+'/une/setup/object-manager/BrowserRecycle__c/ButtonsLinksAndActions',
   {waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'New / Configure'}).click();
 await page.getByRole('heading',{name:'Global Quick Actions'}).waitFor({timeout:15000});
 await page.getByLabel('New global action name').fill('Browser Global Create');
 await page.getByLabel('Global action target Object').selectOption('BrowserRecycle__c');
 await page.getByRole('button',{name:'Add Global Action'}).click();
 const savedGlobal=page.waitForResponse(res=>res.url().endsWith('/api/metadata/global-actions')
   &&res.request().method()==='PUT');
 await page.getByRole('button',{name:'Save Global Actions'}).click();
 assert.equal((await savedGlobal).status(),200,'Global action browser save failed');
 const globalSql=await db.query(`SELECT action_id,target_object_api FROM md_global_quick_actions
   WHERE tenant_id=$1 AND label='Browser Global Create'`,[tenantId]);
 assert.equal(globalSql.rowCount,1,'Global action did not reach tenant SQL');
 await page.goto(origin+'/une/o/BrowserRecycle__c/list',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Global actions'}).waitFor({timeout:12000});
 await page.getByRole('button',{name:'Global actions'}).click();
 await page.getByRole('menuitem',{name:'Browser Global Create'}).click();
 await page.waitForURL(/globalActionId=/);
 assert.ok(page.url().includes('BrowserRecycle__c'),'Global action routed to incorrect Object');
 await page.screenshot({path:new URL('../artifacts/global-quick-action.png',import.meta.url).pathname});
 console.info('Browser global Quick Action creation and runtime navigation passed');
 // Archive through Object Manager; record pages are no longer in Page Builder.
 await page.goto(recordManagerUrl,{waitUntil:'domcontentloaded'});
 const pageDeleteButton=page.getByRole('button',{name:'Archive Browser Verified Record'});
 await pageDeleteButton.waitFor({timeout:15000});
 page.once('dialog',dialog=>void dialog.accept());
 const pageArchive=page.waitForResponse(res=>res.url().endsWith(
   '/api/metadata/pages/Browser_Verified_Record')&&res.request().method()==='DELETE');
 await pageDeleteButton.click();
 assert.equal((await pageArchive).status(),204,'Object Manager archive failed');
 await pageDeleteButton.waitFor({state:'detached',timeout:10000});
 const archivedPage=await db.query('SELECT enabled FROM md_page_definitions WHERE tenant_id=$1 AND api_name=$2',
   [tenantId,'Browser_Verified_Record']);
 assert.equal(archivedPage.rows[0]?.enabled,false,'Page Builder UI delete did not deactivate SQL Page');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM md_lightning_page_details d JOIN md_page_definitions p ON p.id=d.page_id AND p.tenant_id=d.tenant_id WHERE p.tenant_id=$1 AND p.api_name=$2',
   [tenantId,'Browser_Verified_Record'])).rows[0]?.n,1,'Page archive removed saved SQL metadata');
 console.info('Page Builder Delete UI archived the Page without losing SQL metadata');
 if(!publishedSite){
  const {runObjectSchemaLifecycleBrowserCheck}=await import('./object-schema-lifecycle-browser-check.mjs');
  await runObjectSchemaLifecycleBrowserCheck({page,origin,db,tenantId});
 }
 if(publishedSite)assert.ok(await page.evaluate(()=>
  location.origin==='https://unesolutions.co.uk'),'Live smoke did not use production frontend');
 const severe=failures.filter(message=>/TypeError|Cannot read properties|ReferenceError/i.test(message));
 assert.deepEqual(severe,[],'Browser runtime exceptions: '+severe.join(' | '));
 console.info('Browser UI loaded: Page save/load/archive and Flow save/start/submit/complete/archive passed');
 }
}catch(error){
 if(page){
  console.error('Browser failure URL:',page.url());
  console.error('Browser failure text:',(await page.locator('body').innerText().catch(()=>'' )).slice(0,4000));
  await page.screenshot({path:new URL('../artifacts/rbac-failure.png',import.meta.url).pathname}).catch(()=>{});
 }
 throw error;
}finally{
 if(browser)await browser.close();
 if(frontend){frontend.kill('SIGTERM');}
 if(listener.listening)await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
 await db.close();
}
