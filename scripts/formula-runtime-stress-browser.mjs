// Executes the real PageFormulaScope, record query coalescer and action plan
// against disposable, route-stubbed API records in a browser, never a tenant.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const base=process.env.SETUP_UX_BASE_URL??'http://127.0.0.1:5173';
const root=process.env.FORMULA_STRESS_ARTIFACT_DIR??'artifacts/formula-runtime-stress';
const counterId='11111111-1111-4111-8111-111111111111';
await mkdir(root,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{
 executablePath:process.env.CHROME_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']
}:{})});
const report={fixture:'56 metadata components: 50 chained Text, 3 Cart, 3 Card Grid',
 isolated:true,tenantRecordsTouched:false,results:{}};
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage();
let cartReads=0,cartWrites=0,counterReads=0,counterWrites=0,counter=0,sqlReads=0;
const exceptions=[];
page.on('pageerror',error=>exceptions.push(error.message));
page.on('console',message=>{
 if(message.type()==='error')exceptions.push(message.text());
});
const json=(value)=>({status:200,contentType:'application/json',body:JSON.stringify(value)});
try {
 await page.route('**/api/formulas/evaluate',async route=>{
  const body=route.request().postDataJSON();
  assert.match(body.formula,/UPPER\("hello"\)/);
  sqlReads++;
  await route.fulfill(json({value:'HELLO'}));
 });
 // This isolated client fixture has no authenticated SQL API; explicitly
 // decline the optional server data-prefix so guarded Record API actions
 // continue through the real legacy client path without false write replays.
 await page.route('**/api/action-formulas/execute-data',async route=>{
  await route.fulfill(json({supported:false}));
 });
 await page.route('**/api/records/**',async route=>{
  const request=route.request();
  const method=request.method();
  const url=new URL(request.url());
  if(url.pathname==='/api/records/CartLine'&&method==='GET'){
   cartReads++;
   await new Promise(resolve=>setTimeout(resolve,125));
   const records=cartWrites?[{Id:counterId,Quantity:2}]:[];
   await route.fulfill(json({records:records.slice(0,Number(url.searchParams.get('limit')??100)),total:records.length}));
   return;
  }
  if(url.pathname==='/api/records/CartLine'&&method==='POST'){
   cartWrites++;
   await route.fulfill(json({record:{Id:counterId,Quantity:2}}));return;
  }
  if(url.pathname==='/api/records/Counter'&&method==='GET'){
   counterReads++;
   await route.fulfill(json({records:[{Id:counterId,Count:counter,Name:'current'}],total:1}));return;
  }
  if(url.pathname==='/api/records/Counter/'+counterId&&method==='PUT'){
   const body=request.postDataJSON();
   assert.equal(body.Count,counter+1,'Each action must read the preceding write');
   counter=body.Count;
   counterWrites++;
   await route.fulfill(json({record:{Id:counterId,Count:counter}}));return;
  }
  await route.fulfill({status:404,contentType:'application/json',
   body:JSON.stringify({error:'Unexpected isolated fixture request: '+method+' '+url.pathname})});
 });
 const started=Date.now();
 await page.goto(base+'/test/formula-runtime-stress-fixture.html',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__runtimeStress?.ready===true,null,{timeout:20000});
 await page.waitForFunction(()=>document.querySelector('[data-display="Text49"]')?.textContent?.trim()==='50',
   null,{timeout:12000});
 await page.waitForFunction(()=>document.querySelector('[data-sql-caption="Cart0"]')?.textContent?.trim()==='HELLO',
   null,{timeout:12000});
 assert.ok(sqlReads>=1,'Selected display formula must perform authenticated SQL request');
 report.results.sqlDisplayRequests=sqlReads;
 const readyMs=Date.now()-started;
 assert.equal(await page.locator('#fixture-count').textContent(),'56');
 assert.equal(await page.locator('[data-component]').count(),56);
 assert.equal(await page.locator('style[data-metadrive-shared-renderer-style]').count(),3,
  '50 Text, 3 Cart and 3 Card Grid instances need only three styles');
 assert.equal(await page.evaluate(()=>window.visualViewport?.scale),1);
 assert.ok(readyMs<10000,'56-component page must not freeze initialization for 10 seconds');
 const unrelatedBefore=await page.evaluate(()=>window.__runtimeStress.renderCount('Cart0'));
 const changeStarted=Date.now();
 await page.getByRole('button',{name:'Change root input'}).click();
 await page.waitForFunction(()=>document.querySelector('[data-display="Text49"]')?.textContent?.trim()==='59',
   null,{timeout:12000});
 const chainMs=Date.now()-changeStarted;
 const unrelatedAfter=await page.evaluate(()=>window.__runtimeStress.renderCount('Cart0'));
 assert.equal(unrelatedAfter,unrelatedBefore,'Unrelated Cart should not rerender for Text dependency');
 assert.equal(await page.locator('style[data-metadrive-shared-renderer-style]').count(),3,
  'Formula updates must not duplicate style elements');
 report.results.render={components:56,firstChainMs:readyMs,updateChainMs:chainMs,
  unrelatedCartRendersBefore:unrelatedBefore,unrelatedCartRendersAfter:unrelatedAfter,
  finalText:'59'};
 const reads=await page.evaluate(()=>window.__runtimeStress.readTest());
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-cart-total]')].length===3&&
   [...document.querySelectorAll('[data-cart-total]')].every(node=>node.textContent?.trim()==='1'),
   null,{timeout:10000});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const postWriteToPaintMs=await page.evaluate(at=>performance.now()-at,reads.postWriteAt);
 assert.ok(postWriteToPaintMs>=0&&postWriteToPaintMs<10000,
  'Successful writes must reach all three visible Cart subscribers without a 10-second freeze');
 assert.deepEqual(reads.before.map(page=>page.total),[0,0,0]);
 assert.deepEqual(reads.after.map(page=>page.total),[1,1]);
 assert.equal(cartWrites,1);
 assert.equal(cartReads,2,'Three Cart subscribers plus post-write refresh should issue exactly two GET requests');
 report.results.records={cartReads,cartWrites,postWriteToPaintMs,...reads};
 const actions=await page.evaluate(()=>window.__runtimeStress.tenActions());
 assert.equal(actions.writes,10,'No rapid action may be silently dropped');
 assert.equal(counterWrites,10);
 assert.equal(counter,10);
 assert.equal(counterReads,10);
 assert.deepEqual(actions.keys,['Counter']);
 report.results.actions={counterReads,counterWrites,finalValue:counter};
 assert.deepEqual(exceptions,[],'No React errors, unhandled promises or console failures');
 report.results.javascriptErrors=exceptions;
 await page.screenshot({path:join(root,'56-components.png'),animations:'disabled',fullPage:true});
 await page.evaluate(()=>window.__runtimeStress.unmount());
 assert.equal(await page.locator('style[data-metadrive-shared-renderer-style]').count(),0,
  'Unloading the last renderer must clean up shared styles');
 report.results.render.sharedStyles=3;
 report.results.render.stylesAfterUnmount=0;
 await writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n');
 console.info('Runtime formula stress E2E passed: '+JSON.stringify(report.results));
} finally {
 await context.close();
 await browser.close();
}
