// Source-backed visual audit of actual React screens at browser zoom 100%.
// This is deliberately not an authenticated tenant / published-metadata audit.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const root=process.env.ALL_APPS_UI_AUDIT_DIR || 'artifacts/all-apps-ui';
const base=process.env.SETUP_UX_BASE_URL || 'http://127.0.0.1:5173';
const sizes=[
  {name:'desktop',width:1440,height:900},
  {name:'laptop',width:1024,height:768},
  {name:'tablet',width:768,height:1024},
  {name:'phone',width:390,height:844}
];
const screens=[
  {app:'MetaDrive Setup',view:'setup-home',title:'Setup Home'},
  {app:'MetaDrive Setup',view:'tenants',title:'Tenant management'},
  {app:'MetaDrive Setup',view:'credentials',title:'Named Credentials and Webhook'},
  {app:'MetaDrive Setup',view:'credentials-view',title:'Credential details modal'},
  {app:'MetaDrive Setup',view:'credentials-edit',title:'Credential editing modal'},
  {app:'MetaDrive Setup',view:'offline',title:'Offline briefcase settings'},
  {app:'MetaDrive Setup',view:'records-import',title:'Record workspace lazy route'},
  {app:'MetaDrive Builders',view:'schema',title:'Schema Builder'},
  {app:'MetaDrive Builders',view:'flows',title:'Flow Builder'},
  {app:'MetaDrive Builders',view:'dashboard',title:'Dashboard Builder'},
  {app:'MetaDrive Security',view:'mfa',title:'Multifactor authentication'},
  {app:'MetaDrive Security',view:'oauth',title:'Connected applications'},
  {app:'MetaDrive Security',view:'oauth-directory',title:'Connected applications assignments'},
  {app:'MetaDrive Security',view:'security-history',title:'Security history'},
  {app:'MetaDrive Security',view:'governance',title:'Security governance'},
  {app:'MetaDrive Security',view:'monitoring',title:'Security monitoring'},
  {app:'MetaDrive Security',view:'licenses',title:'Licence administration'},
  {app:'MetaDrive Security',view:'federation',title:'SSO / federation'},
  {app:'MetaDrive Security',view:'password',title:'Password policies'},
  {app:'MetaDrive Security',view:'sessions',title:'Session controls'},
  {app:'MetaDrive Security',view:'company',title:'Company settings'},
  {app:'MetaDrive Security',view:'company-profile-fail',title:'Company data read error'},
  {app:'Shared UI',view:'smart-card-grid-scroll',title:'Smart card grid'},
  {app:'Shared UI',view:'image-render-stability',title:'Tenant image'},
  {app:'MetaDrive Builders',view:'floating-canvas-actions',title:'Canvas toolbar'}
];
const source=readFileSync('apps/web/src/core/metadata/Definitions/metadata.ts','utf8');
const declared=source.match(/export type WorkspaceId =([\s\S]*?);/)?.[1]??'';
const declaredWorkspaces=[...declared.matchAll(/'([^']+)'/g)].map(x=>x[1]);
const navigationSource=source.slice(source.indexOf('export const setupNavigation = ['),source.indexOf('];',source.indexOf('export const setupNavigation = ['))+2);
const setupDestinations=[...navigationSource.matchAll(/items: \[([^\]]+)\]/g)]
  .flatMap(group=>[...group[1].matchAll(/'([^']+)'/g)].map(label=>label[1]));
// Full route states are never equated with thin component fixtures.
const setupRouteRepresentation={
  'Tenant Management':['tenants','partial'],
  'Company Settings':['company','partial'],
  'Security & Recovery':['governance','partial'],
  'Connected Apps':['oauth','partial'],
  'Audit Trail':['security-history','partial'],
  'Setup Home':['setup-home','fixture'],
  'Object Manager':['schema','partial'],
  'Page Builder':['floating-canvas-actions','partial'],
  'Named Credentials':['credentials','fixture'],
  'Webhook Endpoints':['credentials','partial'],
  'Flows':['flows','partial'],
  'Dashboards':['dashboard','partial']
};
const setupCoverage=setupDestinations.map(label=>({
  label,fixture:setupRouteRepresentation[label]?.[0]??null,
  level:setupRouteRepresentation[label]?.[1]??'unverified'
}));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{
  executablePath:process.env.CHROME_EXECUTABLE,
  args:['--no-sandbox','--disable-dev-shm-usage']
}:{})});
const results=[];
await mkdir(root,{recursive:true});
try{
  for(const viewport of sizes){
    const context=await browser.newContext({
      viewport:{width:viewport.width,height:viewport.height},
      deviceScaleFactor:1, isMobile:false
    });
    const page=await context.newPage();
    let errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    // Deterministic mock endpoints: these are fixtures, never live tenant credentials.
    await page.route('**/api/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(pathname==='/api/flows/available-actions'){
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({actions:[]})});
      } else if(pathname.startsWith('/api/flows/')){
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({outputs:{conversations:[],communications:[],messages:[],contacts:[]}})});
      } else {
        await route.fulfill({status:200,contentType:'application/json',body:'{}'});
      }
    });
    for(const screen of screens){
      errors=[];
      const file=screen.app.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'--'+screen.view+'--'+viewport.name;
      const url=base+'/test/setup-ux-fixture.html?view='+encodeURIComponent(screen.view);
      let failure='';
      try{
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
        await page.locator('#root > *').first().waitFor({state:'visible',timeout:15000});
        await page.waitForTimeout(300);
        if(screen.view==='credentials-view'||screen.view==='credentials-edit'){
          // Open the actual credential dialog via its user-visible controls.
          // The responsive list uses a row-opening action rather than desktop's icon bar.
          const tableAction=screen.view==='credentials-edit'?'Edit Sample credential':'Webhook details for Sample credential';
          const isDesktop=viewport.width>=900;
          if(isDesktop)await page.getByRole('button',{name:tableAction,exact:true}).click();
          else {
            // Layout audit setup: activate the existing React action through the
            // hidden desktop table. This verifies responsive modal appearance;
            // it does NOT claim the mobile row-opening control was exercised.
            const action=screen.view==='credentials-edit'?'Edit Sample credential':'View Sample credential';
            await page.locator('table.slds-table button[aria-label="'+action+'"]').evaluate(element=>element.click());
          }
          await page.locator('.named-credential-modal').waitFor({state:'visible',timeout:5000});
        }
      }catch(e){failure=e instanceof Error?e.message:String(e);}
      const metric=await page.evaluate(()=>{
        const html=document.documentElement, body=document.body;
        const viewportWidth=html.clientWidth;
        const docWidth=Math.max(html.scrollWidth,body.scrollWidth);
        const visible=(el)=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);
          return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
        const clipped=[...document.querySelectorAll('.setup-sidebar .tree-item > span:not(.md-setup-icon), .shortcut-title, .shortcut-description')]
          .filter(el=>visible(el)&&el.scrollWidth>el.clientWidth+2)
          .map(el=>({text:el.textContent?.trim().slice(0,60),width:el.clientWidth,scrollWidth:el.scrollWidth}))
          .slice(0,20);
        const controls=[...document.querySelectorAll('button,input,select,textarea,[role="button"]')].filter(visible);
        const offscreenControls=controls.filter(el=>{
          const r=el.getBoundingClientRect();
          return r.right>viewportWidth+6||r.left< -6;
        }).slice(0,12).map(el=>({label:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().slice(0,60),
          right:Math.round(el.getBoundingClientRect().right)}));
        const oversizedInputs=[...document.querySelectorAll('input:not([type="checkbox"]),select,textarea')]
          .filter(el=>visible(el)&&el.getBoundingClientRect().width>560)
          .slice(0,12).map(el=>({name:(el.getAttribute('aria-label')||el.name||el.getAttribute('placeholder')||'').slice(0,60),
            width:Math.round(el.getBoundingClientRect().width)}));
        const actions=[...document.querySelectorAll('.named-credentials-page .slds-table td:last-child .toolbar-actions')];
        // A short icon button naturally has a different top edge from a tall
        // labelled button. Measure centre lines, not top edges: wrapping shifts
        // the centre by a whole row, while align-items:center keeps it shared.
        const actionWraps=actions.map(el=>{
          const mids=[...el.children].filter(visible).map(child=>{
            const rect=child.getBoundingClientRect();
            return rect.top+rect.height/2;
          });
          return mids.length>1&&Math.max(...mids)-Math.min(...mids)>12;
        }).filter(Boolean).length;
        const modal=document.querySelector('.named-credential-modal');
        const modalRect=modal?.getBoundingClientRect();
        const configGrid=modal?.querySelector('.connector-config-fields');
        const configColumns=configGrid?new Set([...configGrid.querySelectorAll('.connector-config-row')].filter(visible).map(row=>Math.round(row.getBoundingClientRect().left))).size:0;
        const modalOverflow=modal?modal.scrollWidth>modal.clientWidth+6:false;
        const variableInputWidths=modal?[...modal.querySelectorAll('.connector-config-row input.form-control')].map(input=>({
          inputWidth:Math.round(input.getBoundingClientRect().width),
          rowWidth:Math.round(input.closest('.connector-config-row').getBoundingClientRect().width)
        })) : [];
        return {zoom:window.visualViewport?.scale??1,docWidth,viewportWidth,
          horizontalOverflow:Math.max(0,docWidth-viewportWidth),
          renderedText:body.innerText.trim().slice(0,180),
          controlCount:controls.length,clipped,offscreenControls,oversizedInputs,actionWraps,
          modalWidth:modalRect?Math.round(modalRect.width):null,modalOverflow,configColumns,variableInputWidths};
      }).catch(e=>({error:String(e)}));
      try{await page.screenshot({path:join(root,file+'.png'),animations:'disabled'});}
      catch(e){failure+=(failure?'; ':'')+'Screenshot failed: '+String(e);}
      const issues=[];
      if(failure)issues.push('render: '+failure.slice(0,160));
      if(errors.length)issues.push('JavaScript errors: '+errors.slice(0,2).join('; ').slice(0,190));
      if(metric.error)issues.push('metrics: '+metric.error);
      if(metric.horizontalOverflow>6)issues.push('document horizontal overflow: '+metric.horizontalOverflow+'px');
      if(metric.actionWraps)issues.push('wrapped credential action rows: '+metric.actionWraps);
      if(metric.modalOverflow)issues.push('credential dialog horizontal overflow');
      if(screen.view==='credentials-view'||screen.view==='credentials-edit'){
        if(!metric.modalWidth)issues.push('credential dialog missing');
        if(metric.modalWidth>metric.viewportWidth+2)issues.push('credential dialog exceeds viewport');
        if(metric.configColumns!==(viewport.width>720?2:1))issues.push('configuration grid columns: '+metric.configColumns);
        if(metric.variableInputWidths?.some(({inputWidth,rowWidth})=>inputWidth<Math.max(110,rowWidth*.72)))
          issues.push('configuration field too narrow relative to grid column');
      }
      if(!metric.renderedText)issues.push('empty rendered content');
      if(Math.abs((metric.zoom??1)-1)>0.001)issues.push('browser zoom is not 100%');
      const entry={application:screen.app,screen:screen.title,view:screen.view,
        viewport:viewport.name,width:viewport.width,height:viewport.height,
        image:file+'.png',...metric,issues,status:issues.length?'REVIEW':'RENDERED'};
      results.push(entry);
      console.log(entry.status+' '+screen.app+' / '+screen.title+' @ '+viewport.name+
        (issues.length?' — '+issues.join(', '):''));
    }
    await context.close();
  }
}finally{await browser.close();}
const counts={screens:screens.length,viewports:sizes.length,
  captures:results.length,rendered:results.filter(x=>x.status==='RENDERED').length,
  review:results.filter(x=>x.status==='REVIEW').length};
const report={
  heading:'100%-zoom source-backed fixture audit (NOT full authenticated tenant coverage)',
  generatedAt:new Date().toISOString(),browser:'Chromium / Playwright',zoomPercent:100,
  declaredWorkspaces,setupCoverage,applications:[...new Set(screens.map(s=>s.app))],
  tenantPagesAudited:false,metadataPublishedPagesAudited:false,
  counts,results
};
await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
const md=[
  '# MetaDrive UI visual audit — 100% browser zoom',
  '',
  'Source-backed React fixture screenshots, not authenticated tenant or published Page Runtime verification.',
  'Browser: Chromium, deviceScaleFactor 1, visual viewport zoom 100%.',
  '',
  '- Unique screen states: '+counts.screens,
  '- Viewports: '+sizes.map(x=>x.name+' '+x.width+'×'+x.height).join(', '),
  '- Screenshots: '+counts.captures,
  '- Rendered without automated findings: '+counts.rendered,
  '- Requires visual/code review: '+counts.review,
  '- Declared Setup workspace IDs: '+declaredWorkspaces.length,
  '- Setup navigation destinations: '+setupCoverage.length,
  '- Setup navigation destinations without a fixture: '+setupCoverage.filter(x=>x.level==='unverified').length,
  '',
  '| Application | Screen | Desktop | Laptop | Phone |',
  '|---|---|---|---|---|'
];
for(const screen of screens){
  const cells=sizes.map(size=>{
    const entry=results.find(r=>r.view===screen.view&&r.viewport===size.name);
    return entry.status==='REVIEW'?'REVIEW':'RENDERED';
  });
  md.push('| '+screen.app+' | '+screen.title+' | '+cells.join(' | ')+' |');
}
md.push('','## Source navigation inventory (screen state coverage)','','| Setup menu destination | Representative fixture | Coverage |','|---|---|---|');
for(const item of setupCoverage)md.push('| '+item.label+' | '+(item.fixture??'—')+' | '+item.level+' |');
md.push('','## Findings');
for(const item of results.filter(x=>x.issues.length)){
  md.push('- '+item.application+' / '+item.screen+' @ '+item.viewport+': '+item.issues.join('; '));
}
md.push('','## Unverified coverage','- Authenticated tenant navigation, real SQL metadata, installed/licensed applications and tenant-specific published pages.','- Page Builder and other editable drafts in all Desktop, Tablet, Mobile and Custom variants.','- Every route, modal state, record CRUD state, table density, print view and dark theme.','- Screenshots prove rendering, not a human-reviewed visual sign-off.');
await writeFile(join(root,'report.md'),md.join('\n')+'\n');
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,md.join('\n')+'\n',{flag:'a'});
console.log('AUDIT SUMMARY',JSON.stringify(counts));
if(results.length!==screens.length*sizes.length)process.exitCode=1;
// Fail only on missing renders/JS errors; geometry findings are reported for review.
if(results.some(r=>r.issues.some(i=>/^(render:|JavaScript errors:|metrics:|empty rendered content|browser zoom)/.test(i))))process.exitCode=1;
