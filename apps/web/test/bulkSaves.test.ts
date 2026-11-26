import test from 'node:test';
import assert from 'node:assert/strict';
import {compileActionFormula} from '../../server/src/page-compiler/code/generateCode';

const code=(formula:string)=>JSON.stringify(compileActionFormula(formula,'Cart'));

test('FOREACH saves whose result is not used are queued for one bulk save',()=>{
 // A body of saves only is now set-based: one statement per step, never one save per row.
 const loop=code('=ACTIONS(FOREACH(CartLine, "CartId", @ThisRecord.Id, AS(line), UPDATERECORD(CartLine, line.Id, "Qty", 0)))');
 assert.match(loop,/\$\.updateWhere\(/);
 assert.doesNotMatch(loop,/\$\.update\(/);
 const created=code('=ACTIONS(FOREACH(CartLine, "CartId", @ThisRecord.Id, AS(line), CREATERECORD(SaleLine, "Name", line.Name)))');
 assert.match(created,/\$\.createFrom\(/);
 assert.doesNotMatch(created,/createLater/);
 // A body that also reads keeps the loop, and its saves are still queued for one bulk save.
 const queued=code('=ACTIONS(FOREACH(CartLine, "CartId", @ThisRecord.Id, AS(line), ACTIONS(GETRECORD(Product, Id, line.Product, AS(p)), UPDATERECORD(CartLine, line.Id, "Qty", p.Stock))))');
 assert.match(queued,/\$\.updateLater\(/);
 assert.doesNotMatch(queued,/\$\.updateWhere\(/);
});

test('saves outside a loop, or whose result is used, stay single saves',()=>{
 const single=code('=ACTIONS(CREATERECORD(SaleLine, "Name", "Tea"))');
 assert.match(single,/\$\.create\(/);
 assert.doesNotMatch(single,/createLater/);
 const used=code('=ACTIONS(FOREACH(CartLine, "CartId", @ThisRecord.Id, AS(line), CREATERECORD(SaleLine, "Name", line.Name, AS(made))))');
 assert.match(used,/\$\.create\(/);
 assert.doesNotMatch(used,/createLater/);
});

test('queued loop saves are saved before anything reads records, in order, then the action ends saved',async()=>{
 const {executePageCodeAction}=await import('../../server/src/system-support/page-code-runtime.ts');
 const calls:string[]=[];
 const ids=['3c18f66b-4386-4446-9cdc-1d9619e903d2','4c18f66b-4386-4446-9cdc-1d9619e903d2'];
 const records={
  async list(_t:string,_u:string,object:string,_limit:number,_offset:number,options:{filters?:Array<{field:string;value:unknown}>}){
   calls.push('list '+object+' '+JSON.stringify(options.filters??[]));
   const idFilter=options.filters?.find(filter=>filter.field==='Id');
   if(idFilter)return {records:(idFilter.value as string[]).map(Id=>({Id,Name:'saved'})),total:2};
   return {records:ids.map(Id=>({Id,Name:'line'})),total:2};
  },
  async get(){calls.push('get');return {};},
  async create(){calls.push('create');return ids[0];},
  async update(_t:string,_u:string,object:string,id:string){calls.push('update '+object+' '+id);},
  async remove(){calls.push('remove');},
  async updateMany(_t:string,_u:string,object:string,items:Array<{id:string}>){
   calls.push('updateMany '+object+' '+items.map(item=>item.id).join(','));
  },
 };
 const db={transaction:async(run:()=>Promise<unknown>)=>run()};
 const compiled=compileActionFormula('=ACTIONS(FOREACH(CartLine, "Status", "Open", AS(line), UPDATERECORD(CartLine, line.Id, "Qty", 0)), GETRECORD(Cart, "Status", "Open", AS(cart)))','');
 const run=new Function('return '+compiled.js)() as (scope:unknown)=>Promise<void>;
 const result=await executePageCodeAction({db,records} as never,{tenant_id:'t',user_id:'u'} as never,
  {actions:{go:{run}},recordSets:[]} as never,'go',
  {event:{},rowObject:'',state:{},timeZone:'UTC'} as never,compiled.js);
 assert.equal(result.ok,true,result.error);
 const many=calls.findIndex(call=>call.startsWith('updateMany'));
 const read=calls.findIndex(call=>call.startsWith('list Cart '));
 assert.ok(many>=0,'one bulk save: '+calls.join(' | '));
 assert.equal(calls.filter(call=>call.startsWith('update ')).length,0,'no single saves');
 assert.ok(many<read,'saved before the next read: '+calls.join(' | '));
 assert.deepEqual(result.changes.map(change=>change.record.Id),ids,'every saved row is reported, in order');
});
