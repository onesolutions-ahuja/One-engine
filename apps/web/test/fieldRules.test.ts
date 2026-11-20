import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRequiredBox,missingRequired,writesRecord,loadFieldAccess,clearFieldAccessCache} from '../src/core/pages/PageRuntime/fieldRules';

test('required boxes block a save until filled, and only visible boxes count',()=>{
 const flags:Record<string,boolean>={};
 let email='',phone='';
 const off1=registerRequiredBox('s1','email',{label:'Email',value:()=>email,visible:()=>true,flag:m=>{flags.email=m;}});
 const off2=registerRequiredBox('s1','phone',{label:'Phone',value:()=>phone,visible:()=>false,flag:m=>{flags.phone=m;}});
 assert.deepEqual(missingRequired('s1'),['Email']);
 assert.equal(flags.email,true);assert.equal(flags.phone,false);
 email='  ';assert.deepEqual(missingRequired('s1'),['Email']);
 email='a@b.co';assert.deepEqual(missingRequired('s1'),[]);
 assert.equal(flags.email,false);
 assert.deepEqual(missingRequired('other'),[]);
 off1();off2();phone='';
 assert.deepEqual(missingRequired('s1'),[]);
});

test('only formulas that write a record are checked',()=>{
 assert.equal(writesRecord('=ACTIONS(UPDATERECORD(@Customer.Id, "Name", @ThisPage.N.Value), CLOSESCREEN())'),true);
 assert.equal(writesRecord('=CREATERECORD("Customer", "Name", "x")'),true);
 assert.equal(writesRecord('=CLOSESCREEN()'),false);
 assert.equal(writesRecord(undefined),false);
});

test('field access is read once per object and a failure is not cached',async()=>{
 clearFieldAccessCache();
 let calls=0;
 const request=(async(path:string)=>{calls++;assert.equal(path,'/metadata/field-access/Customer');
  return {fields:{Email:{label:'Email',required:true,read:true,create:true,edit:false}}};}) as never;
 const a=await loadFieldAccess(request,'Customer');const b=await loadFieldAccess(request,'Customer');
 assert.equal(a.Email.required,true);assert.equal(a.Email.edit,false);assert.equal(b,a);assert.equal(calls,1);
 clearFieldAccessCache();
 const failing=(async()=>{throw Error('offline');}) as never;
 await assert.rejects(loadFieldAccess(failing,'Customer'));
 assert.equal((await loadFieldAccess(request,'Customer')).Email.label,'Email');
 assert.deepEqual(await loadFieldAccess(request,'bad name!'),{});
});
