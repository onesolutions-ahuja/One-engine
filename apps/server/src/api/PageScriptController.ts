import type {Express,Request,Response} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {PageRuntime} from '../system-files/page-runtime.js';
import type {ObjectDefinitionService} from '../system-files/object-definition.js';
import {pageLayoutVariant} from '../system-files/page-layout-version-runtime.js';
import {authenticated,wrap,api} from './ApiAuthenticationGuard.js';
import {PageScriptService,compiledActionKeyPattern} from '../page-compiler/pageScriptService.js';
import {registerPublishedCodeBuilder} from '../page-compiler/source/publishedPageCodeSetup.js';
import {setAppPackageObjectsLoader,storedAppPackage,latestAppPackage,appPackageIssues,PACKAGE_VARIANT,type StoredScreen} from '../page-compiler/source/appPackage.js';
import {compilePage} from '../page-compiler/compilePage.js';
import {startPageCodeFolder} from '../page-compiler/source/pageCodeFolder.js';
import type {CompilerObject,CompilerPage} from '../page-compiler/compilePage.js';
import {executePageCodeAction,pageCodeAggregates,loadPageRecordSets,parsePageCodeRequest} from '../system-support/page-code-runtime.js';
import {deviceTill,setDeviceTill,pairingDevice} from '../system-support/till-assignment-service.js';
import {readLiveRelay,relayChanges,type LiveRelay} from '../system-support/live-changes.js';
import type {GuestAccessService} from '../system-support/guest-access-service.js';
import type {ScreenPairingService} from '../system-support/screen-pairing-service.js';


/**
 * Compiled page scripts (Page Builder Preview).
 *
 *  POST /api/pages/:apiName/script-ticket            signed-in: one-time 60 s ticket (saved page)
 *  POST /api/pages/:apiName/preview-script           Builder: convert the draft on screen (not saved)
 *  GET  /api/page-scripts/:ticket.js                 the server-built module (ticket = login)
 *
 * Scripts are built only from SAVED page metadata, so nothing a browser sends
 * becomes code. Every request re-checks the user's permissions.
 */
import {stampDeviceCarts,validDeviceKey,DEVICE_OFFLINE_AT} from '../system-support/device-presence-service.js';
/** This site's address as the browser used it (links made by an action, e.g. GUESTLINK). */
function requestOrigin(req:Request):string{
 const origin=req.get('origin');
 if(origin&&/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(origin))return origin;
 const host=req.get('host');
 return host&&/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)?(req.secure?'https://':'http://')+host:'';
}
export type PageScriptDeps={db:SqlPersistence;rbac:RbacEngine;records:RecordEngine;pages:PageRuntime;
 definitions:ObjectDefinitionService;scripts:PageScriptService;screens?:ScreenPairingService;guests?:GuestAccessService;
 verifyPin?:(actor:{tenant_id:string;user_id:string},pin:unknown,userId?:unknown)=>Promise<boolean>;
 /** Live stream hub: a tap's predicted change and its saved answer reach the same login's
  * other screens at once (set once the hub exists). */
 live?:{relay(actor:{tenant_id:string;user_id:string},event:'preview'|'settled',data:LiveRelay):Promise<number>}};

const scopeKey=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
/** Scope sent with a page code action: bounded, plain keys only. */
export function validActionScope(scope:unknown):scope is Record<string,unknown>{
 return Boolean(scope&&typeof scope==='object'&&!Array.isArray(scope)
  &&Object.keys(scope).length<=80
  &&Object.keys(scope).every(key=>scopeKey.test(key)&&!['constructor','prototype','__proto__'].includes(key)));
}
const asCompilerPage=(page:unknown)=>page as CompilerPage;
const asCompilerObjects=(objects:unknown)=>objects as CompilerObject[];

/** Registered BEFORE the /api bearer-token guard: the ticket is the login. */
export function registerPageScriptPublicRoute(app:Express,deps:PageScriptDeps){
 // A published page's code file by its build id. The id is a hash of tenant + app +
 // the generated code, so the same code always has the same URL: the browser keeps it
 // (immutable) and a page opened again needs no page-file request. The file holds the
 // page design only (layout, formulas, actions), never records; data still needs a login.
 app.get('/api/page-builds/:appId/:buildId',wrap(async(req,res)=>{
  const appId=String(req.params.appId??''),buildId=String(req.params.buildId??'').replace(/\.js$/,'');
  res.setHeader('X-Content-Type-Options','nosniff');
  const build=api.test(appId)&&/^[A-Za-z0-9_-]{32}$/.test(buildId)?deps.scripts.publishedBuild(appId,buildId):null;
  if(!build){res.setHeader('Cache-Control','no-store');res.status(404).type('text/plain').send('Not found');return;}
  res.setHeader('Content-Type','text/javascript; charset=utf-8');
  res.setHeader('Cache-Control','private, max-age=31536000, immutable');
  res.setHeader('ETag',build.etag);
  res.send(build.code);
 }));
 // The app package by hash: one file for the whole published app. The hash already names the
 // code, so the same code always has the same URL and the device keeps it (immutable).
 // Design only: it holds no records, so data still needs a login and its access checks.
 app.get('/api/app-packages/:appId/:variant/:hash',wrap(async(req,res)=>{
  const appId=String(req.params.appId??'');
  // One package holds every layout ("All"); older per-layout packages are still served.
  const asked=String(req.params.variant??'');
  const variant=asked===PACKAGE_VARIANT?PACKAGE_VARIANT:pageLayoutVariant(asked||'Desktop');
  const hash=String(req.params.hash??'').replace(/\.js$/,'');
  res.setHeader('X-Content-Type-Options','nosniff');
  const found=api.test(appId)&&/^[A-Za-z0-9_-]{32}$/.test(hash)
   ?await storedAppPackage(deps.db,appId,variant,hash):null;
  if(!found){res.setHeader('Cache-Control','no-store');res.status(404).type('text/plain').send('Not found');return;}
  res.setHeader('Content-Type','text/javascript; charset=utf-8');
  res.setHeader('Cache-Control','private, max-age=31536000, immutable');
  res.setHeader('ETag','"'+found.hash+'"');
  res.send(found.code);
 }));
 app.get('/api/page-scripts/:ticket',wrap(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const ticket=deps.scripts.consumeTicket(String(req.params.ticket??'').replace(/\.js$/,''));
  if(!ticket){res.status(404).type('text/plain').send('Not found');return;}
  if(ticket.buildId&&ticket.appId){
   // Published app page: anyone who can open the App (same check as loading the page).
   await deps.rbac.require(ticket.tenantId,ticket.userId,'App:'+ticket.appId,'read');
   const build=deps.scripts.appBuild(ticket.tenantId,ticket.appId,ticket.buildId);
   if(!build){res.status(404).type('text/plain').send('Not found');return;}
   res.setHeader('Content-Type','text/javascript; charset=utf-8');
   res.setHeader('ETag',build.etag);
   res.send(build.code);
   return;
  }
  await deps.rbac.require(ticket.tenantId,ticket.userId,'PageDefinition','read');
  if(ticket.previewId){
   // The user's own Preview build of unsaved edits.
   const preview=deps.scripts.preview(ticket.tenantId,ticket.userId,ticket.previewId);
   if(!preview){res.status(404).type('text/plain').send('Not found');return;}
   res.setHeader('Content-Type','text/javascript; charset=utf-8');
   res.setHeader('ETag',preview.etag);
   res.send(preview.code);
   return;
  }
  await deps.rbac.require(ticket.tenantId,ticket.userId,'ObjectDefinition','read');
  const variant=pageLayoutVariant(ticket.variant);
  const page=await deps.pages.editor(ticket.tenantId,ticket.apiName,variant);
  const objects=await deps.definitions.list(ticket.tenantId);
  const built=deps.scripts.build({tenantId:ticket.tenantId,apiName:ticket.apiName,variant},
   asCompilerPage(page),asCompilerObjects(objects));
  res.setHeader('Content-Type','text/javascript; charset=utf-8');
  res.setHeader('ETag',built.etag);
  res.send(built.code);
 }));
}

/** How long a converted page is reused before Object definitions are re-read. */
const APP_INPUT_REUSE_MS=120_000;
/** Convert a published app page the user was served and issue its one-time ticket.
 * Used by POST /api/apps/:appId/page-script and by the page routes themselves
 * (?script=1), which saves the browser a whole round trip before the page runs. */
export async function issueAppPageScript(deps:PageScriptDeps,actor:{tenant_id:string;user_id:string},
 appId:string,page:unknown,variantInput:unknown,timing?:string[]):Promise<{ticket:string;buildId:string}>{
 if(!page||typeof page!=='object'||Array.isArray(page)||!Array.isArray((page as {components?:unknown}).components)
   ||(page as {components:unknown[]}).components.length>500)throw new Error('Invalid page');
 const variant=pageLayoutVariant(variantInput??'Desktop');
 const inputKey=PageScriptService.appInputKey(actor.tenant_id,appId,variant,page);
 let result=deps.scripts.recentAppBuild(inputKey,APP_INPUT_REUSE_MS);
 if(result)timing?.push('build;desc="reused";dur=0');
 else{
  const started=performance.now();
  const objects=asCompilerObjects(await deps.definitions.list(actor.tenant_id));
  const loaded=performance.now();
  result=deps.scripts.buildAppPage(actor.tenant_id,appId,asCompilerPage(page),objects);
  deps.scripts.rememberAppInput(inputKey,result.buildId);
  timing?.push('objects;dur='+(loaded-started).toFixed(1),'compile;dur='+(performance.now()-loaded).toFixed(1));
 }
 const ticket=deps.scripts.issueTicket(actor.tenant_id,actor.user_id,result.built.compiled.apiName,variant,undefined,
  {buildId:result.buildId,appId});
 return {ticket,buildId:result.buildId};
}

export function registerPageScriptRoutes(app:Express,deps:PageScriptDeps){
  registerPublishedCodeBuilder(deps.definitions);
 // The code folder on the server (UNE_PAGE_CODE_ROOT): edits made there run at once.
 void startPageCodeFolder(deps.db,deps.pages).catch(error=>console.error('code folder failed to start',error));
 // The package is built from the same Object definitions the page script uses.
 setAppPackageObjectsLoader(tenantId=>deps.definitions.list(tenantId) as unknown as
  Promise<readonly CompilerObject[]>);
 /**
  * The server's own copy of every screen in an app's package (its actions run here), built
  * from the page design stored WITH the package: exactly what the device runs. Kept per
  * package hash; rebuilt after a restart the first time a device of that app taps.
  */
 const packageBuilds=new Map<string,Promise<Record<string,string>>>();
 const appPackageBuilds=(tenantId:string,appId:string,found:{hash:string;pages:Record<string,StoredScreen>})=>{
  const memo=tenantId+'\u0000'+appId+'\u0000'+found.hash;
  let pending=packageBuilds.get(memo);
  if(!pending){
   pending=(async()=>{
    const objects=asCompilerObjects(await deps.definitions.list(tenantId));
    const builds:Record<string,string>={};
    for(const [key,screen] of Object.entries(found.pages)){
     try{
      // The screen's own code files: the server runs the same actions the device runs.
      const plan=compilePage(asCompilerPage(screen.page),objects,{strictLegacy:true});
      builds[key]=(await deps.scripts.buildAppPageFromCode(tenantId,appId,plan,screen.files,screen.pageApi)).buildId;
     }catch(error){console.error('app package build failed',key,error);}
    }
    return builds;
   })();
   pending.catch(()=>packageBuilds.delete(memo));
   if(packageBuilds.size>=200)packageBuilds.delete(packageBuilds.keys().next().value!);
   packageBuilds.set(memo,pending);
  }
  return pending;
 };
 // Page code (v2). The build is the server's own copy of the saved/published page
 // (or this user's own Preview of unsaved edits); the browser names only the action.
 const codeBuild=async(actor:{tenant_id:string;user_id:string},appId:string,body:Record<string,unknown>)=>{
  if(appId){
   if(!api.test(appId))throw new Error('Invalid app');
   await deps.rbac.require(actor.tenant_id,actor.user_id,'App:'+appId,'read');
   const buildId=String(body.buildId??'');
   const built=deps.scripts.appBuild(actor.tenant_id,appId,buildId);
   if(built||!buildId)return built;
   // Not in memory (server restarted): a screen of the app's package builds again from
   // the design stored with it. A build of an older design stays unknown (republished).
   const found=await latestAppPackage(deps.db,actor.tenant_id,appId).catch(()=>null);
   if(found)await appPackageBuilds(actor.tenant_id,appId,found);
   return deps.scripts.appBuild(actor.tenant_id,appId,buildId);
  }
  await deps.rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
  return typeof body.previewId==='string'?deps.scripts.preview(actor.tenant_id,actor.user_id,body.previewId):null;
 };
 const codeRoutes=(prefix:string,appParam:boolean)=>{
  app.post(prefix+'/page-code/execute',wrap(async(req,res)=>{
   const actor=authenticated(req);
   res.setHeader('Cache-Control','private, no-store');
   const body=(req.body??{}) as Record<string,unknown>;
   const build=await codeBuild(actor,appParam?String(req.params.appId):'',body);
   const key=String(body.key??'');
   if(!build||!compiledActionKeyPattern.test(key)){res.json({ok:false,stale:true,error:'This page was republished; reload it'});return;}
   const started=performance.now();
   const source=build.pageCode.actions.find(item=>item.key===key)?.js??'';
   // The tap's prediction goes to the same login's other screens (a customer display) now,
   // before the save: they show it as fast as the till itself.
   const request=parsePageCodeRequest(body.request,{ip:req.ip,agent:req.get('user-agent'),
    origin:requestOrigin(req)});
   const live=deps.live?readLiveRelay(body.live):null;
   // Which device and sale tapped: a display following that device moves to the sale at once.
   const from={...(request.deviceKey?{device:request.deviceKey}:{}),...(request.sessionId?{session:request.sessionId}:{})};
   if(live?.changes?.length)void deps.live!.relay(actor,'preview',{batch:live.batch,...from,changes:live.changes}).catch(()=>undefined);
   // @ThisPage.Device.Ip / Agent: what the server itself saw, never what the browser says.
   const result=await executePageCodeAction(deps,actor,build.serverCode,key,request,source);
   res.setHeader('Server-Timing','action;dur='+(performance.now()-started).toFixed(1));
   res.json(result);
   // The answer replaces the prediction there (saved rows, or ok false: it is taken back).
   // A device step (result.needs) is not an answer yet: the browser sends the action again.
   if(live&&!result.needs){
    const saved=result.ok?relayChanges(result.changes)??[]:[];
    void deps.live!.relay(actor,'settled',{batch:live.batch,ok:Boolean(result.ok),...from,changes:saved}).catch(()=>undefined);
   }
  }));
  app.post(prefix+'/page-code/aggregates',wrap(async(req,res)=>{
   const actor=authenticated(req);
   res.setHeader('Cache-Control','private, no-store');
   const body=(req.body??{}) as Record<string,unknown>;
   const build=await codeBuild(actor,appParam?String(req.params.appId):'',body);
   if(!build){res.json({ok:false,stale:true,values:[]});return;}
   res.json({ok:true,values:await pageCodeAggregates(deps,actor,parsePageCodeRequest(body.request),body.items)});
  }));
  app.post(prefix+'/page-code/sets',wrap(async(req,res)=>{
   const actor=authenticated(req);
   res.setHeader('Cache-Control','private, no-store');
   const body=(req.body??{}) as Record<string,unknown>;
   const build=await codeBuild(actor,appParam?String(req.params.appId):'',body);
   if(!build){res.json({ok:false,stale:true,sets:{}});return;}
   const started=performance.now();
   const sets=await loadPageRecordSets(deps,actor,build.serverCode,parsePageCodeRequest(body.request));
   res.setHeader('Server-Timing','sets;dur='+(performance.now()-started).toFixed(1));
   res.json({ok:true,sets});
  }));
 };
 // Which Till this device is (@ThisPage.Till.*), and setting a device up as a Till.
 app.post('/api/till-device/current',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  const body=(req.body??{}) as {deviceKey?:unknown;attachedDevices?:unknown};
  res.json(await deviceTill(deps,actor,body.deviceKey,body.attachedDevices));
 }));
 // Device presence: open while the app is open on this device (see device-presence-service).
 app.get('/api/device-presence',wrap(async(req,res)=>{
  const actor=authenticated(req);
  const deviceKey=req.query.key;
  if(!validDeviceKey(deviceKey))throw new Error('Invalid device key');
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Accel-Buffering','no');
  res.flushHeaders();
  let closed=false,ticks=0;
  const stamp=(at:string)=>Promise.all([stampDeviceCarts(deps.records,actor,deviceKey,at),
   // Presence also decides whether a till is "in use" when another device asks for it.
   deps.screens?.deviceSeen(actor,deviceKey,at!==DEVICE_OFFLINE_AT).catch(()=>undefined)]);
  await stamp(new Date().toISOString());
  // A ping every 25 s keeps proxies from closing the line; the carts are stamped every minute.
  const timer=setInterval(()=>{
   if(closed)return;
   res.write(': ping\n\n');
   if(++ticks%2===0)void stamp(new Date().toISOString());
  },25_000);
  req.on('close',()=>{closed=true;clearInterval(timer);void stamp(DEVICE_OFFLINE_AT);});
 }));
 app.post('/api/till-device/assign',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  const body=(req.body??{}) as Record<string,unknown>;
  // A till in use on another open device: taking it over needs its screen's corner code.
  if(deps.screens&&typeof body.tillId==='string'&&/^[0-9a-f-]{36}$/i.test(body.tillId)){
   const till=await deps.records.get(actor.tenant_id,actor.user_id,'NamedDevice',body.tillId).catch(()=>null) as Record<string,unknown>|null;
   const holder=typeof till?.DeviceId==='string'?till.DeviceId:'';
   if(holder&&holder!==body.deviceKey)await deps.screens.checkTakeover(actor,holder,String(till?.Name??''),body.takeoverCode);
  }
  res.json({till:await setDeviceTill(deps,actor,body.deviceKey,body.tillId,
   {ip:req.ip,agent:req.get('user-agent')})});
 }));
 // Paired screens (/display) for any app: this signed-in device pairs a screen by its code.
 const screens=()=>{if(!deps.screens)throw Error('Paired screens are unavailable');return deps.screens;};
 app.post('/api/screens/approve',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  const body=(req.body??{}) as Record<string,unknown>;
  // PAIRGUEST(App, RecordId): a table's tablet, paired as that record's guest (App Manager > Guest access).
  if(body.guestRecordId!==undefined){
   if(!deps.guests)throw Error('Guest tablets are unavailable');
   const guest=await deps.guests.pairingGuest(actor,{appId:body.appId,recordId:body.guestRecordId});
   res.json(await screens().approveGuest(actor,body.code,guest,body.appId,body.name));
   return;
  }
  const device=await pairingDevice(deps.records,actor,body.deviceKey);
  const mfa=await screens().sessionMfa(String(req.get('authorization')??'').slice(7));
  res.json(await screens().approve(actor,mfa,body.code,device,body.appId,body.pageApiName,body.name));
 }));
 app.post('/api/screens/list',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  const body=(req.body??{}) as Record<string,unknown>;
  // A table's tablets are listed by the table (Security manage, as pairing them).
  if(typeof body.guestRecordId==='string'&&/^[0-9a-f-]{36}$/i.test(body.guestRecordId)){
   await deps.rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
   res.json({screens:await screens().list(actor,body.guestRecordId),device:''});return;
  }
  const device=await pairingDevice(deps.records,actor,body.deviceKey);
  res.json({screens:await screens().list(actor,device.id),device:device.name});
 }));
 app.post('/api/screens/rename',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  const body=(req.body??{}) as Record<string,unknown>;
  res.json(await screens().rename(actor,body.id,body.name));
 }));
 // The sale a device is on: its selling page reports its session; paired screens follow it.
 app.post('/api/screens/session',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  const body=(req.body??{}) as Record<string,unknown>;
  res.json(await screens().reportSession(actor,body.deviceKey,body.sessionId));
 }));
 app.post('/api/screens/current-session',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  res.json(await screens().currentSession(actor,(req.body??{}).mirrorKey));
 }));
 // SCREEN(page, n): the screens following this device that show page switch to layer n.
 app.post('/api/screens/layer',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  const body=(req.body??{}) as Record<string,unknown>;
  res.json(await screens().showLayer(actor,body.deviceKey,body.page,body.layer));
 }));
 app.post('/api/screens/corner',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  const body=(req.body??{}) as Record<string,unknown>;
  res.json(await screens().cornerCode(actor,body.screenKey,body.mirrorKey));
 }));
 app.post('/api/screens/revoke',wrap(async(req,res)=>{
  const actor=authenticated(req);
  res.setHeader('Cache-Control','private, no-store');
  res.json(await screens().revoke(actor,(req.body??{}).id));
 }));
 codeRoutes('/api/apps/:appId',true);
 codeRoutes('/api/pages/:apiName',false);
 // The published code this app's devices keep: the newest stored package, by hash.
 // One package holds every layout; the device picks the layout as the page routes do.
 app.get('/api/apps/:appId/package',wrap(async(req,res)=>{
  const actor=authenticated(req),appId=String(req.params.appId);
  if(!api.test(appId))throw new Error('Invalid app');
  await deps.rbac.require(actor.tenant_id,actor.user_id,'App:'+appId,'read');
  let found=await latestAppPackage(deps.db,actor.tenant_id,appId);
  // First open after the switch was turned on: build it now (once; later publishes rebuild it).
  if(!found&&await runsPublishedCode(actor.tenant_id,appId)){
   await deps.pages.rebuildAppPackage(actor.tenant_id,appId);
   found=await latestAppPackage(deps.db,actor.tenant_id,appId);
  }
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Vary','Authorization, Cookie');
  if(!found){res.json({hash:'',url:'',pages:[],builds:{}});return;}
  const builds=await appPackageBuilds(actor.tenant_id,appId,found);
  res.json({hash:found.hash,pages:Object.keys(found.pages),builds,
   url:'/api/app-packages/'+encodeURIComponent(appId)+'/'+PACKAGE_VARIANT+'/'+found.hash+'.js'});
 }));
 const runsPublishedCode=async(tenantId:string,appApi:string)=>{
  const {rows}=await deps.db.query<{enabled:boolean}>(`SELECT m.run_published_code AS enabled FROM md_tenant_app_metadata m
   JOIN md_apps a ON a.id=m.app_id WHERE m.tenant_id=$1 AND COALESCE(m.api_name,a.api_name)=$2`,[tenantId,appApi]);
  return rows[0]?.enabled===true;
 };
 // Publish code for a whole app without republishing any page: every screen without code
 // files gets them (a code version), and the package is rebuilt from the code files.
 app.post('/api/apps/:appId/package/rebuild',wrap(async(req,res)=>{
  const actor=authenticated(req),appId=String(req.params.appId);
  if(!api.test(appId))throw new Error('Invalid app');
  await deps.rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
  await deps.rbac.require(actor.tenant_id,actor.user_id,'App:'+appId,'read');
  const hash=await deps.pages.rebuildAppPackage(actor.tenant_id,appId);
  const found=hash?await latestAppPackage(deps.db,actor.tenant_id,appId):null;
  res.setHeader('Cache-Control','private, no-store');
  res.json({hash:found?.hash??'',screens:Object.keys(found?.pages??{}),issues:appPackageIssues(actor.tenant_id,appId)});
 }));
 app.post('/api/pages/:apiName/script-ticket',wrap(async(req,res)=>{
  const actor=authenticated(req);
  if(!api.test(req.params.apiName))throw new Error('Invalid page API name');
  await deps.rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
  const variant=pageLayoutVariant(req.body?.variant??'Desktop');
  res.setHeader('Cache-Control','private, no-store');
  const ticket=deps.scripts.issueTicket(actor.tenant_id,actor.user_id,req.params.apiName,variant);
  res.json({ticket,url:'/api/page-scripts/'+ticket+'.js'});
 }));
 // Published app pages (end users): convert the page this user was served by
 // /api/apps/:appId/pages|home-page|in-screen-pages. Needs only App access.
 app.post('/api/apps/:appId/page-script',wrap(async(req,res)=>{
  const actor=authenticated(req);
  if(!api.test(req.params.appId))throw new Error('Invalid app');
  await deps.rbac.require(actor.tenant_id,actor.user_id,'App:'+req.params.appId,'read');
  const timing:string[]=[];
  const {ticket,buildId}=await issueAppPageScript(deps,actor,req.params.appId,req.body?.page,req.body?.variant,timing);
  res.setHeader('Cache-Control','private, no-store');
  if(timing.length)res.setHeader('Server-Timing',timing.join(', '));
  res.json({ticket,buildId,url:'/api/page-scripts/'+ticket+'.js'});
 }));
 app.post('/api/pages/:apiName/preview-script',wrap(async(req,res)=>{
  const actor=authenticated(req);
  if(!api.test(req.params.apiName))throw new Error('Invalid page API name');
  // Converting a draft needs the same right as saving one; nothing is stored or published.
  await deps.rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
  await deps.rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
  const variant=pageLayoutVariant(req.body?.variant??'Desktop');
  const page=req.body?.page;
  if(!page||typeof page!=='object'||Array.isArray(page)||!Array.isArray((page as {components?:unknown}).components)
    ||(page as {components:unknown[]}).components.length>500)throw new Error('Invalid preview page');
  const {previewId}=deps.scripts.buildPreview(actor.tenant_id,actor.user_id,req.params.apiName,variant,
   asCompilerPage(page),asCompilerObjects(await deps.definitions.list(actor.tenant_id)));
  res.setHeader('Cache-Control','private, no-store');
  const ticket=deps.scripts.issueTicket(actor.tenant_id,actor.user_id,req.params.apiName,variant,previewId);
  res.json({ticket,previewId,url:'/api/page-scripts/'+ticket+'.js'});
 }));
}
