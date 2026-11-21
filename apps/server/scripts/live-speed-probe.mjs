// Speed budgets that need no browser (real PostgreSQL, run in CI with a disposable database):
// 1. Live changes: a saved record is announced (NOTIFY) within LIVE_BUDGET_MS of its commit;
//    a rolled-back save and a screen presence ping announce nothing.
// 2. Page open: the lists of a page read together (as POST /api/records-batch does) stay
//    within BATCH_BUDGET_MS, and are not slower than reading them one after another.
// 3. Live for everything, server half: a save reaches every open screen of one shared login
//    (more than the old 20-stream cap) over the real GET /api/live-changes stream, WITH the
//    saved rows, within LIVE_E2E_BUDGET_MS; a user without read access hears nothing; a
//    closed screen is dropped at once.
// Prints the numbers and fails past a budget.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg,{Pool} from 'pg';
import {SqlPersistence} from '../src/system-files/sql-persistence.ts';
import {applySystemMigrations} from '../src/system-support/system-migrations.ts';
import {activateNativeObject} from '../src/system-support/native-object-storage.ts';
import {ObjectDefinitionService} from '../src/system-files/object-definition.ts';
import {RecordEngine} from '../src/system-files/record-engine.ts';
import {RbacEngine} from '../src/system-files/rbac-engine.ts';
import express from 'express';
import {once} from 'node:events';
import {LiveChangeHub,recordRowReader,registerLiveChangeRoutes} from '../src/system-support/live-changes.ts';

const LIVE_BUDGET_MS=Number(process.env.LIVE_BUDGET_MS??100);
const BATCH_BUDGET_MS=Number(process.env.BATCH_BUDGET_MS??250);
const LIVE_E2E_BUDGET_MS=Number(process.env.LIVE_E2E_BUDGET_MS??500);
const SCREENS=Number(process.env.LIVE_SCREENS??40);
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')throw Error('Disposable SQL database required');
const setup=new Pool({connectionString:url});
await setup.query('CREATE SCHEMA live_probe');await setup.end();
const isolated=new URL(url);isolated.searchParams.set('options','-c search_path=live_probe,native_api_test,public');
const db=new SqlPersistence(isolated.toString());
const listener=new pg.Client({connectionString:isolated.toString()});
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
let hub=null,server=null;const streams=[];
try{
 await db.query(readFileSync(new URL('../src/system-files/schema.sql',import.meta.url),'utf8'));
 await applySystemMigrations(db);
 const definitions=new ObjectDefinitionService(db),records=new RecordEngine(db,new RbacEngine(db));
 const tenant=(await db.query("INSERT INTO md_tenants(slug,name) VALUES('live','live') RETURNING id")).rows[0].id;
 const user=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'live@example.invalid','fixture') RETURNING id",[tenant])).rows[0].id;
 const set=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'Live') RETURNING id",[tenant])).rows[0].id;
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[tenant,user,set]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",[tenant,set]);
 const objects=['LiveA','LiveB','LiveC','LiveD','LiveE'];
 for(const object of objects){
  await definitions.create(tenant,object,object,[
   {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
   {apiName:'Grp',label:'Group',dataType:'Text(40)'},
   {apiName:'Amount',label:'Amount',dataType:'Number(12,2)'}]);
  await activateNativeObject(db,tenant,object);
  for(let index=0;index<40;index++)await records.create(tenant,user,object,{Name:object+' '+index,Grp:index%2?'odd':'even',Amount:index});
 }

 // 1. Live changes.
 await listener.connect();
 const heard=[];
 listener.on('notification',message=>{
  if(message.channel!=='md_live_changes')return;
  const payload=JSON.parse(message.payload??'{}');
  if(payload.t===tenant)heard.push({at:performance.now(),payload});
 });
 await listener.query('LISTEN md_live_changes');
 const waitFor=async(test,ms)=>{
  const until=performance.now()+ms;
  while(performance.now()<until){const found=heard.find(test);if(found)return found;await new Promise(resolve=>setTimeout(resolve,2));}
  return null;
 };
 const delays=[];
 for(let round=0;round<10;round++){
  heard.length=0;
  const id=await records.create(tenant,user,'LiveA',{Name:'Live '+round,Amount:round});
  const committed=performance.now();
  const notice=await waitFor(item=>item.payload.k==='record'&&item.payload.ids?.includes(id),1000);
  assert(notice,'a saved record is announced');
  assert.equal(notice.payload.o,'LiveA');
  delays.push(Math.max(0,notice.at-committed));
 }
 heard.length=0;
 const updated=(await records.list(tenant,user,'LiveB',1,0)).records[0].Id;
 await records.update(tenant,user,'LiveB',updated,{Amount:999});
 const committedUpdate=performance.now();
 const updateNotice=await waitFor(item=>item.payload.k==='record'&&item.payload.ids?.includes(updated),1000);
 assert(updateNotice,'an updated record is announced');
 assert.equal(updateNotice.payload.op,'update');
 delays.push(Math.max(0,updateNotice.at-committedUpdate));
 // A rolled-back save announces nothing.
 heard.length=0;
 await db.transaction(async()=>{
  await records.create(tenant,user,'LiveC',{Name:'Rolled back'});
  throw Error('rollback');
 }).catch(error=>{if(error.message!=='rollback')throw error;});
 assert.equal(await waitFor(item=>item.payload.o==='LiveC',200),null,'a rolled-back save is not announced');
 // A screen presence ping (seen_at only) announces nothing; a sale change does.
 await db.query("INSERT INTO md_screen_devices(tenant_id,device_key,seen_at) VALUES($1,'live-probe-device-0000001',now())",[tenant]);
 await waitFor(item=>item.payload.k==='screen',200);
 heard.length=0;
 await db.query("UPDATE md_screen_devices SET seen_at=now() WHERE tenant_id=$1 AND device_key='live-probe-device-0000001'",[tenant]);
 assert.equal(await waitFor(item=>item.payload.k==='screen',200),null,'a presence ping is not announced');
 await db.query("UPDATE md_screen_devices SET session_key=gen_random_uuid() WHERE tenant_id=$1 AND device_key='live-probe-device-0000001'",[tenant]);
 assert(await waitFor(item=>item.payload.k==='screen'&&item.payload.d==='live-probe-device-0000001',1000),'a sale change is announced');
 const liveMedian=median(delays),liveWorst=Math.max(...delays);
 console.info('live changes: commit -> notice median '+liveMedian.toFixed(1)+' ms, worst '+liveWorst.toFixed(1)+' ms (budget '+LIVE_BUDGET_MS+' ms)');
 assert(liveMedian<=LIVE_BUDGET_MS,'live change notice over budget: '+liveMedian.toFixed(1)+' ms');

 // 2. Page open: read the page's lists together vs one after another (warm, 5 runs each).
 const read=object=>records.list(tenant,user,object,50,0,{filters:[{field:'Grp',operator:'eq',value:'even'}]});
 await Promise.all(objects.map(read));
 const together=[],oneByOne=[];
 for(let run=0;run<5;run++){
  let started=performance.now();
  const answers=await Promise.all(objects.map(read));
  together.push(performance.now()-started);
  assert(answers.every(answer=>answer.total===20),'every list answers its own rows');
  started=performance.now();
  for(const object of objects)await read(object);
  oneByOne.push(performance.now()-started);
 }
 const batchMedian=median(together),sequentialMedian=median(oneByOne);
 console.info('page open, '+objects.length+' lists: together '+batchMedian.toFixed(1)+' ms, one by one '+sequentialMedian.toFixed(1)
  +' ms (budget '+BATCH_BUDGET_MS+' ms)');
 assert(batchMedian<=BATCH_BUDGET_MS,'page lists read together over budget: '+batchMedian.toFixed(1)+' ms');
 // Read together must not be slower than one after another (small margin for timer noise).
 assert(batchMedian<=sequentialMedian*1.2+5,'reading together is slower than one by one');

 // 3. Live for everything, server half (real Express route, RBAC and row reads).
 const blocked=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'blocked@example.invalid','fixture') RETURNING id",[tenant])).rows[0].id;
 hub=new LiveChangeHub(db,new RbacEngine(db),recordRowReader(records));
 const app=express();
 app.use((req,_res,next)=>{req.actor={tenant_id:tenant,user_id:req.get('x-probe-user')==='blocked'?blocked:user};next();});
 registerLiveChangeRoutes(app,hub);
 app.use((error,_req,res,_next)=>{res.status(error.status??500).json({error:error.message});});
 server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 /** One screen: its stream, the events it got and when. */
 const openScreen=async who=>{
  const controller=new AbortController();
  const response=await fetch(base+'/api/live-changes',{headers:{'x-probe-user':who},signal:controller.signal});
  assert.equal(response.status,200,'a stream opens for screen '+streams.length);
  const screen={who,controller,events:[],ready:false};
  void (async()=>{
   const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
   try{for(;;){
    const chunk=await reader.read();if(chunk.done)break;
    pending+=decoder.decode(chunk.value,{stream:true});
    for(let at=pending.indexOf('\n\n');at>=0;at=pending.indexOf('\n\n')){
     const frame=pending.slice(0,at);pending=pending.slice(at+2);
     const name=/^event: (.*)$/m.exec(frame)?.[1];const data=/^data: (.*)$/m.exec(frame)?.[1];
     if(name==='ready')screen.ready=true;
     else if(name)screen.events.push({at:performance.now(),name,data:JSON.parse(data??'{}')});
    }
   }}catch{/* aborted */}
  })();
  streams.push(screen);
  return screen;
 };
 const until=async(test,ms)=>{const end=performance.now()+ms;while(performance.now()<end){if(test())return true;await new Promise(r=>setTimeout(r,2));}return test();};
 const screens=[];
 for(let index=0;index<SCREENS;index++)screens.push(await openScreen('shop'));
 const outsider=await openScreen('blocked');
 assert(await until(()=>streams.every(item=>item.ready),5000),'every screen is connected');
 assert.equal(hub.count(tenant),SCREENS+1,SCREENS+' screens of one login are all served');
 // The hub listens from the first screen; give LISTEN a moment.
 await new Promise(r=>setTimeout(r,300));
 const e2e=[];
 for(let round=0;round<5;round++){
  const sent=performance.now();
  const id=await records.create(tenant,user,'LiveD',{Name:'Screen '+round,Amount:round});
  const got=item=>item.events.find(event=>event.name==='change'&&event.data.ids?.includes(id));
  assert(await until(()=>screens.every(got),LIVE_E2E_BUDGET_MS*4),'every screen hears the save');
  for(const item of screens){
   const event=got(item);
   assert.equal(event.data.object,'LiveD');
   assert.equal(event.data.rows?.[0]?.Name,'Screen '+round,'the saved row travels with the change');
   e2e.push(event.at-sent);
  }
  // The same row again at once (quantity +1): every screen hears that too.
  await records.update(tenant,user,'LiveD',id,{Amount:round+100});
  assert(await until(()=>screens.every(item=>item.events.some(event=>event.name==='change'&&event.data.ids?.includes(id)
   &&event.data.rows?.[0]?.Amount===round+100)),LIVE_E2E_BUDGET_MS*4),'a quick second change is heard');
 }
 assert.equal(outsider.events.filter(event=>event.name==='change').length,0,'no read access: nothing is sent');
 const e2eMedian=median(e2e),e2eWorst=Math.max(...e2e);
 console.info('live for everything: save -> '+SCREENS+' screens with rows, median '+e2eMedian.toFixed(1)+' ms, worst '
  +e2eWorst.toFixed(1)+' ms (budget '+LIVE_E2E_BUDGET_MS+' ms)');
 assert(e2eWorst<=LIVE_E2E_BUDGET_MS,'live change to screens over budget: '+e2eWorst.toFixed(1)+' ms');
 // Closed screens are dropped at once, so their places are free for the windows that reconnect.
 const closedAt=performance.now();
 for(const item of screens.slice(0,SCREENS/2))item.controller.abort();
 assert(await until(()=>hub.count(tenant)===SCREENS/2+1,1000),'closed screens are dropped: '+hub.count(tenant)+' left');
 console.info('closed screens dropped in '+(performance.now()-closedAt).toFixed(1)+' ms');
}finally{
 for(const item of streams)item.controller.abort();
 if(server){server.closeAllConnections?.();server.close();}
 await hub?.stop().catch(()=>undefined);
 await listener.end().catch(()=>undefined);await db.close();
}
