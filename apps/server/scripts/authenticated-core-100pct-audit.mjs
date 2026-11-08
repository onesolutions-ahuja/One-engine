// Authenticated route screenshots against a disposable SQL tenant.
// The caller owns its logged-in Playwright page and CI-local API; no production access.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function auditAuthenticatedCoreRoutes({page,origin,caseId}){
 const output=new URL('../artifacts/',import.meta.url).pathname;
 await mkdir(output,{recursive:true});
 const routes=[
  ...['home','object-manager','page-builder','dashboard-builder','report-builder',
    'flow-builder','flow-interviews','scheduled-flows','flow-logs',
    'automation-settings','app-manager','app-exchange','named-credentials',
    'company-settings','tenant-management','rbac']
    .map(key=>({name:'setup-'+key,path:'/une/setup/'+key})),
  {name:'records-list',path:'/une/o/ReviewCase/list'},
  {name:'record-detail',path:'/une/r/ReviewCase/'+encodeURIComponent(caseId)+'/view'}
 ];
 const sizes=[
  {name:'desktop',width:1440,height:900},
  {name:'tablet',width:820,height:1180},
  {name:'phone',width:390,height:844}
 ];
 const results=[];
 let routeErrors=[];
 const onError=(error)=>routeErrors.push(error.message);
 page.on('pageerror',onError);
 try{
  for(const size of sizes){
   await page.setViewportSize({width:size.width,height:size.height});
   for(const route of routes){
    routeErrors=[];
    const name='auth-ui-'+route.name+'-'+size.name;
    const result={route:route.path,screen:route.name,viewport:size.name,
      width:size.width,height:size.height,screenshot:name+'.png',issues:[]};
    try{
     await page.goto(origin+route.path,{waitUntil:'domcontentloaded',timeout:25000});
     await page.locator('.workspace').first().waitFor({state:'visible',timeout:15000});
     if(['setup-app-exchange','setup-named-credentials'].includes(route.name)){
      await page.waitForFunction(()=>!document.querySelector('.workspace')?.innerText.includes('Loading live'),undefined,{timeout:15000});
     }
     await page.waitForTimeout(200);
     const metrics=await page.evaluate(()=>{
      const root=document.documentElement;
      return {
       zoom:window.visualViewport?.scale??1,
       overflowPx:Math.max(0,root.scrollWidth-root.clientWidth),
       hasSignIn:!!document.querySelector('input[type=password]')&&
         !!document.querySelector('button[type=submit]')&&
         !!document.querySelector('[autocomplete=username]'),
       content:document.querySelector('.workspace')?.innerText.trim().slice(0,160)??''
      };
     });
     Object.assign(result,metrics);
     if(Math.abs(metrics.zoom-1)>0.005)result.issues.push('non-native browser zoom');
     if(metrics.hasSignIn)result.issues.push('unexpected login screen');
     if(!metrics.content)result.issues.push('empty workspace');
     if(/could not be verified/i.test(metrics.content))result.issues.push('credential metadata unavailable in disposable SQL fixture');
     if(metrics.overflowPx>6)result.issues.push('document horizontal overflow '+metrics.overflowPx+'px');
    }catch(error){result.issues.push('route load: '+String(error).slice(0,350));}
    if(routeErrors.length)result.issues.push('JavaScript: '+routeErrors.slice(0,2).join('; ').slice(0,300));
    try{await page.screenshot({path:join(output,result.screenshot),animations:'disabled'});}
    catch(e){result.issues.push('screenshot: '+String(e).slice(0,120));}
    results.push(result);
    console.info('AUTH UI',result.issues.length?'REVIEW':'RENDERED',name,result.issues.join(' | '));
   }
  }
 }finally{page.off('pageerror',onError);}
 const summary={screens:routes.length,viewports:sizes.length,captures:results.length,
  clear:results.filter(x=>!x.issues.length).length,
  review:results.filter(x=>x.issues.length).length,
  tenant:'disposable CI SQL only',realUserTenantAudited:false,results};
 await writeFile(join(output,'auth-ui-report.json'),JSON.stringify(summary,null,2)+'\n');
 const lines=['# Authenticated Core UI — native 100% browser zoom','',
  'Real Core routes under disposable SQL tenant; not the user\'s live installation.',
  'Screens: '+summary.screens+'; captures: '+summary.captures+
    '; clear: '+summary.clear+'; review: '+summary.review,'',
  '| Route | Desktop | Tablet | Phone |','|---|---|---|---|'];
 for(const route of routes){
  const status=sizes.map(size=>{
   const r=results.find(x=>x.route===route.path&&x.viewport===size.name);
   return r.issues.length?'REVIEW':'RENDERED';
  });
  lines.push('| '+route.name+' | '+status.join(' | ')+' |');
 }
 lines.push('','## Findings');
 for(const r of results.filter(x=>x.issues.length))
  lines.push('- '+r.screen+' / '+r.viewport+': '+r.issues.join('; '));
 lines.push('','## Unverified','- Live tenant-specific published Pages, custom Record layouts, installed app configurations and production data were not accessed.');
 await writeFile(join(output,'auth-ui-report.md'),lines.join('\n')+'\n');
 console.info('AUTH UI SUMMARY',JSON.stringify({screens:summary.screens,captures:summary.captures,clear:summary.clear,review:summary.review}));
 assert.equal(results.length,routes.length*sizes.length);
 if(results.some(r=>r.issues.some(issue=>/^(route load:|JavaScript:|screenshot:|non-native|unexpected login|empty workspace)/.test(issue))))
  throw new Error('Authenticated core route audit found load/runtime failures. Inspect artifacts/auth-ui-report.json.');
 return summary;
}
