import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pageLayoutFallbacks,requestPageWithLayoutFallback} from '../src/core/pages/PageRuntime/pageLayoutFallback.ts';
import {appPageLayoutFallbacks} from '../../server/src/system-support/page-layout-fallback.ts';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
class NotFound extends Error{status=404;}

test('a missing layout falls back to the nearest wider one, Desktop last (browser and server agree)',()=>{
 for(const fallbacks of [pageLayoutFallbacks,appPageLayoutFallbacks]){
  assert.deepEqual(fallbacks('Mobile'),['Tablet','Desktop']);
  assert.deepEqual(fallbacks('Phone'),['Tablet','Desktop']);
  assert.deepEqual(fallbacks('Tablet'),['Desktop']);
  assert.deepEqual(fallbacks('Custom'),['Desktop']);
  assert.deepEqual(fallbacks('Desktop'),[]);
 }
});

test('narrow window: a Desktop-only page opens at once on Desktop, no wait, no blank page',async()=>{
 const asked:string[]=[];
 const started=Date.now();
 const answer=await requestPageWithLayoutFallback(async layout=>{
  asked.push(layout);
  if(layout!=='Desktop')throw new NotFound('Page not found');
  return {page:{apiName:'till',layoutVariant:'Desktop'}};
 },'Mobile');
 assert.deepEqual(asked,['Mobile','Tablet','Desktop']);
 assert.equal(answer.page.layoutVariant,'Desktop');
 assert.ok(Date.now()-started<100,'fallback is immediate');
});

test('a page that has the asked layout makes one request; other failures are not retried',async()=>{
 const asked:string[]=[];
 await requestPageWithLayoutFallback(async layout=>{asked.push(layout);return {page:{}};},'Mobile');
 assert.deepEqual(asked,['Mobile']);
 const denied:string[]=[];
 await assert.rejects(requestPageWithLayoutFallback(async layout=>{denied.push(layout);throw new Error('Permission denied');},'Mobile'),/Permission denied/);
 assert.deepEqual(denied,['Mobile']);
 await assert.rejects(requestPageWithLayoutFallback(async()=>{throw new NotFound('Page not found');},'Mobile'),/Page not found/);
});

test('the server answers the best existing layout in the same request',()=>{
 const server=read('../../server/src/system-support/server.ts');
 assert.match(server,/for\(const fallback of appPageLayoutFallbacks\(factor\)\)\{\s*if\(page\)break;\s*page=await pages\.resolveAppPage\(actor\.tenant_id,appId,pageApiName,fallback\);/);
 assert.match(server,/if\(!page&&fallback\)return homePageAnswer\(actor,appId,\{\.\.\.query,formFactor:fallback\}\)/);
 const views=read('../src/core/pages/PageRuntime/pageRuntimeViews.tsx');
 assert.match(views,/requestPageWithLayoutFallback\(request,requestedLayout\)/);
});
