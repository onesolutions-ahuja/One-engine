// UX-0047–0055: non-destructive Data Loader tab and layout browser contracts.
// Uses the real React component with isolated mock metadata, never tenant records.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const base=process.env.SETUP_UX_BASE_URL??'http://127.0.0.1:5173';
const out=process.env.UI_84_LOADER_SCREENSHOT_DIR??'artifacts/ui-84-loader';
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
  await page.goto(base+'/test/setup-ux-fixture.html?view=data-loader',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Universal Data Loader',exact:true}).waitFor();
  const tabs=page.getByRole('tablist',{name:'Data Loader categories'});
  assert.equal(await tabs.getByRole('tab').count(),3);
  await tabs.getByRole('tab',{name:'Records',exact:true}).click();
  await page.getByRole('heading',{name:'Record Data'}).waitFor();
  assert.equal(await tabs.getByRole('tab',{name:'Records',exact:true}).getAttribute('aria-selected'),'true');
  await tabs.getByRole('tab',{name:'Smart Component Property Library'}).click();
  assert.equal(await tabs.getByRole('tab',{name:'Smart Component Property Library'}).getAttribute('aria-selected'),'true');
  if(width===1440){
    // UX-0047: a real pointer sequence must always change the selected panel.
    const sequence=['Objects & Fields','Records','Smart Component Property Library',
      'Objects & Fields','Records','Smart Component Property Library',
      'Objects & Fields','Records','Smart Component Property Library','Objects & Fields'];
    for(const label of sequence){
      const tab=tabs.getByRole('tab',{name:label,exact:true});
      await tab.click();
      assert.equal(await tab.getAttribute('aria-selected'),'true',
        'Mouse click did not activate '+label);
    }
  }
  if(width===1920){
    // UX-0053: category bar starts on the same x as the inset panel controls.
    await tabs.getByRole('tab',{name:'Objects & Fields'}).click();
    const align=await page.evaluate(()=>{
      const bar=document.querySelector('[aria-label="Data Loader categories"]');
      const content=document.querySelector('[aria-label="Object Metadata Loader"] > section > .section-toolbar');
      return {bar:bar?.getBoundingClientRect().left,
        content:content?.getBoundingClientRect().left};
    });
    assert.ok(align.bar!==undefined&&align.content!==undefined,
      'Data Loader panel geometry unavailable');
    assert.ok(Math.abs(align.bar-align.content)<=1,
      'Data Loader tabs and panel content do not align: '+JSON.stringify(align));
  }
  await tabs.getByRole('tab',{name:'Objects & Fields'}).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await tabs.getByRole('tab',{name:'Records'}).getAttribute('aria-selected'),'true');
  const m=await page.evaluate(()=>{
    const doc=document.documentElement;
    const visible=el=>{const r=el.getBoundingClientRect(),css=getComputedStyle(el);return r.width>0&&r.height>0&&css.display!=='none'};
    const overflowFiles=[...document.querySelectorAll('input[type="file"]')]
      .filter(visible).filter(el=>el.getBoundingClientRect().right>doc.clientWidth+1).length;
    return {zoom:window.visualViewport?.scale??1,overflow:Math.max(0,doc.scrollWidth-doc.clientWidth),overflowFiles};
  });
  assert.equal(m.zoom,1);
  assert.ok(m.overflow<=1,`Loader overflow ${m.overflow}px at ${width}x${height}`);
  assert.equal(m.overflowFiles,0,'Workbook controls must fit their panel');
  if(process.env.UI_84_LOADER_SCREENSHOTS==='1')
   await page.screenshot({path:join(out,`data-loader-${width}x${height}.png`),animations:'disabled'});
  await context.close();
 }
 console.log('UI audit: Data Loader tab interactions and responsive layout passed 19 viewports');
}finally{await browser.close();}
