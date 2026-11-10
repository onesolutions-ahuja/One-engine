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
