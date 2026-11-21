import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveFrameParser,isOwnEcho,noteOwnWrites} from '../src/core/pages/PageCompiler/liveChanges.ts';
import {LiveChangeHub,MAX_STREAMS_PER_TENANT,MAX_STREAMS_PER_USER,registerLiveChangeRoutes} from '../../server/src/system-support/live-changes.ts';
import {startMirrorLiveRefresh} from '../src/core/pages/PageCompiler/mirrorLiveRefresh.ts';

test('the live stream is read event by event, even when split across chunks',()=>{
 const events:unknown[]=[];
 const parser=new LiveFrameParser(event=>events.push(event));
 parser.append('event: ready\ndata: {}\n\n: keepalive\n\nevent: change\ndata: {"object":"CartLine","ids":["a","b"],"cou');
 assert.equal(events.length,1,'an incomplete event waits for the rest');
 parser.append('nt":2,"operation":"insert"}\n\nevent: screen\ndata: {"device":"dev-1"}\n\nevent: resync\ndata: {}\n\n');
 assert.deepEqual(events,[{kind:'ready'},{kind:'change',change:{object:'CartLine',ids:['a','b'],count:2,operation:'insert'}},
  {kind:'screen',device:'dev-1'},{kind:'resync'}]);
});

test('a window skips the echo of records it saved itself, not other changes',()=>{
 noteOwnWrites(['own-1','own-2']);
 assert.equal(isOwnEcho({object:'CartLine',ids:['own-1','own-2'],count:2,operation:'update'}),true);
 assert.equal(isOwnEcho({object:'CartLine',ids:['own-1','other'],count:2,operation:'update'}),false);
 assert.equal(isOwnEcho({object:'CartLine',ids:['own-1'],count:5,operation:'update'}),false,'more rows than Ids sent');
 assert.equal(isOwnEcho({object:'CartLine',ids:['own-1'],count:1,operation:'update'},Date.now()+10_000),false,'only just after the save');
});

test('the server passes a saved record on to the tenant\'s screens that may read the Object',async()=>{
 const allowed=new Set(['u1:CartLine','u2:CartLine']);
 let checks=0;
 const hub=new LiveChangeHub({pool:{connect:()=>new Promise(()=>undefined)}} as never,
  {allowed:async(_tenant:string,user:string,object:string)=>{checks++;return allowed.has(user+':'+object);}} as never);
 const got:Record<string,unknown[]>={u1:[],u2:[],u3:[],other:[]};
 hub.subscribe({tenant_id:'T',user_id:'u1'},(event,data)=>got.u1.push([event,data]));
 hub.subscribe({tenant_id:'T',user_id:'u2'},(event,data)=>got.u2.push([event,data]));
 hub.subscribe({tenant_id:'T',user_id:'u3'},(event,data)=>got.u3.push([event,data]));
 const stop=hub.subscribe({tenant_id:'T2',user_id:'other'},(event,data)=>got.other.push([event,data]));
 hub.dispatch({k:'record',t:'T',o:'CartLine',n:1,ids:['r1'],op:'insert'});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(got.u1,[['change',{object:'CartLine',ids:['r1'],count:1,operation:'insert'}]]);
 assert.equal(got.u2.length,1);
 assert.equal(got.u3.length,0,'no read access to the Object: nothing is sent');
 assert.equal(got.other.length,0,'another tenant hears nothing');
 hub.dispatch({k:'record',t:'T',o:'CartLine',n:1,ids:['r2'],op:'update'});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(checks,3,'read access is remembered for a while');
 hub.dispatch({k:'screen',t:'T',d:'till-device'});
 assert.deepEqual(got.u3.at(-1),['screen',{device:'till-device'}]);
 stop();assert.equal(hub.count('T2'),0);assert.equal(hub.count('T'),3);
 // Shops share one login across tills and screens: hundreds of streams per user.
 for(let index=0;index<MAX_STREAMS_PER_USER-1;index++)hub.subscribe({tenant_id:'T',user_id:'u1'},()=>undefined);
 assert.throws(()=>hub.subscribe({tenant_id:'T',user_id:'u1'},()=>undefined),/Too many live connections for this user/);
 assert.equal(MAX_STREAMS_PER_USER,300);assert.equal(MAX_STREAMS_PER_TENANT,3000);
});

test('a screen whose connection is gone is dropped at the first failed send; the tenant has its own cap',async()=>{
 const hub=new LiveChangeHub({pool:{connect:()=>new Promise(()=>undefined)}} as never,{allowed:async()=>true} as never);
 let alive=0;
 hub.subscribe({tenant_id:'T',user_id:'u'},()=>{alive++;});
 hub.subscribe({tenant_id:'T',user_id:'u'},()=>false);
 hub.subscribe({tenant_id:'T',user_id:'u'},()=>{throw Error('socket closed');});
 assert.equal(hub.count('T'),3);
 hub.dispatch({k:'screen',t:'T',d:'till'});
 assert.equal(hub.count('T'),1,'dead screens are dropped at once');
 hub.dispatch({k:'record',t:'T',o:'CartLine',n:1,ids:['r1'],op:'insert'});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(alive,2);
 const stops=Array.from({length:MAX_STREAMS_PER_TENANT-1},(_,index)=>hub.subscribe({tenant_id:'T',user_id:'user-'+(index%20)},()=>undefined));
 assert.throws(()=>hub.subscribe({tenant_id:'T',user_id:'new'},()=>undefined),/for this tenant/);
 stops.forEach(stop=>stop());stops.forEach(stop=>stop());
 assert.equal(hub.count('T'),1,'unsubscribing twice is harmless');
});

test('GET /api/live-changes drops the screen as soon as its connection closes',async()=>{
 const {EventEmitter}=await import('node:events');
 const hub=new LiveChangeHub({pool:{connect:()=>new Promise(()=>undefined)}} as never,{allowed:async()=>true} as never);
 let handler:((req:unknown,res:unknown,next:(error?:unknown)=>void)=>void)|undefined;
 const app={post:()=>undefined,get:(_path:string,run:typeof handler)=>{handler=run;}};
 registerLiveChangeRoutes(app as never,hub);
 const open=()=>{
  const socket=new EventEmitter() as EventEmitter&{destroyed:boolean};socket.destroyed=false;
  const res=Object.assign(new EventEmitter(),{written:[] as string[],destroyed:false,writableEnded:false,writableLength:0,
   status(){return res;},setHeader(){},flushHeaders(){},write(text:string){res.written.push(text);return true;},
   end(){res.writableEnded=true;},destroy(){res.destroyed=true;}});
  const req={actor:{tenant_id:'T',user_id:'u'},socket};
  let failed:unknown;
  handler!(req,res,error=>{failed=error;});
  return {res,socket,failed:()=>failed};
 };
 const a=open(),b=open();
 assert.equal(hub.count('T'),2);
 assert.match(a.res.written[0],/event: ready/);
 a.res.emit('close');
 assert.equal(hub.count('T'),1,'closed: dropped at once, not at the next heartbeat');
 b.socket.destroyed=true;
 hub.dispatch({k:'screen',t:'T',d:'till'});
 assert.equal(hub.count('T'),0,'a write to a dead socket drops the screen');
 assert.equal(b.res.writableEnded,true);
});

test('with the live stream up a display re-reads on live events, and its timer only every 30 s',async()=>{
 let tick:()=>void=()=>{};
 let live:()=>void=()=>{};
 const clock={setInterval:(run:()=>void)=>{tick=run;return 1;},clearInterval:()=>{},visible:()=>true,listen:()=>()=>undefined};
 const source={id:'CartLine#d',objectApiName:'CartLine',components:[],scope:{kind:'none'},complete:false,filters:null,
  filterLogic:'AND',filterFormula:'@CartLine.DeviceKey = @ThisPage.Device.MirrorKey',stateInputs:[]} as never;
 let reads=0;
 startMirrorLiveRefresh([source],true,{reload:async()=>{reads++;},isLive:()=>true,
  subscribeLive:listener=>{live=listener;return ()=>undefined;}},clock);
 live();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(reads,1,'the followed till moved: read at once');
 tick();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(reads,1,'the 2 s timer is quiet while live');
});

test('saved rows travel with the change, read once per user as that user; deletes and bulk saves send Ids',async()=>{
 const reads:string[]=[];
 const hub=new LiveChangeHub({pool:{connect:()=>new Promise(()=>undefined)}} as never,{allowed:async()=>true} as never,
  async(_tenant,user,object,ids)=>{reads.push(user+':'+object+':'+ids.join(','));
   return user==='u2'?[]:ids.map(id=>({Id:id,Name:'Pepsi',Secret:user==='u1'?'seen':undefined}));});
 const got:Record<string,unknown[]>={a:[],b:[],c:[]};
 hub.subscribe({tenant_id:'T',user_id:'u1'},(_e,data)=>got.a.push(data));
 hub.subscribe({tenant_id:'T',user_id:'u1'},(_e,data)=>got.b.push(data));
 hub.subscribe({tenant_id:'T',user_id:'u2'},(_e,data)=>got.c.push(data));
 hub.dispatch({k:'record',t:'T',o:'CartLine',n:1,ids:['r1'],op:'insert'});
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.deepEqual(reads.sort(),['u1:CartLine:r1','u2:CartLine:r1'],'one read per user, not per screen');
 assert.deepEqual((got.a[0] as {rows:unknown[]}).rows,[{Id:'r1',Name:'Pepsi',Secret:'seen'}]);
 assert.deepEqual(got.a[0],got.b[0]);
 assert.deepEqual((got.c[0] as {rows:unknown[]}).rows,[],'u2 may not see r1: it is reported as gone for u2');
 reads.length=0;
 hub.dispatch({k:'record',t:'T',o:'CartLine',n:1,ids:['r1'],op:'delete'});
 hub.dispatch({k:'record',t:'T',o:'CartLine',n:90,ids:['r1','r2'],op:'update'});
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(reads.length,0,'no row reads for deletes or bulk saves');
 assert.equal((got.a.at(-1) as {rows?:unknown}).rows,undefined);
});

test('a page code record set can follow the rows the page shows (the tapped row\'s related rows)',async()=>{
 const {compileActionFormula}=await import('../../server/src/page-compiler/code/generateCode.ts');
 const code=compileActionFormula('=IF(COUNTIFS(ProductOptionGroup, Product, @recordId, Active, TRUE) > 0, SCREEN(opts, popup, @recordId), "")','Product');
 assert.deepEqual(code.sets.map(set=>[set.object,set.parent]),[['ProductOptionGroup',{key:'@shown:Product',field:'Product'}]]);
 // Without a tapped-row criterion nothing changes: literal-only lookups are still never held.
 assert.deepEqual(compileActionFormula('=IF(COUNTIFS(ProductOptionGroup, Active, TRUE) > 0, SCREEN(opts, popup), "")','Product').sets,[]);
});

test('a saved or published page layout reaches the Page Builders that may read pages',async()=>{
 const hub=new LiveChangeHub({pool:{connect:()=>new Promise(()=>undefined)}} as never,
  {allowed:async(_t:string,user:string,resource:string)=>resource==='PageDefinition'&&user==='designer'} as never);
 const got:Record<string,unknown[]>={designer:[],cashier:[]};
 hub.subscribe({tenant_id:'T',user_id:'designer'},(event,data)=>got.designer.push([event,data]));
 hub.subscribe({tenant_id:'T',user_id:'cashier'},(event,data)=>got.cashier.push([event,data]));
 hub.dispatch({k:'page',t:'T',a:'smart_till_billing',v:'Custom',d:42,p:41});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(got.designer,[['page',{page:'smart_till_billing',variant:'Custom',draft:42,published:41}]]);
 assert.equal(got.cashier.length,0,'no page access: nothing sent');
 const events:unknown[]=[];
 new LiveFrameParser(event=>events.push(event)).append('event: page\ndata: {"page":"p","variant":"Custom","draft":3,"published":null}\n\n');
 assert.deepEqual(events,[{kind:'page',page:{page:'p',variant:'Custom',draft:3,published:null}}]);
});

test('a display that was hidden reads at once when shown, even with the live stream up',async()=>{
 let tick:()=>void=()=>{};
 let visible=false;
 const clock={setInterval:(run:()=>void)=>{tick=run;return 1;},clearInterval:()=>{},visible:()=>visible,listen:()=>()=>undefined};
 const source={id:'CartLine#d',objectApiName:'CartLine',components:[],scope:{kind:'none'},complete:false,filters:null,
  filterLogic:'AND',filterFormula:'@CartLine.DeviceKey = @ThisPage.Device.MirrorKey',stateInputs:[]} as never;
 let reads=0;
 startMirrorLiveRefresh([source],true,{reload:async()=>{reads++;},isLive:()=>true,subscribeLive:()=>()=>undefined},clock);
 tick();tick();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(reads,0,'hidden: nothing read');
 visible=true;tick();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(reads,1,'shown: read at once (skipped hidden ticks do not count)');
});

test('a screen notice (SCREEN on the till, often on every tap) only asks which sale and layer; rows are not re-read',async()=>{
 let live:(kind:'screen'|'resync')=>void=()=>{};
 const clock={setInterval:()=>1,clearInterval:()=>{},visible:()=>true,listen:()=>()=>undefined};
 const source={id:'CartLine#d',objectApiName:'CartLine',components:[],scope:{kind:'none'},complete:false,filters:null,
  filterLogic:'AND',filterFormula:'@CartLine.DeviceKey = @ThisPage.Device.MirrorKey',stateInputs:[]} as never;
 let reads=0,follows=0,sets=0;
 const stop=startMirrorLiveRefresh([source],true,{reload:async()=>{reads++;},followSale:async()=>{follows++;},
  loadSets:async()=>{sets++;},isLive:()=>true,subscribeLive:listener=>{live=listener;return ()=>undefined;}},clock);
 live('screen');await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual({follows,reads,sets},{follows:1,reads:0,sets:0});
 live('resync');await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual({reads,sets},{reads:1,sets:1},'the stream came back: everything is read again');
 stop();
});

test('a display re-read waits while taps are on their way (it would draw an older saved value over them)',async()=>{
 let live:(kind:'screen'|'resync')=>void=()=>{};
 const clock={setInterval:()=>1,clearInterval:()=>{},visible:()=>true,listen:()=>()=>undefined};
 const source={id:'CartLine#d',objectApiName:'CartLine',components:[],scope:{kind:'none'},complete:false,filters:null,
  filterLogic:'AND',filterFormula:'@CartLine.DeviceKey = @ThisPage.Device.MirrorKey',stateInputs:[]} as never;
 let reads=0,waiting=true;
 const stop=startMirrorLiveRefresh([source],true,{reload:async()=>{reads++;},isLive:()=>true,tapsWaiting:()=>waiting,
  subscribeLive:listener=>{live=listener;return ()=>undefined;}},clock);
 live('resync');await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(reads,0,'held while taps wait');
 waiting=false;
 await new Promise(resolve=>setTimeout(resolve,200));
 assert.equal(reads,1,'read once they are answered');
 stop();
});
