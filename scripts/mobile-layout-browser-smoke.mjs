// Phone/tablet UI contract screenshot evidence for public CSS, independent of tenant credentials.
// Runs inside the existing Frontend visual contract workflow (Chromium + Playwright).
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const assets=[
 '../apps/web/src/core/workspace/SetupShell/MobileAppNavigation.css',
 '../apps/web/src/core/workspace/SetupShell/MobileSheet.css',
 '../apps/web/src/core/records/RecordWorkspace/recordsListToolbar.css',
 '../apps/web/src/core/records/ResponsiveDataList/ResponsiveDataList.css',
 '../apps/web/src/core/workspace/WorkspaceTheme/styles.css'
];
const css=assets.map(path=>readFileSync(new URL(path,import.meta.url),'utf8')
  .replace(/^@import[^;]+;\s*/gm,'')).join('\n');
mkdirSync('artifacts',{recursive:true});
const template=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head>
<body style="margin:0"><div class="lightning" style="--md-ios-surface:#fff;--md-ios-bg:#f2f2f7;--md-ios-separator:#c6c6c8;--md-ios-accent:#007aff;min-height:100dvh">
<header class="salesforce-header" style="display:flex;align-items:center;justify-content:space-between">
  <strong>MetaDrive</strong><button type="button" class="md-mobile-launcher">Apps</button></header>
<main class="setup-layout" style="display:block;background:#f2f2f7;min-height:100dvh">
 <section class="records-list-card" style="margin:0;padding:0 12px">
  <div class="records-list-toolbar records-main-toolbar"><div class="records-phone-title-line">
   <div><h2>Accounts</h2><span>5000 records</span></div>
   <div class="records-phone-title-actions"><button type="button" class="records-phone-new">＋</button></div>
  </div><label class="records-search"><input placeholder="Search records" /></label></div>
  <div class="records-phone-rows" role="list" aria-label="Accounts records">
    <article role="listitem" class="records-phone-row"><a href="#" class="records-phone-row-link">
     <div class="records-phone-row-main"><strong>Acme - Example customer</strong>
      <span>Account · Active</span><small class="records-phone-row-badge">Active</small></div>
      <span class="records-phone-row-trailing">£1200</span><span>›</span></a>
    </article>
  </div>
  <div class="records-phone-pagination"><span>50 of 5000 loaded</span><button>Load more</button></div>
 </section>
 </main>
 <nav class="md-mobile-app-tabs" aria-label="Application pages">
  <button class="active"><span>⌂</span><span>Home</span></button>
  <button><span>▦</span><span>Accounts</span></button>
  <button><span>⚙</span><span>Settings</span></button>
 </nav>
 <div class="md-mobile-sheet-backdrop"><section class="md-mobile-sheet" role="dialog" aria-modal="true">
  <header><span class="md-mobile-sheet-grabber"></span><strong>Edit account</strong><button>Done</button></header>
  <div class="md-mobile-sheet-content"><label>Account Name <input value="Acme" /></label>
   <label>Status <select><option>Active</option></select></label></div>
  <footer class="md-mobile-sheet-footer"><button>Cancel</button><button>Save</button></footer>
 </section></div>
</div></body></html>`;
const browser=await chromium.launch({headless:true});
try{
 for(const {width,height} of [
  {width:375,height:812},{width:390,height:844},{width:430,height:932},
  {width:844,height:390},{width:768,height:1024},{width:1024,height:768}
 ]){
  const phone=width<600||height<=500;
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:phone,hasTouch:phone});
  await page.setContent(template);await page.addStyleTag({content:css});
  await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(()=>{
    const info=selector=>{const el=document.querySelector(selector),rect=el.getBoundingClientRect();
      return {display:getComputedStyle(el).display,height:rect.height,width:rect.width};};
    return {width:document.documentElement.scrollWidth,tab:info('.md-mobile-app-tabs'),
      rows:info('.records-phone-rows'),sheet:info('.md-mobile-sheet'),header:info('.salesforce-header')};
  });
  assert.ok(result.width<=width+2,'Unexpected horizontal overflow '+width+': '+JSON.stringify(result));
  if(phone) {
   assert.notEqual(result.tab.display,'none','Bottom tabs missing '+width);
   assert.ok(result.tab.height>=49,'Bottom tab touch target is too short');
   assert.notEqual(result.rows.display,'none','Phone record list missing');
   assert.ok(result.sheet.width<=width+1,'Sheet exceeds viewport');
  }else{
   assert.equal(result.tab.display,'none','Desktop tab bar appeared at '+width);
  }
  await page.screenshot({path:'artifacts/mobile-plan-'+width+'x'+height+'.png',fullPage:false});
  if(width===390){
   await page.evaluate(()=>{
    const list=document.querySelector('.records-phone-rows');
    const sample=list.firstElementChild.cloneNode(true),frag=document.createDocumentFragment();
    for(let i=1;i<5000;i++){const row=sample.cloneNode(true);row.querySelector('strong').textContent='Account '+i;frag.append(row);}
    list.append(frag);
   });
   const documentWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
   assert.ok(documentWidth<=width+2,'5000-row phone list leaks width');
  }
  await page.close();
 }
}finally{await browser.close();}
console.log('Mobile Records, tab and form-sheet viewport contracts passed');
