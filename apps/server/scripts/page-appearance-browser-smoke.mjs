// Browser-level regression: metadata editing frames must not become UI shells.
// Both Chromium and WebKit run this against the actual shared Page appearance CSS.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium,webkit} from 'playwright';

const engine=process.env.METADRIVE_BROWSER_ENGINE==='webkit'?'webkit':'chromium';
const css=readFileSync(new URL('../../web/src/core/pages/TemplatePageRuntime/pageComponentAppearance.css',import.meta.url),'utf8');
const fixtures=[
 ['input','<div><input type="search" aria-label="Search" placeholder="Search"></div>','input'],
 ['toggle','<label>Setting<input type="checkbox" role="switch"></label>','[role="switch"]'],
 ['button','<div><button>Continue</button></div>','button'],
 ['badge','<div><span class="smart-badge">Ready</span></div>','.smart-badge'],
 ['text','<div><span class="smart-text">Headline</span></div>','.smart-text'],
 ['image','<div><img alt="Sample" width="100" height="40"></div>','img'],
 ['surface','<section class="smart-container">Content</section>','.smart-container'],
 ['collection','<div class="smart-grid">Product cards</div>','.smart-grid'],
 ['table','<div class="smart-table">Table rows</div>','.smart-table'],
 ['calendar','<section class="smart-calendar">October</section>','.smart-calendar'],
 ['progress','<progress max="100" value="50"></progress>','progress'],
 ['layout','<div class="smart-container">Layout</div>','.smart-container'],
 ['tabs','<button role="tab">Tab</button>','[role="tab"]'],
 ['cart','<section class="smart-cart">Basket</section>','.smart-cart'],
 ['form','<form>Form</form>','form'],
 ['overlay','<div role="dialog">Open</div>','[role="dialog"]']
];
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const parts=fixtures.map(([name,markup],i)=>`
 <article class="case"><h3>${name}</h3>
  <div class="record-component" id="case-${i}" data-page-appearance="${name}"
   data-page-style="radius padding border stroke background color font-size opacity"
   style="background:red;border:6px solid red;padding:30px;
     --md-page-radius:24px;--md-page-padding:9px;
     --md-page-border-width:3px;--md-page-border-color:#557799;
     --md-page-background:#eff4ff;--md-page-color:#112233;
     --md-page-font-size:22px;--md-page-opacity:0.7">
   <div class="registered-component">${markup}</div>
  </div>
 </article>`).join('');
 await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>
 <main style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;padding:24px">${parts}</main>
 </body></html>`);
 // Eliminate initial UA-to-theme transitions: assertions inspect final styles.
 await page.addStyleTag({content:css+'\n* {transition:none!important;animation:none!important}'});
 const measurements=await page.evaluate(items=>items.map(([name,,selector],i)=>{
   const frame=document.querySelector('#case-'+i);
   const visual=frame?.querySelector(selector);
   if(!frame||!visual)throw Error('Missing fixture for '+name);
   const a=getComputedStyle(frame),b=getComputedStyle(visual);
   return {name,
     outerBorder:a.borderTopWidth,outerPadding:a.paddingTop,outerBackground:a.backgroundColor,
     radius:b.borderTopLeftRadius,padding:b.paddingTop,background:b.backgroundColor,
     fontSize:b.fontSize,opacity:b.opacity};
 }),fixtures);
 for(const item of measurements){
   assert.equal(item.outerBorder,'0px',item.name+' has an outer border');
   assert.equal(item.outerPadding,'0px',item.name+' has outer padding');
   assert.notEqual(item.outerBackground,'rgb(255, 0, 0)',item.name+' has an outer fill');
   assert.equal(item.radius,'24px',item.name+' radius missed the visible element');
   assert.equal(item.padding,'9px',item.name+' padding missed the visible element');
   assert.equal(item.background,'rgb(239, 244, 255)',item.name+' fill missed the visible element');
   assert.equal(item.fontSize,'22px',item.name+' typography missed the visible element');
   assert.equal(item.opacity,'0.7',item.name+' opacity missed the visible element');
 }
 mkdirSync(new URL('../artifacts/',import.meta.url),{recursive:true});
 await page.screenshot({path:new URL('../artifacts/page-component-appearance-'+engine+'.png',import.meta.url).pathname,fullPage:true});
 console.info('Verified transparent frames and visible control appearance:',engine,fixtures.length,'component families');
}finally{await browser.close();}
