import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPageCode,serverPageCode} from '../../server/src/page-compiler/code/pageCode';
import {executePageCodeAction} from '../../server/src/system-support/page-code-runtime';

type Row=Record<string,unknown>;
const page=(formula:string)=>buildPageCode({apiName:'pay',components:[{id:'btn',objectApiName:'Cart',formulas:[],
 actions:[{event:'click',kind:'Formula',formula}]}]} as never);
const cartId='22222222-2222-4222-8222-222222222222';

test('INFOSCREEN inside IF: shown after the save, no STATE needed for an error message',async()=>{
 const code=page('=ACTIONS(GETRECORD(Cart, Id, "'+cartId+'", AS(sc)), IF(sc.Total > 5, INFOSCREEN("Cash received is less than the amount due"), UPDATERECORD(Cart, sc.Id, Status, "Paid")))');
 assert.deepEqual(code.issues,[]);
 const cart:Row={Id:cartId,Total:9,Status:'Open'};
 const records={async get(){return {...cart};},async list(){return {records:[],total:0};},
  async update(_t:string,_u:string,_o:string,_id:string,values:Row){Object.assign(cart,values);},
  async create(){return 'x';},async remove(){}};
 const db={transaction:async<T>(run:()=>Promise<T>)=>run(),query:async()=>({rows:[]})};
 const run=()=>executePageCodeAction({db,records} as never,{tenant_id:'t',user_id:'u'},serverPageCode(code),'btn:click',
  {sessionId:'s',state:{},rowObject:'Cart',event:{}},'');
 const shown=await run();
 assert.equal(shown.ok,true,shown.error);
 assert.deepEqual(shown.effects,[{name:'INFO',args:['Cash received is less than the amount due','','','','']}]);
 assert.equal(cart.Status,'Open');
 cart.Total=3;
 const paid=await run();
 assert.deepEqual(paid.effects,[]);
 assert.equal(cart.Status,'Paid');
});

test('INFOSCREEN with steps after OK inside IF: the OK steps become their own action',()=>{
 const code=page('=IF(@ThisPage.Session.Id = "", "", INFOSCREEN("Sale cleared", UPDATERECORD(Cart, "'+cartId+'", Status, "Cleared")))');
 assert.deepEqual(code.issues,[]);
 assert.deepEqual(code.actions.map(action=>action.key).sort(),['btn:click','btn:click__box1__yes']);
 assert.match(code.actions.find(action=>action.key==='btn:click')!.js,/\$\.ui\("INFO", "Sale cleared", "btn:click__box1__yes"/);
});

test('CONFIRMSCREEN was removed: a popup page asks instead',()=>{
 assert.match(page('=CONFIRMSCREEN("Clear?", CLOSESCREEN())').issues[0]?.error??'',/removed|Unknown|not/i);
 assert.match(page('=IF(TRUE, CONFIRMSCREEN("Clear?", CLOSESCREEN()), "")').issues[0]?.error??'',/removed|Unknown|not/i);
});

test('clear errors instead of surprises',()=>{
 // Steps after a box with answers would run before the answer.
 assert.match(page('=ACTIONS(INFOSCREEN("Sure?", CLOSESCREEN()), CLOSESCREEN())').issues[0]?.error??'',/inside the box/);
 // The answer runs later as a new action: values read before the box are gone by then.
 assert.match(page('=ACTIONS(GETRECORD(Cart, Id, "'+cartId+'", AS(sc)), INFOSCREEN("Pay?", UPDATERECORD(Cart, sc.Id, Status, "Paid")))').issues[0]?.error??'',/cannot use sc/);
 // ...unless the answer reads it itself.
 assert.deepEqual(page('=ACTIONS(INFOSCREEN("Pay?", ACTIONS(GETRECORD(Cart, Id, "'+cartId+'", AS(sc)), UPDATERECORD(Cart, sc.Id, Status, "Paid"))))').issues,[]);
 assert.match(page('=FOREACH(Cart, Status, "Open", AS(c), INFOSCREEN("x"))').issues[0]?.error??'',/inside FOREACH/);
});
