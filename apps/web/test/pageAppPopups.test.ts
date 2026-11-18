import test from 'node:test';
import assert from 'node:assert/strict';
import {pageAppsWithPopups} from '../src/core/builders/PageBuilder/pageAppMembership';

test('a popup belongs to the apps whose pages open it (also popup from popup)',()=>{
 const apps=[{apiName:'SMARTTILL',navigationPageApiNames:['till'],navigationOrder:[]},{apiName:'KIOSK',navigationPageApiNames:['menu'],navigationOrder:[]}];
 const pages=[
  {apiName:'till',components:[{properties:{actionFlows:{click:{formula:'=SCREEN(pay_popup, popup)'}}}}]},
  {apiName:'pay_popup',components:[{properties:{actionFlows:{click:{formula:'=SCREEN(Age_Check, popup)'}}}}]},
  {apiName:'age_check',components:[]},
  {apiName:'menu',components:[]},
  {apiName:'lonely',components:[]}];
 const map=pageAppsWithPopups(apps as never,pages as never);
 assert.deepEqual(map.get('pay_popup'),['SMARTTILL']);
 assert.deepEqual(map.get('age_check'),['SMARTTILL']);
 assert.deepEqual(map.get('menu'),['KIOSK']);
 assert.deepEqual(map.get('lonely'),[]);
});
