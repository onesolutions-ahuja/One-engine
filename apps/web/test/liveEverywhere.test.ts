/**
 * Live for everything: a save on one screen shows on every other screen from the live
 * stream, within LIVE_BUDGET_MS. Drives the real browser data layer (compiledPageStore),
 * source loader, page code (held record sets and server totals), live stream client
 * (liveChanges) and page wiring (pageLiveWiring, mirrorLiveRefresh) against a fake server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const TILL_KEY='till-device-key-000000000001';
// A browser window for the device helpers: this display follows TILL_KEY (?mirror=).
const store=()=>{const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};};
Object.assign(globalThis,{window:{__uneDeviceKey:TILL_KEY,location:{search:'?mirror='+TILL_KEY,pathname:'/display'},
 localStorage:store(),sessionStorage:store(),addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}}});

const {compilePage}=await import('../src/core/pages/PageCompiler/compilePage');
const {createCompiledDataLayer}=await import('../src/core/pages/PageCompiler/compiledPageStore');
const {compiledSourceLoader}=await import('../src/core/pages/PageCompiler/compiledSourceLoader');
const {createPageCodeRuntime}=await import('../src/core/pages/PageCompiler/pageCodeRuntime');
const live=await import('../src/core/pages/PageCompiler/liveChanges');
const {connectPageLive,mergeLiveChange}=await import('../src/core/pages/PageCompiler/pageLiveWiring');
const {startMirrorLiveRefresh}=await import('../src/core/pages/PageCompiler/mirrorLiveRefresh');
const {buildPageCode,pageCodeModule}=await import('../../server/src/page-compiler/code/pageCode');
const {F,O,aggregateRows,rowMatches}=await import('../../server/src/page-compiler/code/formulaLibrary');

const LIVE_BUDGET_MS=500;
/** Stops left by a failed test, so the next test starts with no stream open. */
const cleanups:Array<()=>void>=[];
test.afterEach(()=>{for(const stop of cleanups.splice(0))stop();live.setLiveStreamOpener(null);});
type Row=Record<string,unknown>;
type Criteria=Array<[string,unknown]>;
const field=(apiName:string,dataType='Text')=>({apiName,label:apiName,dataType,required:false,unique:false});
const objects=[
 {apiName:'Product',label:'Product',pluralLabel:'Products',kind:'Custom Object',description:'',fields:[field('Name'),field('Price','Currency')]},
 {apiName:'CartLine',label:'Cart Line',pluralLabel:'Cart Lines',kind:'Custom Object',description:'',
  fields:[field('Name'),field('Product'),field('Quantity','Number'),field('LineTotal','Currency'),field('Status'),field('session_key__c'),field('DeviceKey')]}
] as never;
const c=(id:string,type:string,properties:Record<string,unknown>)=>({id,type,label:id,visible:true,properties});
const pageOf=(apiName:string,components:unknown[])=>({apiName,label:apiName,targetObject:'',pageType:'App Page',
 layoutMode:'free-canvas',status:'Draft',devices:['Desktop'],components}) as never;
const addLine='=ACTIONS(GETRECORD(CartLine, session_key__c, @ThisPage.Session.Id, Product, @recordId, Status, "Open", AS(line)), IF(ISBLANK(line.Id), CREATERECORD(CartLine, Product, @recordId, Name, @record.Name, Quantity, 1, LineTotal, @record.Price, session_key__c, @ThisPage.Session.Id, Status, "Open"), UPDATERECORD(CartLine, line.Id, Quantity, line.Quantity + 1)))';
/** Any app's page: a table, a sorted card grid, a chart's rows, held totals and server totals. */
const tillPage=pageOf('till',[
 c('table','Custom:smart_table',{objectApiName:'CartLine',filterFormula:'@CartLine.Status = "Open"'}),
 c('grid','Custom:smart_card_grid',{objectApiName:'CartLine',filterFormula:'@CartLine.Status = "Open"',sortField:'Name',sortDirection:'asc'}),
 c('chart','Custom:smart_chart',{objectApiName:'CartLine'}),
 c('either','Custom:smart_table',{objectApiName:'CartLine',filterFormula:'OR(@CartLine.Status = "Open", @CartLine.Status = "Held")'}),
 c('products','Custom:smart_card_grid',{objectApiName:'Product',actionFlows:{click:{actionType:'Formula',formula:addLine}}}),
 c('held','Custom:smart_text',{textSource:'=SUMIFS(CartLine, LineTotal, session_key__c, @ThisPage.Session.Id, Status, "Open")'}),
 c('total','Custom:smart_text',{textSource:'=SUMIFS(CartLine, LineTotal, Status, "Open")'}),
 c('count','Custom:smart_text',{textSource:'=COUNTIFS(CartLine, Status, "Open", Name, "Cola")'})
]);
/** A customer display following a till (any app): its rows and totals name the till's key. */
const displayPage=pageOf('display',[
 c('cart','Custom:smart_cart',{objectApiName:'CartLine',filterFormula:'AND(@CartLine.DeviceKey = @ThisPage.Device.MirrorKey, @CartLine.Status = "Open")'}),
 c('due','Custom:smart_text',{textSource:'=SUMIFS(CartLine, LineTotal, DeviceKey, @ThisPage.Device.MirrorKey, Status, "Open")'})
]);

const tick=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
async function within(what:string,check:()=>boolean,budget=LIVE_BUDGET_MS):Promise<number>{
 const started=performance.now();
 while(!check()){
  if(performance.now()-started>budget)assert.fail(what+': not shown within '+budget+' ms');
  await tick(2);
 }
 return performance.now()-started;
}

/** The server: rows in memory, the Record API, page-code sets/totals and the live stream. */
class FakeServer{
 rows=new Map<string,Row[]>();
 reads:Array<{object:string;fresh:boolean}>=[];
 streams=new Set<ReadableStreamDefaultController<Uint8Array>>();
 opens=0;refuse=0;
 private next=100;
 private codes:Array<{recordSets:Array<{key:string;object:string;criteria($:unknown):Criteria}>}>=[];
 constructor(){this.rows.set('Product',[{Id:'p-cola',Name:'Cola',Price:2},{Id:'p-tea',Name:'Tea',Price:3}]);this.rows.set('CartLine',[]);}
 id(){return '00000000-0000-4000-8000-'+String(++this.next).padStart(12,'0');}
 table(object:string){return this.rows.get(object)??[];}
 loadPage=async(object:string,options:{limit:number;offset:number;filter?:{field:string;value:string};
  filters?:Array<{field:string;operator:string;value:string}>;filterLogic?:string;sortField?:string;sortDirection?:string;forceRefresh?:boolean})=>{
  this.reads.push({object,fresh:Boolean(options.forceRefresh)});
  await tick(1);
  const test=(row:Row,f:{field:string;operator:string;value:string})=>
   f.operator==='eq'?String(row[f.field]??'')===f.value:f.operator==='isBlank'?row[f.field]==null||row[f.field]==='':true;
  const filters=options.filters??[];
  const or=/\bOR\b/i.test(options.filterLogic??'');
  let rows=this.table(object).filter(row=>!filters.length||(or?filters.some(f=>test(row,f)):filters.every(f=>test(row,f))))
   .filter(row=>!options.filter||String(row[options.filter.field]??'')===options.filter.value);
  if(options.sortField){
   const key=options.sortField,dir=options.sortDirection==='desc'?-1:1;
   rows=[...rows].sort((a,b)=>dir*String(a[key]??'').toLowerCase().localeCompare(String(b[key]??'').toLowerCase())||String(a.Id).localeCompare(String(b.Id)));
  }
  return {records:rows.slice(options.offset,options.offset+options.limit).map(row=>({...row})),total:rows.length};
 };
 /** Page code routes (POST /apps/:id/page-code/sets | aggregates). */
 request=async<T>(path:string,init?:RequestInit):Promise<T>=>{
  await tick(1);
  const body=JSON.parse(String(init?.body??'{}'));
  if(path.endsWith('/page-code/sets')){
   const sets:Record<string,{rows:Row[];complete:boolean}>={};
   const scope={sessionId:body.request.sessionId,state:()=>'',device:()=>TILL_KEY};
   for(const code of this.codes)for(const set of code.recordSets)
    sets[set.key]={rows:this.table(set.object).filter(row=>rowMatches(row,set.criteria(scope))).map(row=>({...row})),complete:true};
   return {ok:true,sets} as T;
  }
  if(path.endsWith('/page-code/aggregates'))
   return {values:body.items.map((item:{kind:string;object:string;field:string;criteria:Criteria})=>
    aggregateRows(item.kind,this.table(item.object).filter(row=>rowMatches(row,item.criteria)),item.field))} as T;
  return {} as T;
 };
 holdCode(code:FakeServer['codes'][number]){this.codes.push(code);}
 /** GET /api/live-changes. */
 open=async(signal:AbortSignal):Promise<Response>=>{
  this.opens++;
  if(this.refuse>0){this.refuse--;return new Response('Too many live connections',{status:429});}
  let mine:ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({start:controller=>{mine=controller;this.streams.add(controller);
   controller.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));},
   cancel:()=>{this.streams.delete(mine);}});
  signal.addEventListener('abort',()=>{this.streams.delete(mine);try{mine.close();}catch{/* closed */}});
  return new Response(body,{status:200,headers:{'Content-Type':'text/event-stream'}});
 };
 push(event:string,data:unknown){
  const frame=new TextEncoder().encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
  for(const stream of this.streams)stream.enqueue(frame);
 }
 /** Drop every open stream (server restart, proxy timeout). */
 dropStreams(){for(const stream of [...this.streams]){this.streams.delete(stream);try{stream.close();}catch{/* closed */}}}
 /** A save by another screen: committed, then announced with the saved rows (as the hub does). */
 save(object:string,operation:'insert'|'update'|'delete',rows:Row[],announce:'rows'|'ids'|'bulk'='rows'){
  const table=[...this.table(object)];
  for(const row of rows){
   const at=table.findIndex(item=>item.Id===row.Id);
   if(operation==='delete'){if(at>=0)table.splice(at,1);}
   else if(at>=0)table[at]={...table[at],...row};else table.push({...row});
  }
  this.rows.set(object,table);
  const ids=rows.map(row=>String(row.Id));
  const saved=ids.map(id=>table.find(row=>row.Id===id)).filter(Boolean);
  this.push('change',{object,ids,count:announce==='bulk'?ids.length+50:ids.length,operation,
   ...(announce==='rows'&&operation!=='delete'?{rows:saved}:{})});
 }
}

function openPage(server:FakeServer,page:unknown,sessionId='s-1'){
 const compiled=compilePage(page as never,objects);
 const load=compiledSourceLoader(objects,()=>({sessionId}),server.loadPage as never);
 const data=createCompiledDataLayer(compiled,load,()=>({}));
 const module=pageCodeModule(buildPageCode(compiled as never));
 const code=(new Function('F','O',module.replace(/export /g,'')+'\nreturn createCode(F, O);'))(F,O);
 server.holdCode(code);
 const runtime=createPageCodeRuntime(code,{endpoint:'/apps/X',build:{buildId:'b'},sessionId:()=>sessionId,state:()=>({}),
  request:server.request as never,page:compiled.apiName,shownRows:object=>data.get(compiled.dataSources.find(s=>s.objectApiName===object)?.id??'').records.map(row=>String(row.Id))});
 const source=(component:string)=>compiled.dataSources.find(item=>item.components.includes(component))!.id;
 const rows=(component:string)=>data.get(source(component)).records;
 const formula=(component:string)=>runtime.formulasByProperty(component).get('textSource')!;
 const shown=(component:string)=>{try{return formula(component)({});}catch{return undefined;}};
 const stop=connectPageLive({apiName:compiled.apiName,pageSessionKey:'k-'+compiled.apiName,dataSources:compiled.dataSources,data,code:runtime});
 cleanups.push(stop);
 return {compiled,data,runtime,source,rows,shown,stop,
  async start(){await data.start();await runtime.loadSets();for(const name of ['held','total','count','due'])shown(name);await tick(20);}};
}

const line=(server:FakeServer,values:Row)=>({Id:server.id(),Name:'Cola',Product:'p-cola',Quantity:1,LineTotal:2,Status:'Open',
 session_key__c:'s-1',DeviceKey:TILL_KEY,...values});

test('a save on another screen updates this screen\'s lists, totals and display formulas within the budget',async()=>{
 const server=new FakeServer();
 live.setLiveStreamOpener(server.open);
 server.rows.set('CartLine',[line(server,{Name:'Tea',Product:'p-tea',LineTotal:3})]);
 const page=openPage(server,tillPage);
 await page.start();
 await within('the live stream opens',()=>live.isLiveConnected()&&server.streams.size===1);
 assert.equal(page.rows('table').length,1);
 assert.equal(page.shown('held'),3);assert.equal(page.shown('total'),3);assert.equal(page.shown('count'),0);

 // Insert on another till: rows travel with the change.
 server.reads.length=0;
 const cola=line(server,{});
 server.save('CartLine','insert',[cola]);
 const took=await within('insert: table, grid, chart, held and server totals',()=>page.rows('table').length===2
  &&page.rows('grid').map(row=>row.Name).join()==='Cola,Tea'&&page.rows('chart').length===2
  &&page.shown('held')===5&&page.shown('total')===5&&page.shown('count')===1);
 console.info('live insert drawn in '+took.toFixed(0)+' ms');
 // The unsorted table took the row in place; the sorted grid was read again to keep the server's order.
 assert.ok(server.reads.every(read=>read.fresh),'every list read after a live change is fresh');

 // The same row changes again a moment later (quantity +1): it is still drawn (not taken for this window's own echo).
 server.save('CartLine','update',[{Id:cola.Id,Quantity:2,LineTotal:4}]);
 await within('quick second change of the same row',()=>page.rows('table').find(row=>row.Id===cola.Id)?.LineTotal===4
  &&page.shown('held')===7&&page.shown('total')===7);

 // A row moved out of the list by a change elsewhere, then deleted.
 server.save('CartLine','update',[{Id:cola.Id,Status:'Paid'}]);
 await within('update moves a row out',()=>page.rows('table').length===1&&page.rows('grid').length===1&&page.shown('held')===3&&page.shown('count')===0);
 server.save('CartLine','delete',[{Id:cola.Id}]);
 await within('delete',()=>page.rows('chart').length===1);
 page.stop();live.setLiveStreamOpener(null);
});

test('a list that cannot be patched in place (OR filter, bulk save, Ids only) is read again fresh',async()=>{
 const server=new FakeServer();
 live.setLiveStreamOpener(server.open);
 const page=openPage(server,tillPage);
 await page.start();
 await within('the live stream opens',()=>server.streams.size===1);
 server.reads.length=0;
 const held=line(server,{Status:'Held',Name:'Held sale'});
 server.save('CartLine','insert',[held]);
 await within('OR-filtered list re-read fresh',()=>page.rows('either').some(row=>row.Id===held.Id));
 assert.ok(server.reads.length>0&&server.reads.every(read=>read.fresh),'re-read fresh');
 // A bulk save (more rows than Ids) and a save announced by Ids only: no rows to patch with.
 const many=[line(server,{Name:'Bulk 1'}),line(server,{Name:'Bulk 2'})];
 server.save('CartLine','insert',many,'bulk');
 await within('bulk save re-read',()=>page.rows('table').length===2&&page.shown('total')===4&&page.shown('held')===4);
 const quiet=line(server,{Name:'Ids only'});
 server.save('CartLine','insert',[quiet],'ids');
 await within('Ids-only save re-read',()=>page.rows('table').length===3&&page.rows('chart').length===4&&page.shown('held')===6);
 page.stop();live.setLiveStreamOpener(null);
});

test('a display following a till shows the till\'s lines and totals live, and follows its sale changes',async()=>{
 const server=new FakeServer();
 live.setLiveStreamOpener(server.open);
 const display=openPage(server,displayPage,'display-session');
 await display.start();
 let reads=0;
 const stopMirror=startMirrorLiveRefresh(display.compiled.dataSources,Boolean(display.runtime.readsMirror),{
  reload:(id,fresh)=>{reads++;return display.data.reload(id,fresh);},
  loadSets:()=>display.runtime.loadSets(),refreshTotals:()=>display.runtime.refreshTotals(),
  isLive:live.isLiveConnected,
  subscribeLive:listener=>live.subscribeLiveChanges(event=>{if(event.kind==='resync'||event.kind==='screen'&&event.device===TILL_KEY)listener();})},
  {setInterval:()=>0,clearInterval:()=>undefined,visible:()=>true,listen:()=>()=>undefined});
 cleanups.push(stopMirror);
 await within('the live stream opens',()=>server.streams.size===1);
 assert.equal(display.rows('cart').length,0);assert.equal(display.shown('due'),0);
 // The till rings up a line (saved by the till, announced with rows).
 const cola=line(server,{});
 server.save('CartLine','insert',[cola]);
 const took=await within('display cart and total',()=>display.rows('cart').length===1&&display.shown('due')===2);
 console.info('display drawn in '+took.toFixed(0)+' ms');
 // Another till's line is not this display's.
 server.save('CartLine','insert',[line(server,{DeviceKey:'other-till-key-00000000001',LineTotal:9})]);
 await tick(80);
 assert.equal(display.rows('cart').length,1);assert.equal(display.shown('due'),2);
 // The till starts a new sale (its lines left without a record notice reaching here): the screen event re-reads.
 server.rows.set('CartLine',server.table('CartLine').filter(row=>row.DeviceKey!==TILL_KEY));
 const before=reads;
 server.push('screen',{device:TILL_KEY});
 await within('sale change re-read',()=>reads>before&&display.rows('cart').length===0&&display.shown('due')===0);
 stopMirror();display.stop();live.setLiveStreamOpener(null);
});

test('a dropped stream comes back quickly and redraws what changed meanwhile; a refused stream retries quickly',async()=>{
 const server=new FakeServer();
 live.setLiveStreamOpener(server.open);
 const page=openPage(server,tillPage);
 await page.start();
 await within('the live stream opens',()=>server.streams.size===1);
 const opens=server.opens;
 server.dropStreams();
 // Saved while the stream was down: nobody told this screen.
 server.rows.set('CartLine',[line(server,{})]);
 const back=await within('reconnect and resync',()=>server.opens>opens&&page.rows('table').length===1&&page.shown('total')===2,1500);
 console.info('stream back and resynced in '+back.toFixed(0)+' ms');
 page.stop();
 // Too many streams for a moment (HTTP 429): the next try follows quickly, not after seconds.
 await tick(10);
 server.refuse=1;
 const stop=live.subscribeLiveChanges(()=>undefined);
 cleanups.push(stop);
 await within('retried after a refusal',()=>server.opens>=opens+3&&server.streams.size===1,1000);
 stop();live.setLiveStreamOpener(null);
 assert.ok(live.liveRetryDelay(1,()=>0.5)<=300&&live.liveRetryDelay(20,()=>0.5)===15000);
});

test('merged changes keep each row\'s own operation and fold deletes in exactly',()=>{
 let merged=mergeLiveChange(undefined,{object:'CartLine',ids:['a'],count:1,operation:'insert',rows:[{Id:'a',Quantity:1}]});
 merged=mergeLiveChange(merged,{object:'CartLine',ids:['b'],count:1,operation:'update',rows:[{Id:'b',Quantity:5}]});
 merged=mergeLiveChange(merged,{object:'CartLine',ids:['c'],count:1,operation:'delete'});
 assert.deepEqual([...merged.created],['a']);
 assert.deepEqual([...merged.rows!.keys()],['a','b']);
 assert.deepEqual([...merged.ids],['a','b','c'],'c: named without a row = gone');
 merged=mergeLiveChange(merged,{object:'CartLine',ids:['d'],count:40,operation:'update'});
 assert.equal(merged.rows,null,'a bulk save: re-read instead');
});
