import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const browser = await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']} : {})});
const page = await browser.newPage({viewport:{width:1365,height:768}});
const errors=[];
const screenshotDir=process.env.PHASE1_SCREENSHOT_DIR;
async function screenshot(name){if(!screenshotDir)return;await mkdir(screenshotDir,{recursive:true});await page.screenshot({path:join(screenshotDir,name+'.png')});}
page.on('pageerror',error=>errors.push(error.message));
const base=process.env.SETUP_UX_BASE_URL || 'http://127.0.0.1:5173';
async function open(view,extra='') { console.log('Checking',view,extra); await page.goto(`${base}/test/setup-ux-fixture.html?view=${view}${extra}`); }
try {
 await open('dashboard');
 assert.equal(await page.getByRole('button',{name:'Create dashboard',exact:true}).last().isDisabled(),true);
 await page.getByRole('status').filter({hasText:'Ask an administrator'}).waitFor();
 await open('dashboard','&allowed=true');
 await page.getByRole('button',{name:'Create dashboard',exact:true}).last().click();
 await page.getByRole('dialog',{name:'Create a dashboard'}).waitFor();
 await page.getByRole('dialog').getByLabel('Dashboard name').fill('Audit dashboard');
 await page.getByRole('dialog').getByRole('button',{name:'Create dashboard',exact:true}).click();
 assert.equal(await page.getByRole('dialog').count(),0);
 await open('offline');
 const save=page.getByRole('button',{name:'Save selections'});
 assert.equal(await save.isDisabled(),true);
 await page.getByRole('button',{name:'Add object'}).click();
 await page.getByRole('combobox').selectOption('Account');
 await page.getByRole('checkbox',{name:'Acme Corporation'}).check();
 const recordSearch=page.getByRole('searchbox',{name:'Find records'});
 await recordSearch.fill('unavailable');
 await page.getByRole('alert').getByText('Record search is temporarily unavailable.',{exact:false}).waitFor();
 assert.equal(await page.getByText('SQL service unavailable').count(),0,'Never expose SQL errors in offline records');
 assert.equal(await page.getByRole('checkbox',{name:'Acme Corporation'}).count(),1,'Retain previous results during outage');
 await page.getByRole('button',{name:'Retry record search'}).click();
 await recordSearch.fill('');
 await page.getByRole('checkbox',{name:'Acme Corporation'}).waitFor();
 assert.equal(await save.isEnabled(),true);
 await save.click();
 await page.getByRole('status').filter({hasText:'selections saved'}).waitFor();
 assert.equal((await page.evaluate(()=>window.savedSelections)).selections[0].recordIds[0],'00000000-0000-0000-0000-000000000001');
 assert.equal(await page.getByRole('checkbox',{name:'Acme Corporation'}).isChecked(),true,
  'Saved offline selection must remain selected before the next search');
 await open('offline-cap');
 await page.getByText('49 of 100 records selected').waitFor();
 await page.getByRole('checkbox',{name:'Bulk record 50',exact:true}).check();
 await page.getByText('50 of 100 records selected').waitFor();
 assert.equal(await page.getByRole('checkbox',{name:'Bulk record 51',exact:true}).isDisabled(),true,
  'Offline briefcase must stop at 50 records per object');
 assert.equal(await page.getByRole('button',{name:'Save selections'}).isEnabled(),true,
  '50 records per object must remain valid for saving');
 await page.getByRole('checkbox',{name:'Bulk record 50',exact:true}).uncheck();
 await page.getByText('49 of 100 records selected').waitFor();
 assert.equal(await page.getByRole('checkbox',{name:'Bulk record 51',exact:true}).isEnabled(),true,
  'Removing one selection restores capacity');
 await open('offline-load-error');
 await page.getByRole('alert').getByText('Offline briefcase service is temporarily unavailable. Please retry.').waitFor();
 assert.equal(await page.getByText('SQL relation md_tenant_settings',{exact:false}).count(),0,
  'Offline load failures must not leak database internals');
 assert.equal(await page.getByRole('button',{name:'Add object'}).count(),0,
  'Failed offline reads must not expose a blank editable draft');
 assert.equal(await page.getByRole('button',{name:'Refresh'}).isEnabled(),true,
  'Failed offline reads must allow retry');
 await open('offline-save-error');
 await page.getByRole('button',{name:'Add object'}).click();
 await page.getByRole('combobox').selectOption('Account');
 await page.getByRole('checkbox',{name:'Acme Corporation'}).check();
 await page.getByRole('button',{name:'Save selections'}).click();
 await page.getByRole('alert').getByText('Offline briefcase service is temporarily unavailable. Please retry.').waitFor();
 assert.equal(await page.getByText('SQL service unavailable',{exact:false}).count(),0,
  'Offline save failures must not leak database internals');
 await open('tenants');
 await page.getByRole('button',{name:'New tenant',exact:true}).click();
 const tenantForm=page.getByRole('form',{name:'New tenant draft'});
 await tenantForm.waitFor();
 assert.equal(await page.getByRole('region',{name:'Tenants',exact:true}).count(),0);
 const tenantAction=tenantForm.getByRole('button',{name:'Create tenant',exact:true});
 const actionVisible=await tenantAction.evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<=window.innerHeight && r.top>=0;});
 assert.equal(actionVisible,true,'Create tenant footer must be visible without scrolling the directory');
 await tenantForm.getByRole('button',{name:'Discard',exact:true}).click();
 assert.equal(await page.getByRole('form',{name:'New tenant draft'}).count(),0);
 await open('credentials');
 const table=page.locator('.md-mobile-table-replaced table');
 assert.equal(await table.locator('th').count(),5);
 const fits=await table.evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth);
 assert.equal(fits,true,'Credential status/actions must fit the desktop viewport');
 if(process.env.SETUP_UX_SCREENSHOT) await page.screenshot({path:process.env.SETUP_UX_SCREENSHOT});
 await page.getByRole('button',{name:'View Sample credential',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 const credentialDialog=page.locator('.named-credential-modal');
 assert.ok(await credentialDialog.evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth-8), 'Credential dialog must fit desktop viewport');
 assert.equal(await page.locator('.named-credential-form-grid').evaluate(el=>getComputedStyle(el).display),'grid');
 await screenshot('phase2-credential-modal');
 await open('history');
 assert.equal(await page.locator('.flow-logs-table th').count(),7,'Flow history includes the Duration column');
 await page.locator('.flow-logs-table summary').click();
 await page.locator('.flow-logs-table').getByText('run-id-with-a-very-long-identifier',{exact:true}).waitFor();
 await open('flows');
 assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByRole('button',{name:'New Flow',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Screen Flow'}).click();
 await page.getByLabel('Flow Name',{exact:true}).fill('Audit flow');
 await page.getByRole('button',{name:'Create Flow',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.createdFlow),{label:'Audit flow',type:'Screen Flow'});
 assert.equal(await page.getByRole('dialog').count(),0);
 await open('records-import');
 await page.getByText('Record workspace import passed',{exact:true}).waitFor();
 await open('mfa');
 await page.getByRole('button',{name:'Save policy'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Save policy'}).evaluate(el=>el.closest('label')===null),true,
  'MFA save button must never be nested inside the policy label');
 assert.equal(await page.locator('.md-admin-form-grid').first().evaluate(el=>getComputedStyle(el).display),'grid');
 await screenshot('mfa-desktop');
 await open('oauth');
 await page.getByRole('heading',{name:'Connected Apps'}).waitFor();
 await page.getByText('operator9@example.com').waitFor();
 const userGrid=page.locator('.connected-apps-checklist');
 assert.equal(await userGrid.evaluate(el=>getComputedStyle(el).display),'grid','OAuth user picker must use grid');
 assert.ok((await userGrid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length))>=2,
  'OAuth user picker must occupy multiple columns at desktop width');
 await page.locator('.oauth-scope-group summary').click();
 assert.equal(await page.locator('.oauth-scope-group-body').evaluate(el=>getComputedStyle(el).display),'grid');
 await screenshot('oauth-desktop');
 await open('governance');
 const auditRegion=page.getByRole('region',{name:'Setup audit events'});
 await auditRegion.waitFor();
 assert.equal(await auditRegion.locator('th').count(),6);
 assert.equal(await auditRegion.locator('[data-long-id]').count(),1);
 assert.ok((await auditRegion.locator('table').evaluate(el=>el.getBoundingClientRect().width))>=940);
 await screenshot('governance-desktop');
 await open('company');
 assert.equal(await page.getByRole('button',{name:'Security & Recovery'}).getAttribute('aria-current'),'page',
  'Deep-linked company security settings must open directly');
 await screenshot('company-security-deeplink');
 await page.setViewportSize({width:390,height:844});
 await open('company');
 await page.getByRole('button',{name:'Company Settings',exact:true}).click();
 await page.getByRole('navigation',{name:'Company settings sections'}).last().getByRole('button',{name:'Branding'}).click();
 assert.equal(await page.locator('.company-workspace-section-branding').count(),1,
  'Mobile Company Settings drill-down must display Branding');
 await page.getByRole('button',{name:'Company Settings',exact:true}).click();
 await page.getByRole('navigation',{name:'Company settings sections'}).last().getByRole('button',{name:'Contacts'}).click();
 assert.equal(await page.locator('.company-workspace-section-contacts').count(),1,
  'Mobile Company Settings drill-down must display Contacts');
 await page.setViewportSize({width:1365,height:768});
 await open('company-profile-fail');
 await page.getByText('Company data could not be loaded.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Edit logo'}).count(),0,'Failed company read must never expose blank-default editing');
 await page.getByRole('button',{name:'Retry loading company details'}).waitFor();
 await open('monitoring');
 await page.getByRole('tab',{name:'Monitoring'}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'Monitoring'}).getAttribute('aria-selected'),'true');
 await page.getByText('180 requests',{exact:false}).waitFor();
 assert.equal(await page.locator('.md-admin-settings-block .md-admin-form-grid').first().evaluate(el=>getComputedStyle(el).display),'grid');
 assert.equal(await page.getByRole('button',{name:'Save rule'}).isDisabled(),true,'Blank transaction rule must not be saved');
 const requestFilter=page.getByRole('searchbox',{name:'Filter loaded requests'});
 await requestFilter.fill('reports');
 await page.getByText('1 matching of 3 loaded requests').waitFor();
 await page.getByRole('combobox',{name:'Monitoring event status'}).selectOption('errors');
 await page.getByRole('cell',{name:'/api/reports',exact:false}).waitFor();
 await page.getByRole('combobox',{name:'Monitoring event status'}).selectOption('all');
 await requestFilter.fill('');
 await page.getByText('3 matching of 3 loaded requests').waitFor();
 await screenshot('phase2-monitoring');
 await open('licenses');
 const licencesTab=page.getByRole('tab',{name:'Licences'});
 await licencesTab.waitFor();
 await licencesTab.click();
 await page.getByRole('heading',{name:'User and permission-set licences'}).waitFor();
 const licenceUserSelect=page.locator('.md-admin-licence-assignments select').first();
 try { await licenceUserSelect.waitFor({timeout:10000}); }
 catch(error) { console.log('Licence panel:',(await page.locator('.md-admin-tabpanel').innerText()).slice(0,800)); console.log('Browser errors:',errors); throw error; }
 await licenceUserSelect.selectOption('user-1');
 const licenceGrid=page.locator('.md-admin-licence-assignments .md-admin-checkbox-grid').first();
 await licenceGrid.waitFor();
 assert.ok(await licenceGrid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)>=2,'Licence assignments must use columns at desktop width');
 await screenshot('phase2-licenses');
 await open('federation');
 await page.getByRole('button',{name:'Add identity provider'}).click();
 assert.equal(await page.locator('.md-admin-settings-block>.md-admin-form-grid').first().evaluate(el=>getComputedStyle(el).display),'grid');
 await screenshot('phase2-federation');
 await open('password');
 await page.getByRole('button',{name:'Edit Minimum password length'}).click();
 await page.locator('.md-admin-password-grid').waitFor();
 await page.getByRole('checkbox',{name:'Require uppercase letter'}).check();
 await screenshot('phase2-password');
 await open('sessions');
 await page.getByRole('button',{name:'Edit restrictions'}).click();
 await page.getByRole('button',{name:'Add IP range'}).click();
 assert.equal(await page.locator('.md-admin-restriction-grid').count(),1);
 await screenshot('phase2-session-ranges');
 await page.setViewportSize({width:390,height:844});
 await open('oauth');
 await page.getByText('operator9@example.com').waitFor();
 assert.equal(await page.locator('.connected-apps-checklist').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length),1,
  'OAuth user picker must reduce to one column on narrow screens');
 await screenshot('oauth-mobile');
 await open('password');
 await page.getByRole('button',{name:'Edit Minimum password length'}).click();
 assert.equal(await page.locator('.md-admin-password-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1,'Password editing must collapse to one column on mobile');
 await screenshot('phase2-password-mobile');
 await page.setViewportSize({width:1365,height:768});
 await open('schema');
 const schemaViewport=page.getByRole('region',{name:'Scrollable object relationship diagram'});
 await schemaViewport.waitFor();
 assert.equal(await schemaViewport.getAttribute('tabindex'),'0');
 await page.getByRole('button',{name:'Zoom in schema'}).click();
 await screenshot('phase3-schema-desktop');
 await page.setViewportSize({width:390,height:844});
 await open('schema');
 assert.equal(await page.locator('.md-schema-relation-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1,
   'Schema relationship editor must collapse to one column on mobile');
 await screenshot('phase3-schema-mobile');
 await page.setViewportSize({width:1365,height:768});
 await open('oauth-directory');
 await page.getByRole('button',{name:/Payroll connector/}).waitFor();
 await page.getByRole('button',{name:'New connected app'}).click();
 assert.equal(await page.getByRole('button',{name:'Save connected app'}).isDisabled(),true,
  'Creating a connected app with no name/redirect must not enable Save');
 await page.getByRole('button',{name:'Cancel / Discard'}).click();
 await page.getByLabel('Find connected app').fill('unmatched');
 await page.getByText('No matching applications.').waitFor();
 await page.getByLabel('Find connected app').fill('payroll');
 await page.getByRole('button',{name:/Payroll connector/}).click();
 await page.getByLabel('Find user').fill('operator9');
 assert.equal(await page.locator('.connected-apps-checklist input[type=checkbox]').count(),1);
 await page.getByLabel('Find user').fill('');
 const appName=page.getByLabel('Name (required)',{exact:true});
  assert.equal(await appName.getAttribute('required')!==null,true,'Connected app name must be explicitly required');
  await appName.fill('Payroll connector updated');
 page.once('dialog',async dialog=>{assert.match(dialog.message(),/consents will be revoked/);await dialog.accept();});
 await page.getByRole('button',{name:'Save connected app'}).click();
 await page.getByText('Saved',{exact:true}).waitFor();
 await screenshot('audit-verified-oauth-directory');
 await open('security-history');
 await page.getByRole('region',{name:'Login security history'}).waitFor();
 await page.getByRole('button',{name:'Next'}).click();
 await page.getByText('Page 2').waitFor();
 assert.match(await page.evaluate(()=>window.securityEventQuery),/offset=25/);
 await page.getByLabel('Event action').fill('login');
 await page.getByRole('button',{name:'Apply filters'}).click();
 assert.match(await page.evaluate(()=>window.securityEventQuery),/action=login/);
 await screenshot('audit-verified-security-history');
 await page.setViewportSize({width:390,height:844});
 await open('security-history');
 await page.getByRole('button',{name:'Next'}).click();
 assert.match(await page.evaluate(()=>window.securityEventQuery),/limit=10&offset=10/,'Phone security event paging must fetch ten at a time');
 await open('governance');
 await page.getByRole('tab',{name:'Audit Trail'}).click();
 const mobileAudit=page.getByRole('region',{name:'Setup audit events'});
 await mobileAudit.waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile audit must not overflow the viewport');
 await screenshot('audit-verified-mobile-audit-cards');
 assert.equal(await page.getByRole('button',{name:'Next 10'}).count(),1,
  'Phone setup audit must use 10-event pages');
 await page.getByRole('tab',{name:'Monitoring'}).click();
 assert.equal(await page.getByRole('button',{name:'Next 10'}).count(),1,
  'Phone monitoring must use 10-event pages');
 await page.setViewportSize({width:1365,height:768});
 await open('image-render-stability');
 await page.getByRole('img',{name:'UI image stable'}).waitFor();
 await page.locator('[aria-label="Smart Image stability"] img').waitFor();
 await page.waitForFunction(()=>window.assetFetchCount===2);
 const beforeImages=await page.locator('main img').evaluateAll(nodes=>nodes.map(node=>node.src));
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'Rerender parent'}).click();
 await page.getByLabel('Parent render count').getByText('5').waitFor();
 await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>window.assetFetchCount),2,
   'Stable image sources must not refetch when the parent supplies a new loader callback');
 assert.deepEqual(await page.locator('main img').evaluateAll(nodes=>nodes.map(node=>node.src)),beforeImages,
   'UI and Smart images must never flash blank on ordinary builder renders');
 await screenshot('builder-stable-image-source');
 await open('floating-canvas-actions');
 const actions=page.getByRole('toolbar',{name:'Selected canvas tools'});
 await actions.waitFor();
 const toolbarOnTop=await actions.getByRole('button',{name:'Edit selected item'}).evaluate(element=>{
   const bounds=element.getBoundingClientRect();
   const top=document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2);
   return element===top||element.contains(top);
 });
 assert.equal(toolbarOnTop,true,'Selection actions must remain hittable above overlapping components');
 assert.equal(await page.locator('[data-component-id="selected-test"]').evaluate(el=>getComputedStyle(el).zIndex),'0',
   'Canvas authoring order must remain untouched while toolbar floats on top');
 await actions.getByRole('button',{name:'Edit selected item'}).click();
 await actions.getByRole('button',{name:'Canvas menu action'}).waitFor();
 await screenshot('builder-floating-actions-layer');
 await open('smart-card-grid-scroll');
 const smartCardGrid=page.getByRole('region',{name:'Product cards'}).first();
 await smartCardGrid.waitFor();
 const smartFrame=page.getByLabel('Selected Smart Card Grid');
 const smartGeometry=await smartCardGrid.evaluate(el=>{
   const cards=[...el.querySelectorAll('article.smart-card')];
   const outer=el.getBoundingClientRect(), first=cards[0].getBoundingClientRect();
   return {totalCards:cards.length,viewportHeight:el.clientHeight,scrollHeight:el.scrollHeight,
     clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,firstCardHeight:first.height,
     firstCardTop:first.top,top:outer.top,bottom:outer.bottom,
     overflowY:getComputedStyle(el).overflowY};
 });
 assert.equal(smartGeometry.totalCards,23,'Card Grid rows must not truncate records');
 assert.ok(smartGeometry.viewportHeight>=360&&smartGeometry.viewportHeight<=395,
   'Smart Card Grid must use the selected component height');
 assert.ok(smartGeometry.firstCardHeight>=170&&smartGeometry.firstCardHeight<=240,
   'Cards per column must size a full card instead of cropping it');
 assert.ok(smartGeometry.scrollHeight>smartGeometry.viewportHeight*2,
   'Additional cards must scroll inside the selected component');
 assert.ok(smartGeometry.scrollWidth<=smartGeometry.clientWidth+1,
   'Smart Card Grid must not overflow horizontally');
 assert.equal(smartGeometry.overflowY,'auto');
 assert.equal(await smartFrame.locator('article.smart-card').count(),23);
 await smartCardGrid.hover();
 await page.mouse.wheel(0,500);
 await page.waitForFunction(()=>document.querySelector('.smart-grid')?.scrollTop>0);
 await smartCardGrid.focus();
 const beforeKeyboard=await smartCardGrid.evaluate(el=>el.scrollTop);
 await page.keyboard.press('End');
 await page.waitForFunction(before=>{
   const grid=document.querySelector('.smart-grid');
   return grid&&grid.scrollTop>before+20;
 },beforeKeyboard,{timeout:3000});
 await page.keyboard.press('Home');
 await page.waitForFunction(()=>{
   const grid=document.querySelector('.smart-grid');
   return grid&&grid.scrollTop===0;
 },undefined,{timeout:3000});
 const preview=page.getByLabel('Empty Smart Card Grid preview');
 assert.equal(await preview.locator('article.smart-card').count(),3);
 assert.equal(await preview.getByText('Image Here').count(),3);
 assert.equal(await preview.getByText('Text here').count(),3);
 await screenshot('smart-card-grid-height-rows-desktop');
 await page.setViewportSize({width:390,height:844});
 await open('smart-card-grid-scroll');
 const mobileSmartGrid=page.getByRole('region',{name:'Product cards'}).first();
 await mobileSmartGrid.waitFor();
 assert.ok(await mobileSmartGrid.evaluate(el=>el.scrollHeight>el.clientHeight),
   'Smart Card Grid should remain scrollable on mobile');
 const mobileOverflow=await mobileSmartGrid.evaluate(el=>({
   contentWidth:el.scrollWidth,viewportWidth:el.clientWidth,
   viewportRight:el.getBoundingClientRect().right,
   pageWidth:document.documentElement.clientWidth,
   overflowX:getComputedStyle(el).overflowX
 }));
 assert.equal(mobileOverflow.overflowX,'auto',
   'Smart Card Grid must own its horizontal scrolling');
 assert.ok(mobileOverflow.contentWidth>mobileOverflow.viewportWidth+1,
   'Three min-width columns must scroll horizontally inside a narrow mobile viewport');
 assert.ok(mobileOverflow.viewportRight<=mobileOverflow.pageWidth+1,
   'The overflowing Card Grid must stay clipped inside the mobile page');
 await mobileSmartGrid.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
 assert.ok(await mobileSmartGrid.evaluate(el=>el.scrollLeft>0),
   'Offscreen columns must remain reachable by horizontal scrolling');
 await screenshot('smart-card-grid-height-rows-mobile');
 await page.setViewportSize({width:1365,height:768});
 assert.deepEqual(errors,[]);
 console.log('PASS: dashboard permission/create, offline object/record/save, tenant draft/footer/discard, credential width/details, history details, flow dialog/create, record route chunk import, MFA policy control, OAuth grids, audit table, deep-linked company settings, monitoring, licences, SSO, password, sessions, credential modal, and real Schema Builder (1365px/390px)');
} finally { await browser.close(); }
