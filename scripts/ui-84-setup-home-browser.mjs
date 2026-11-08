// UX-0019–0031 native 100%-zoom browser contract for the actual Setup Home
// React component in an isolated local fixture. This is not a tenant login.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const base=process.env.SETUP_UX_BASE_URL??'http://127.0.0.1:5173';
const out=process.env.UI_84_SETUP_SCREENSHOT_DIR??'artifacts/ui-84-setup-home';
const sizes=[
 [320,568],[360,800],[375,812],[390,844],[430,932],
 [568,320],[667,375],[844,390],[600,900],[700,844],
 [768,1024],[820,1180],[900,600],[1024,768],[1180,820],
 [1280,800],[1440,900],[1920,1080],[2560,1440]
];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?
 {executablePath:process.env.CHROME_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try {
 for(const [width,height] of sizes){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
  const page=await context.newPage();
  await page.goto(base+'/test/setup-ux-fixture.html?view=setup-home',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Setup Home'}).waitFor();
  const m=await page.evaluate(()=>{
    const doc=document.documentElement;
    const home=document.querySelector('.home-content');
    const cards=[...document.querySelectorAll('.home-content .shortcut-card')];
    const grid=document.querySelector('.home-content .shortcut-grid');
    const lower=document.querySelector('.home-content .home-lower-grid');
    const heading=document.querySelector('.home-content .page-heading h1');
    const icon=document.querySelector('.home-content .shortcut-icon');
    return {text:home?.innerText.length??0,cards:cards.length,
      overflow:Math.max(0,doc.scrollWidth-doc.clientWidth),
      zoom:window.visualViewport?.scale??1,
      h1:heading?parseFloat(getComputedStyle(heading).fontSize):null,
      tile:icon?icon.getBoundingClientRect().width:null,
      gridGap:grid?parseFloat(getComputedStyle(grid).columnGap):null,
      lowerGap:lower?parseFloat(getComputedStyle(lower).columnGap):null,
      blank:cards.some(card=>card.getBoundingClientRect().width===0)};
  });
  assert.equal(m.zoom,1,'Browser must remain at 100% zoom');
  assert.ok(m.text>500,`Setup Home appears blank at ${width}x${height}`);
  assert.ok(m.cards>=5,'Every required Setup shortcut must render at every breakpoint');
  assert.equal(m.blank,false,'Every shortcut must have nonzero width');
  assert.ok(m.overflow<=1,`Setup Home horizontal overflow ${m.overflow}px at ${width}x${height}`);
  assert.ok(m.h1!==null&&m.h1>=20,'Setup Home title must stay legible');
  assert.ok(m.tile!==null&&m.tile<=38,'Setup Home tiles should not overwhelm labels');
  assert.ok(Math.abs(m.gridGap-m.lowerGap)<=1,'Home grids must share a spacing token');
  if(process.env.UI_84_SETUP_SCREENSHOTS==='1')
   await page.screenshot({path:join(out,`setup-home-${width}x${height}.png`),animations:'disabled'});
  await context.close();
 }
 console.log('UI audit: Setup Home source-backed fixture passed 19 responsive viewports');
} finally {await browser.close();}
