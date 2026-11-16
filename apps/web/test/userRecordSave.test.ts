import test from 'node:test';
import assert from 'node:assert/strict';
import {filterLayoutWritableValues} from '../src/core/records/RecordWorkspace/layoutWritableValues';
import type {PageLayoutMetadata} from '../src/core/metadata/Definitions/metadata';

const layout={
  id:'user-edit',label:'User Edit',actions:['Edit'],
  sections:[{id:'record-info',label:'Record Information',columns:2,
    fieldApiNames:['Email','Enabled']}]
} as PageLayoutMetadata;
const userExtras=new Set(['LandingApp','ReportsToId']);

test('User Save keeps separate landing/reporting controls while filtering hidden fields',()=>{
  const values={Email:'cashier@example.invalid',Enabled:false,
    LandingApp:'SmartTill',ReportsToId:'manager-id',HiddenValue:'must-not-save'};
  const payload=filterLayoutWritableValues(values,layout,new Set(),true,userExtras);
  assert.deepEqual(payload,{
    Email:'cashier@example.invalid',Enabled:false,
    LandingApp:'SmartTill',ReportsToId:'manager-id'
  });
});

test('regular record saves never submit supplemental User fields implicitly',()=>{
  const values={Email:'cashier@example.invalid',LandingApp:'SmartTill',ReportsToId:'manager-id'};
  assert.deepEqual(filterLayoutWritableValues(values,layout,new Set(),true),{
    Email:'cashier@example.invalid'
  });
});

test('a layout read-only field stays excluded even when explicitly supplemental',()=>{
  const readOnlyLayout={
    ...layout,sections:[{...layout.sections[0],readOnlyFieldApiNames:['ReportsToId','Email']}]
  };
  const payload=filterLayoutWritableValues({Email:'cannot-edit',Enabled:true,
    ReportsToId:'manager-id',LandingApp:'Setup'},readOnlyLayout,new Set(),true,userExtras);
  assert.deepEqual(payload,{Enabled:true,LandingApp:'Setup'});
});

test('legacy IsActive layouts retain explicitly visible boolean false',()=>{
  const activeLayout={...layout,sections:[{...layout.sections[0],fieldApiNames:['Email','IsActive']}]};
  assert.deepEqual(filterLayoutWritableValues({Email:'test@example.invalid',IsActive:false},
    activeLayout,new Set(),true),{Email:'test@example.invalid',IsActive:false});
});
