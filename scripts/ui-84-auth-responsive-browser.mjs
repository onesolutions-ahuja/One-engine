// Authenticated workspace controls are intentionally excluded: this is an
// unauthenticated, 100%-zoom browser regression for the original UX-0001–0018.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

const base=process.env.SETUP_UX_BASE_URL??'http://127.0.0.1:5173';
const out=process.env.UI_84_AUTH_SCREENSHOT_DIR??'artifacts/ui-84-auth';
const sizes=[
 [320,568],[360,800],[375,812],[390,844],[430,932],
 [568,320],[667,375],[844,390],[600,900],[700,844],
 [768,1024],[820,1180],[900,600],[1024,768],[1180,820],
 [1280,800],[1440,900],[1920,1080],[2560,1440]
];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?
 {executablePath:process.env.CHROME_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
let checked=0;
try{
 for(const [width,height] of sizes){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
  const page=await context.newPage();
  // No tenant login or reset request is made. Only read-only federation boot calls are stubbed.
  await page.route('**/auth/federation/*',async route=>{
    const path=new URL(route.request().url()).pathname;
    await route.fulfill(path.endsWith('/providers')
      ?{status:200,contentType:'application/json',body:JSON.stringify({providers:[]})}
      :{status:204,body:''});
  });
  await page.route('**/auth/password-reset/options',async route=>
    route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({otpLength:6,method:'OTP',channels:{email:false,whatsapp:false,sms:false}})}));
  await page.goto(base+'/login',{waitUntil:'domcontentloaded',timeout:30000});
  const signIn=page.getByRole('button',{name:'Sign in',exact:true});
  await signIn.waitFor({state:'visible',timeout:20000});
  // UX-0010: all three footer destinations must exist without optional env config.
  const footer=page.locator('nav.auth-signin-footer[aria-label="Sign-in help and legal"]');
  const terms=footer.locator('a').filter({hasText:/^Terms$/});
  assert.equal(await footer.count(),1,'Footer navigation must exist for each login variant');
  assert.equal(await footer.locator('a').filter({hasText:/^Contact support$/}).count(),1);
  assert.equal(await footer.locator('a').filter({hasText:/^Privacy Policy$/}).count(),1);
  assert.equal(await terms.count(),1);
  assert.match(await terms.getAttribute('href'),/(^|\/)terms\/?$|^https:\/\//);
  const metrics=await page.evaluate(()=>{
    const html=document.documentElement;
    const button=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Sign in');
    const bounds=button?.getBoundingClientRect();
    const footerBounds=document.querySelector('.auth-signin-footer')?.getBoundingClientRect();
    return {overflow:Math.max(0,html.scrollWidth-html.clientWidth),
      zoom:window.visualViewport?.scale??1,
      buttonBottom:bounds?.bottom??Infinity,
      footerBottom:footerBounds?.bottom??Infinity,
      footerHeight:footerBounds?.height??0,
      buttonHeight:bounds?.height??0,
      visibleWidth:html.clientWidth};
  });
  assert.equal(metrics.zoom,1,'Browser must stay at 100% zoom');
  assert.ok(metrics.overflow<=1,`Login horizontal overflow ${metrics.overflow}px at ${width}x${height}`);
  assert.ok(metrics.buttonHeight>=36,`Login button inaccessible at ${width}x${height}`);
  if((width===320&&height===568)||(height<=390&&width>=568)){
    assert.ok(metrics.buttonBottom<=height+2,
      `Sign in below first viewport at ${width}x${height}: bottom ${metrics.buttonBottom}`);
  }
  if((width===320&&height===568)||(width===1440&&height===900)){
    const legal=await context.newPage();
    await legal.goto(base+'/terms',{waitUntil:'domcontentloaded'});
    await legal.getByRole('heading',{name:'Service Terms',exact:true}).waitFor();
    await legal.getByRole('link',{name:'support@unesolutions.co.uk'}).waitFor();
    assert.equal(await legal.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,
      'Public terms information must not scroll horizontally');
    await legal.close();
  }
  if((width===320&&height===568)||(width===768&&height===1024)||(width===1440&&height===900)){
    assert.ok(metrics.footerHeight>0,'Legal footer must be rendered at '+width+'x'+height);
    assert.ok(metrics.footerBottom<=height+2,
      'Sign-in legal footer must fit first viewport at '+width+'x'+height+
      ', bottom '+metrics.footerBottom);
  }
  if(width===320||width===390||width===1024){
    await page.getByRole('button',{name:'Forgot password?'}).click();
    await page.getByRole('heading',{name:'Recover your password'}).waitFor();
    // Wait until async options have resolved; checking before that races the initial loading state.
    await page.locator('a[href="mailto:support@unesolutions.co.uk"]').waitFor({state:'visible'});
    const recovery=await page.evaluate(()=>({
      overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),
      unavailable:document.body.innerText.includes('Not configured'),
      contact:!!document.querySelector('a[href="mailto:support@unesolutions.co.uk"]')
    }));
    assert.ok(recovery.overflow<=1,`Recovery overflow at ${width}px`);
    assert.equal(recovery.unavailable,false,'Do not expose unconfigured recovery channels');
    assert.equal(recovery.contact,true,'Recovery must offer a real contact route');
  }
  if(process.env.UI_84_AUTH_SCREENSHOTS==='1')
    await page.screenshot({path:join(out,`login-${width}x${height}.png`),animations:'disabled'});
  checked++;
  await context.close();
 }
 console.log(`UI audit: login/recovery geometry passed at ${checked} native 100%-zoom viewports`);
} finally {await browser.close();}
