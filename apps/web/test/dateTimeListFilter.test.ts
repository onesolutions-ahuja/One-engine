import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRecordFilters} from '../../server/src/object-engine/QueryBuilder.ts';

test('a Date/Time list filter (e.g. DeviceOnlineAt < now) compiles to valid SQL',()=>{
 const fields=new Map([['OnlineAt',{api_name:'OnlineAt',data_type:'datetime',nativeValue:'nr."f_a"',nativeText:'nr."f_a"::text'}]]) as never;
 const {predicate}=compileRecordFilters([{field:'OnlineAt',operator:'lt',value:'2026-11-18T14:35:00.000Z'}] as never,'1',fields,4,new Set());
 // value_datetime used to be cut at value_date, leaving "time" behind: SQL syntax error (503).
 assert.match(predicate,/nr\."f_a"<\$5::timestamptz/);
 assert.doesNotMatch(predicate,/time</);
});
