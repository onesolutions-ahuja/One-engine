// UX-0072–0084: real App Manager React component in a non-tenant fixture,
// tested at native browser zoom and original small/landscape/desktop breakpoints.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const base=process.env.SETUP_UX_BASE_URL??'http://127.0.0.1:5173';
const out=process.env.UI_84_APPS_SCREENSHOT_DIR??'artifacts/ui-84-app-manager';
const sizes=[
 [320,568],[360,800],[375,812],[390,844],[430,932],
 [568,320],[667,375],[844,390],[600,900],[700,844],
 [768,1024],[820,1180],[900,600],[1024,768],[1180,820],
 [1280,800],[1440,900],[1920,1080],[2560,1440]
];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?
 {executablePath:process.env.CHROME_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try{
 for(const [width,height] of sizes){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
  const page=await context.newPage();
  await page.goto(base+'/test/setup-ux-fixture.html?view=app-manager',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'App Manager',exact:true}).waitFor();
  const m=await page.evaluate(()=>{
    const doc=document.documentElement;
    const heading=document.querySelector('.app-manager-top h1');
    const search=document.querySelector('.app-manager-list-search');
    const result=document.querySelector('.app-manager-list-result-count');
    return {overflow:Math.max(0,doc.scrollWidth-doc.clientWidth),
      zoom:window.visualViewport?.scale??1,
      heading:heading?parseFloat(getComputedStyle(heading).fontSize):null,
      searchHeight:search?.getBoundingClientRect().height??0,
      result:result?.textContent??''};
  });
  assert.equal(m.zoom,1,'Browser must remain at 100% zoom');
  assert.ok(m.overflow<=1,`App Manager overflow ${m.overflow}px at ${width}x${height}`);
  assert.ok(m.heading!==null&&m.heading>=20,'App Manager title must remain readable');
  assert.ok(m.searchHeight>=36,`Search input too short at ${width}px: ${m.searchHeight}`);
  assert.match(m.result,/1 of 1 apps shown/);
  if(width<=1199){
    const direction=page.locator('.app-manager-sort-direction');
    await direction.waitFor({state:'visible'});
    assert.equal(await direction.getAttribute('aria-pressed'),'false');
    await direction.click();
    assert.equal(await direction.getAttribute('aria-pressed'),'true');
  }
  if(width===1440){
    await page.getByRole('button',{name:'Clone Sales Workspace',exact:true}).click();
    await page.getByRole('heading',{name:'Create New App'}).waitFor();
    assert.match(await page.locator('input[aria-label="App Label"]').inputValue(),/Sales Workspace/);
    await page.keyboard.press('Escape');
    await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).waitFor({state:'hidden'});
    await page.keyboard.press('Escape');
    await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).waitFor();
    await page.getByRole('button',{name:'Discard changes'}).click();
    await page.getByRole('heading',{name:'Existing Apps',exact:false}).waitFor();
    await page.getByRole('button',{name:'Edit Sales Workspace',exact:true}).click();
    await page.locator('input[aria-label="App Label"]').fill('Modified audit draft');
    await page.keyboard.press('Escape');
    await page.getByRole('alertdialog',{name:'Discard unsaved changes?'}).waitFor();
    await page.getByRole('button',{name:'Discard changes'}).click();
    assert.equal(await page.evaluate(()=>window.savedAuditApp),undefined,'No app must be persisted by this audit');
  }
  if(process.env.UI_84_APPS_SCREENSHOTS==='1')
   await page.screenshot({path:join(out,`app-manager-${width}x${height}.png`),animations:'disabled'});
  await context.close();
 }
 console.log('UI audit: App Manager source-backed fixture passed 19 viewports plus clone and discard');
}finally{await browser.close();}
