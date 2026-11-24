import test from 'node:test';
import assert from 'node:assert/strict';

const store=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},removeItem:(k:string)=>{m.delete(k);},key:(i:number)=>[...m.keys()][i]??null,get length(){return m.size;}};};
(globalThis as any).window={localStorage:store(),sessionStorage:store(),location:{pathname:'/'}};
const till=await import('../src/core/authentication/TillDevice/tillDevice.ts');

test('lock applies only on pages of apps with the lock screen on',()=>{
 till.rememberAppLocks([{apiName:'SMARTTILL',lockScreen:{enabled:true,idleMinutes:5}},{apiName:'CRM',lockScreen:{enabled:false,idleMinutes:5}},{apiName:'Old'}]);
 assert.deepEqual(till.appLockHere('/une/apps/SMARTTILL/pages/smart_till_billing'),{app:'SMARTTILL',idleMinutes:5});
 assert.equal(till.appLockHere('/une/apps/CRM/pages/home'),undefined);
 assert.equal(till.appLockHere('/une/apps/Old/home'),undefined);
 assert.equal(till.appLockHere('/setup/page-builder/smart_till_billing'),undefined);
});
test('a locked tab keeps the lock until sign-in clears it',()=>{
 (globalThis as any).window.location.pathname='/setup/page-builder';
 assert.equal(till.tillLockApplies(),false);
 till.setTillLocked(true);assert.equal(till.tillLockApplies(),true);
 till.setTillLocked(false);assert.equal(till.tillLockApplies(),false);
});
