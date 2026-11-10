import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRecordFilterFormula} from '../src/core/pages/PageRuntime/recordFilterFormula';
import type {FieldMetadata} from '../src/core/metadata/Definitions/metadata';

const fields=[{apiName:'StartDateTime',label:'Start',dataType:'DateTime'}] as unknown as FieldMetadata[];

test('NOW() in a record filter is stable within a minute (no request loop)',()=>{
 const realNow=Date.now;
 try{
  const minute=Date.UTC(2026,10,10,9,13,0);
  Date.now=()=>minute+1234;
  const first=compileRecordFilterFormula('@StartDateTime >= NOW()',fields);
  Date.now=()=>minute+58999;
  const second=compileRecordFilterFormula('@StartDateTime >= NOW()',fields);
  assert.equal(first.blocked,false,first.error);
  assert.deepEqual(second,first,'same minute: identical server filter, so no new query');
  assert.match(first.filters[0].value,/^2026-11-10T09:13:00/);
  Date.now=()=>minute+60000;
  const next=compileRecordFilterFormula('@StartDateTime >= NOW()',fields);
  assert.match(next.filters[0].value,/^2026-11-10T09:14:00/,'moves on each minute');
 }finally{Date.now=realNow;}
});

test('NOW() is to the minute everywhere; TIMENOW() keeps seconds',async()=>{
 const {evaluateFieldExpressionDetailed}=await import('../src/component-libraries/shared/FieldExpression.js');
 const {evaluateFlowFormula}=await import('../../server/src/system-files/flow-formula-runtime');
 const now=new Date('2026-11-10T09:37:42.519Z');
 assert.equal(evaluateFieldExpressionDetailed('=NOW()',{},{now}).value,'2026-11-10T09:37:00.000Z');
 assert.equal(evaluateFieldExpressionDetailed('=TIMENOW()',{},{now,timeZone:'UTC'}).value,'09:37:42.519');
 assert.equal(evaluateFlowFormula('NOW()',()=>undefined,{now}),'2026-11-10T09:37:00.000Z');
 assert.equal(evaluateFlowFormula('TIMENOW()',()=>undefined,{now,timeZone:'UTC'}),'09:37:42.519');
});
