import {checkFormulaTooltipPlacement} from './formula-overlay-browser-check.mjs';
import assert from 'node:assert/strict';

/** Real PostgreSQL + compiled Page Builder browser contract.
 * Uses only disposable CI tenant data from builder-browser-smoke.mjs.
 */
export async function runDesign2BrowserCheck({page,origin,db,tenantId,token}){
 // The one-version Core baseline already contains the final Design 2 matrix.
 // Test the resulting SQL state directly instead of replaying retired migrations.
 const fourRows=await db.query(`SELECT r.component_api,r.area,r.slot_key,r.property_key,
        COALESCE(component.enabled,false) enabled
   FROM md_builder_design2_slot_rules r
   JOIN md_builder_ribbon_component_rules component
     ON component.component_api=r.component_api AND component.property_key=r.property_key
   WHERE (r.component_api,r.area,r.slot_key) IN (
     ('smart_calendar','Focused','fill'),
     ('smart_card_grid','Body','wrap'),
     ('smart_navigation','Image','imageFill'),
     ('smart_toggle','Body','shape'))`);
 for(const [api,area,slot,key] of [
   ['smart_calendar','Focused','fill','defaultValueColor'],
   ['smart_card_grid','Body','wrap','wrapText'],
   ['smart_navigation','Image','imageFill','imageFill'],
   ['smart_toggle','Body','shape','shapeId']
 ]){
   const found=fourRows.rows.find(row=>row.component_api===api&&row.area===area&&row.slot_key===slot);
   assert.equal(found?.property_key,key,api+' must edit the existing renderer property');
   assert.equal(found?.enabled,true,api+' must be enabled in the shared ribbon');
 }
 const actualTargets=await db.query(`SELECT component_api,area,slot_key,property_key
   FROM md_builder_design2_slot_rules
   WHERE (component_api='smart_tabs' AND area='Body' AND slot_key='fill')
      OR (component_api='smart_textbox' AND area='Body' AND slot_key='wrap')
      OR (component_api='smart_textbox' AND area='Header Supporting' AND slot_key='alignment')
      OR (component_api='smart_icon' AND area='Body' AND slot_key='height')`);
 for(const [component,area,slot,property] of [
   ['smart_tabs','Body','fill','backgroundColor'],
   ['smart_textbox','Body','wrap','wrapText'],
   ['smart_textbox','Header Supporting','alignment','supportingAlignment'],
   ['smart_icon','Body','height','height']
 ])assert.ok(actualTargets.rows.some(row=>row.component_api===component&&row.area===area&&
    row.slot_key===slot&&row.property_key===property),
   'Design 2 semantic target missing: '+component+' '+area+' '+slot);
 const listed=await db.query(`SELECT area,slot_key,property_key,row_no,order_no,width_px,height_px
   FROM md_builder_design2_slots ORDER BY area_order,row_no,order_no`);
 // Shared areas are extensible: retain the legacy baseline and enforce unique SQL slots.
 assert.ok(listed.rows.length>=106,'Design 2 SQL slots missing after replay');
 assert.ok(new Set(listed.rows.map(row=>row.area)).size>=10,'Legacy Design 2 areas missing');
 assert.equal(new Set(listed.rows.map(row=>row.area+'/'+row.slot_key)).size,listed.rows.length,
  'Duplicate Design 2 slot keys after replay');
 assert.equal(new Set(listed.rows.map(row=>row.area+'/'+row.row_no+'/'+row.order_no)).size,listed.rows.length,
  'Duplicate Design 2 ribbon positions after replay');
 const slot=(area,key)=>listed.rows.find(row=>row.area===area&&row.slot_key===key);
 assert.equal(slot('Row','focused'),undefined,'Row Focus was not approved in the table');
 assert.equal(slot('Table','focused')?.row_no,2,'Table Focus must be R2');
 assert.equal(slot('Table','focused')?.order_no,1,'Table Focus must be C1');
 assert.equal(slot('Body','fill')?.row_no,1,'Body Color must be R1');
 assert.equal(slot('Body','fill')?.order_no,1,'Body Color must be C1');
 assert.equal(slot('Body','radius')?.row_no,1,'Body Radius must be R1');
 assert.equal(slot('Body','radius')?.order_no,5,'Body Radius must be C5');
 assert.equal(slot('Body','radius')?.width_px,80,'Body Radius must be 80px');
 assert.equal(slot('Extras','extra_selectionMode')?.property_key,'selectionMode');
 assert.equal(slot('Extras','extra_cardGap')?.property_key,'gap');
 assert.equal(slot('Others','extra_inputRows')?.property_key,'inputRows',
  'Others must have the universal Rows input setting');
 for(const [area,key] of [['Body','calendarView'],['Header','calendarShowHeader'],
   ['Focused','calendarEventColor'],['Others','calendarSlotMinutes'],
   ['Others','showDays'],['Others','firstDay']]){
  assert.equal(slot(area,'extra_calendar'+key)?.property_key,key,
   'Calendar settings must use fixed '+area+' rows: '+key);
 }
 const selectorRule=await db.query(`SELECT component_api,property_key,enabled FROM md_builder_ribbon_component_rules
  WHERE component_api='smart_selector' AND property_key IN
   ('textSource','selectorOptionsFormula','backgroundColor','labelColor','textSize')`);
 assert.equal(selectorRule.rows.length,5,'Smart Selector lacks shared Data/Body properties');
 assert.ok(selectorRule.rows.every(row=>row.enabled===true));
 const calendarRules=await db.query(`SELECT property_key,enabled FROM md_builder_ribbon_component_rules
  WHERE component_api='smart_calendar' AND property_key IN
   ('calendarView','calendarShowHeader','calendarEventColor','calendarSlotMinutes',
    'calendarStartSource','calendarEndSource','calendarTitleSource')`);
 assert.equal(calendarRules.rows.length,7,'Calendar did not register all approved settings');
 assert.ok(calendarRules.rows.every(row=>row.enabled===true));
 assert.equal(slot('Body','extra_tabIndex'),undefined);
 assert.equal(slot('Focused','width')?.row_no,2);
 assert.equal(slot('Image','border')?.property_key,'imageBorderColor');
 assert.equal(slot('Row Supporting','text')?.property_key,'rowSupportingTextColor');
 for(const retired of ['Tabs','Card Grid','Custom Button 1','Custom Button 2','Calendar'])
  assert.equal(listed.rows.some(row=>row.area===retired),false,
    'Retired inspector area remains: '+retired);
 assert.equal(slot('Row','fill')?.property_key,'backgroundColor',
  'Approved Row Body Color must occupy its own fixed slot');
 assert.equal(slot('Body','wrap')?.property_key,'wrapText','Body Wrap must occupy R3C4');
 const rowsSetting=await db.query(`SELECT p.property_key,p.tab,p.section_group,p.default_value,
   p.min_value,p.max_value,r.component_api,r.enabled
   FROM md_builder_shared_properties p
   JOIN md_builder_ribbon_component_rules r ON r.property_key=p.property_key
   WHERE p.property_key='inputRows'`);
 assert.equal(rowsSetting.rows.length,1,'Rows must have exactly one component rule');
 assert.deepEqual(rowsSetting.rows[0],{
  property_key:'inputRows',tab:'Design2',section_group:'Others',default_value:1,
  min_value:1,max_value:12,component_api:'smart_text',enabled:true
 });
 const definitions=await db.query(`SELECT property_key,tab FROM md_builder_shared_properties
   WHERE property_key IN ('backgroundColor','rowBold','summary2Alignment','tableBackgroundColor')`);
 assert.equal(definitions.rows.find(row=>row.property_key==='backgroundColor')?.tab,'Design',
  'Original Design property moved during Design 2 migration');
 assert.equal(definitions.rows.find(row=>row.property_key==='rowBold')?.tab,'Design2');
 console.info('Design 2 SQL migration replay and Focused/Extras mappings verified');
 await db.query(`INSERT INTO md_component_definitions (tenant_id,api_name,renderer_key,enabled)
 VALUES ($1,'smart_cart','smart-bundled:smart_cart',true),
        ($1,'smart_tabs','smart-bundled:smart_tabs',true),
        ($1,'smart_calendar','smart-bundled:smart_calendar',true),
        ($1,'smart_card_grid','smart-bundled:smart_card_grid',true),
        ($1,'smart_navigation','smart-bundled:smart_navigation',true),
        ($1,'smart_toggle','smart-bundled:smart_toggle',true),
        ($1,'smart_button','smart-bundled:smart_button',true),
        ($1,'smart_text','smart-bundled:smart_text',true),
        ($1,'smart_textbox','smart-bundled:smart_textbox',true),
        ($1,'smart_image','smart-bundled:smart_image',true),
        ($1,'smart_lookup','smart-bundled:smart_lookup',true),
        ($1,'smart_selector','smart-bundled:smart_selector',true),
        ($1,'smart_table','smart-bundled:smart_table',true),
        ($1,'smart_label','smart-bundled:smart_label',true),
        ($1,'smart_container','smart-bundled:smart_container',true),
        ($1,'smart_icon','smart-bundled:smart_icon',true)
 ON CONFLICT (tenant_id,api_name) DO NOTHING`,[tenantId]);

 // Import exactly the same standard CSV row that ServiceFlow requires.
 // This catches a renderer-only change that does not register its SQL metadata.
 const {inventoryDefinitions,applyInventoryCsv}=await import('../dist-system/system-support/page-inventory-csv.js');
 const toggleDefinitions=await inventoryDefinitions(db,tenantId,[],'Mobile',['smart_toggle']);
 const toggleCsv='pageapi,component_type,component_name,propertyid,value,layout,ribbon_tab\r\n'+
   'servicetest,smart_toggle,MondayEnabled,defaultValue,true,Mobile,Data\r\n';
 const toggleImport=applyInventoryCsv({
  apiName:'servicetest',layoutMode:'free-canvas',canvasWidth:390,canvasHeight:844,components:[]
 },toggleCsv,toggleDefinitions,'Mobile');
 assert.equal(toggleImport.valid,true,'Smart Toggle defaultValue CSV must validate: '+JSON.stringify(toggleImport.issues));
 assert.equal(toggleImport.page.components[0]?.properties?.defaultValue,'true');
 const toggleRule=await db.query(`SELECT enabled FROM md_builder_ribbon_component_rules
   WHERE component_api='smart_toggle' AND property_key='defaultValue'`);
 assert.equal(toggleRule.rows[0]?.enabled,true,'Smart Toggle must register defaultValue in SQL');

 // The real authenticated Builder Catalog endpoint must expose SQL slots and enforce RBAC.
 // Navigate to the compiled frontend before using browser-relative /api URLs.
 await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async token=>{
  const response=await fetch('/api/metadata/builder-ribbon',{headers:{Authorization:'Bearer '+token}});
  return {status:response.status,body:await response.json()};
 },token);
 assert.equal(result.status,200,'OneEngine rejected authorised shared ribbon metadata');
 assert.equal(result.body.design2Slots?.length,listed.rows.length,'Builder endpoint did not expose Design 2 SQL metadata');
 const rowsCatalog=result.body.properties.find(property=>property.id==='inputRows');
 assert.equal(rowsCatalog?.group,'Others');
 assert.deepEqual(rowsCatalog?.components,['smart_text'],
  'Rows must be enabled only for smart_text');
 assert.ok(result.body.properties.find(p=>p.id==='defaultValue')?.components.includes('smart_toggle'),
  'CSV toggle defaultValue must be enabled in the live Builder catalog');
 assert.ok(result.body.components.includes('smart_selector'));
 assert.deepEqual(result.body.properties.find(property=>property.id==='selectorOptionsFormula')?.components,
  ['smart_selector'],'Selector options formula must be an authorised Data property');
 // The catalog is SQL-backed but still protected by central OneEngine RBAC.
 const {AuthenticationService}=await import('../dist-system/system-files/authentication.js');
 const auth=new AuthenticationService(db);
 const guestHash=await auth.hashPassword('Design2LeastPrivilege!2026');
 const guest=await db.query(`INSERT INTO md_users(tenant_id,email,password_hash)
   VALUES($1,$2,$3) RETURNING id`,[tenantId,'design2-restricted@example.invalid',guestHash]);
 assert.ok(guest.rows[0]?.id);
 const guestToken=(await auth.signIn(tenantId,'design2-restricted@example.invalid',
  'Design2LeastPrivilege!2026')).accessToken;
 const forbidden=await page.evaluate(async token=>(await fetch('/api/metadata/builder-ribbon',{
  headers:{Authorization:'Bearer '+token}
 })).status,guestToken);
 assert.equal(forbidden,403,'Design 2 catalog bypassed OneEngine PageDefinition RBAC');

 // A Card Grid BOUND to an Object with real records must still show its canvas
 // Data Source icons (the bound path renders through Page Runtime's component).
 {
  const boundObject='BrowserRecycle__c';
  const known=await db.query(`SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2`,[tenantId,boundObject]);
  if(known.rowCount){
   const created=await page.evaluate(async({token,name})=>{const out=[];for(const label of ['Desserts','Wraps','Drinks']){
    const r=await fetch('/api/records/'+name,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
     body:JSON.stringify({Name:label})});out.push(r.status);}return out;},{token,name:boundObject});
   assert.deepEqual(created,[201,201,201],'Cannot seed bound Card Grid records');
   const boundPage={apiName:'browserboundgrid',label:'Bound Grid Icons',targetObject:'',pageType:'App Page',
    layoutMode:'free-canvas',canvasWidth:1280,canvasHeight:900,status:'Draft',devices:['Desktop'],
    activationAssignments:[],components:[{id:'bound-grid',type:'Custom:smart_card_grid',label:'Bound grid',
     region:'main',visible:true,properties:{objectApiName:boundObject,textSource:'@Name'},
     position:{x:20,y:20,width:900,height:300}}]};
   const saved=await page.evaluate(async({token,payload})=>(await fetch('/api/metadata/pages/'+payload.apiName,{method:'PUT',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,
    {token,payload:boundPage});
   assert.equal(saved,200,'Cannot seed bound Card Grid page');
   await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
   await page.getByLabel('Search pages').fill('Bound Grid Icons');
   await page.getByRole('button',{name:'Design Bound Grid Icons',exact:true}).click();
   await page.getByRole('tab',{name:'Design',exact:true}).waitFor({timeout:20000});
   const grid=page.locator('[data-component-id="bound-grid"]').first();
   await grid.getByText('Desserts').first().waitFor({state:'visible',timeout:20000});
   await grid.click({position:{x:6,y:6}});
   // Dense components use the grouped picker rather than forcing a floating icon.
   // Both entry points must open the same Data formula editor.
   const directTitle=grid.locator('.canvas-data-icon-button[data-binding-property="textSource"]').first();
   if(await directTitle.isVisible()){
    await directTitle.click();
   }else{
    const overflowPicker=page.locator('.canvas-data-overflow-trigger');
    await overflowPicker.waitFor({state:'visible',timeout:10000});
    await overflowPicker.click();
    const fieldMenu=page.getByRole('dialog',{name:'Choose component data field'});
    await fieldMenu.getByRole('searchbox',{name:'Search data fields'}).fill('textSource');
    const titleChoice=fieldMenu.locator('.canvas-data-overflow-choice').first();
    await titleChoice.waitFor({state:'visible',timeout:10000});
    assert.match(await titleChoice.innerText(),/Product title/,
     'Bound Card Grid picker must identify the Product title binding');
    assert.match(await titleChoice.innerText(),/@Name/,
     'Bound Card Grid picker must show the configured source');
    await titleChoice.click();
   }
   assert.match(await page.locator('.smart-data-active-binding').first().innerText(),/Product title/,
    'Choosing a bound field must activate its Data formula editor');
   const {mkdir}=await import('node:fs/promises');
   await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
   await page.screenshot({path:new URL('../artifacts/bound-card-grid-data-icons.png',import.meta.url).pathname});
  }
 }

 // A tiny text field must retain Data editing, and a compact Cart must expose
 // every metadata-approved formula binding without growing either component.
 {
  const compactPage={apiName:'browsercompactdatabindings',label:'Compact Data Binding Icons',
   targetObject:'',pageType:'App Page',layoutMode:'free-canvas',
   canvasWidth:1280,canvasHeight:900,status:'Draft',devices:['Desktop'],
   activationAssignments:[],components:[
    {id:'compact-data-text',type:'Custom:smart_text',label:'Tiny formula field',
     region:'main',visible:true,properties:{textSource:'=IF(TRUE, "Ready", "Fallback")'},
     position:{x:30,y:30,width:150,height:18}},
    {id:'compact-data-cart',type:'Custom:smart_cart',label:'Compact formula cart',
     region:'main',visible:true,properties:{label:'Compact Cart',totalValue:'=SUM(3,4)'},
     position:{x:30,y:110,width:180,height:110}},
    {id:'compact-multiline-text',type:'Custom:smart_text',label:'Multiline notes',
     region:'main',visible:true,properties:{placeholder:'Visit notes',inputRows:3},
     position:{x:340,y:30,width:260,height:120}}
   ]};
  const saved=await page.evaluate(async({token,payload})=>(await fetch('/api/metadata/pages/'+payload.apiName,{
   method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  })).status,{token,payload:compactPage});
  assert.equal(saved,200,'Cannot save compact Data binding smoke page');
  await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Search pages').fill('Compact Data Binding Icons');
  await page.getByRole('button',{name:'Design Compact Data Binding Icons',exact:true}).click();
  await page.getByRole('tab',{name:'Design',exact:true}).waitFor({timeout:20000});
  const tiny=page.locator('[data-component-id="compact-data-text"]').first();
  await tiny.waitFor({state:'visible'});
  await tiny.click({position:{x:8,y:8}});
  const picker=page.locator('.canvas-data-overflow-trigger');
  await picker.waitFor({state:'visible',timeout:10000});
  assert.ok((await picker.boundingBox())?.height>=24,
   'Tiny text field lost its clickable Data control');
  await picker.click();
  const menu=page.getByRole('dialog',{name:'Choose component data field'});
  await menu.getByRole('searchbox',{name:'Search data fields'}).fill('textSource');
  assert.ok(await menu.locator('.canvas-data-overflow-choice').count()>0,
   'Tiny text field cannot select its formula binding');
  await menu.locator('.canvas-data-overflow-choice').first().click();
  const multilineText=page.locator('[data-component-id="compact-multiline-text"]').first();
  const textarea=multilineText.locator('textarea.smart-input-box');
  await textarea.waitFor({state:'visible'});
  assert.equal(await textarea.getAttribute('rows'),'3',
   'smart_text Rows=3 must render a multiline textarea');
  await multilineText.click({position:{x:8,y:8}});
  const others=page.locator('.smart-design2-area-section[data-design-area="Others"]');
  const othersToggle=others.locator(':scope > button.smart-inspector-section-toggle');
  if(await othersToggle.getAttribute('aria-expanded')!=='true')await othersToggle.click();
  const rowsInput=others.locator('[data-property="inputRows"] input[type="number"]');
  assert.equal(await rowsInput.isEnabled(),true,
   'Rows must be enabled when smart_text is selected');
  const cart=page.locator('[data-component-id="compact-data-cart"]').first();
  await cart.click({position:{x:8,y:8}});
  if(await othersToggle.getAttribute('aria-expanded')!=='true')await othersToggle.click();
  assert.equal(await rowsInput.isDisabled(),true,
   'Rows must remain visible but disabled for other selected components');
  await picker.waitFor({state:'visible',timeout:10000});
  await picker.click();
  const cartMenu=page.getByRole('dialog',{name:'Choose component data field'});
  const totalChoice=cartMenu.locator('.canvas-data-overflow-choice').filter({hasText:/^Total amount/}).first();
  assert.equal(await totalChoice.count(),1,
   'Cart total binding should be identifiable as Total amount, not Summary 2');
  assert.match(await totalChoice.locator('small').innerText(),/=SUM\(3,4\)/,
   'Grouped data picker should preview the current binding formula');
  await cartMenu.getByRole('searchbox',{name:'Search data fields'}).fill('totalValue');
  assert.ok(await cartMenu.locator('.canvas-data-overflow-choice').count()>0,
   'Compact Cart hides its Total formula binding');
  await cartMenu.locator('.canvas-data-overflow-choice').first().click();
  assert.equal(await picker.getAttribute('aria-expanded'),'false',
   'Data menu must close after choosing a binding');
  console.info('Compact text and Cart Data formula picker browser checks passed');
 }


 // Actual SQL-backed selector and Calendar on the published Page Builder canvas.
 // Formula options must resolve through the existing typed Collection source,
 // and the fixed calendar controls never disappear on component selection.
 {
  const schedulePage={apiName:'browsersmartselectorcalendar',label:'Selector Calendar Browser',
   targetObject:'',pageType:'App Page',layoutMode:'free-canvas',
   canvasWidth:1280,canvasHeight:900,status:'Draft',devices:['Desktop'],
   activationAssignments:[],components:[
    {id:'browser-selector',type:'Custom:smart_selector',label:'Discount type',
     region:'main',visible:true,properties:{
      label:'Discount',selectorOptionsFormula:'=COLLECTION("DiscountOptions", "%", "Fixed")'},
     position:{x:25,y:25,width:250,height:50}},
    {id:'browser-calendar',type:'Custom:smart_calendar',label:'Appointment calendar',
     region:'main',visible:true,properties:{selectedDate:'2026-11-02',
      calendarView:'week',calendarStartHour:9,calendarEndHour:11,calendarSlotMinutes:'30'},
     position:{x:320,y:25,width:800,height:560}},
    {id:'browser-non-calendar',type:'Custom:smart_button',label:'Other component',
     region:'main',visible:true,properties:{label:'Other'},
     position:{x:25,y:160,width:200,height:48}}
   ]};
  const saved=await page.evaluate(async({token,payload})=>{
   const response=await fetch('/api/metadata/pages/'+payload.apiName,{
    method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(payload)});
   return {status:response.status,body:await response.json().catch(()=>null)};
  },{token,payload:schedulePage});
  assert.equal(saved.status,200,'Cannot save selector/calendar browser page: '+JSON.stringify(saved.body));
  await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Search pages').fill('Selector Calendar Browser');
  await page.getByRole('button',{name:'Design Selector Calendar Browser',exact:true}).click();
  await page.getByRole('tab',{name:'Design',exact:true}).waitFor({timeout:20000});
  const selector=page.locator('[data-component-id="browser-selector"]').first();
  const select=selector.locator('select.smart-selector-control');
  await select.waitFor({state:'visible'});
  await select.locator('option').nth(1).waitFor({state:'attached',timeout:20000});
  assert.deepEqual(await select.locator('option').allTextContents(),['%','Fixed']);
  assert.equal(await select.inputValue(),'0','Smart Selector must default to index 0');
  await select.selectOption('1');
  assert.equal(await select.inputValue(),'1','Selector did not retain selected value');
  const calendar=page.locator('[data-component-id="browser-calendar"]').first();
  await calendar.locator('.smart-calendar-week').waitFor({state:'visible'});
  assert.ok(await calendar.locator('.smart-calendar-schedule').count(),
   'Week view did not render hourly schedule grid');
  assert.equal(await calendar.locator('.smart-calendar-slot').count(),4*7,
   '09:00–11:00 in 30-minute slots must show four slots per weekday');
  const openArea=async name=>{
   const section=page.locator('.smart-design2-area-section[data-design-area="'+name+'"]');
   const button=section.locator('button.smart-inspector-section-toggle').first();
   if(await button.getAttribute('aria-expanded')!=='true')await button.click();
   return section;
  };
  await calendar.click({position:{x:15,y:15}});
  const body=await openArea('Body');
  assert.equal(await body.locator('[data-property="calendarView"] select').isEnabled(),true);
  const header=await openArea('Header');
  assert.equal(await header.locator('[data-property="calendarShowHeader"] input[type="checkbox"]').isEnabled(),true);
  const focus=await openArea('Focused');
  assert.equal(await focus.locator('[data-property="calendarEventColor"]').count(),1);
  const others=await openArea('Others');
  assert.equal(await others.locator('[data-property="calendarSlotMinutes"] select').isEnabled(),true);
  assert.equal(await others.locator('[data-property="firstDay"] select').isEnabled(),true);
  await selector.click({position:{x:10,y:10}});
  const disabledBody=await openArea('Body');
  assert.equal(await disabledBody.locator('[data-property="calendarView"] select').isDisabled(),true,
   'Calendar View should stay visible but disabled for selector');
  const disabledOthers=await openArea('Others');
  assert.equal(await disabledOthers.locator('[data-property="calendarSlotMinutes"] select').isDisabled(),true,
   'Calendar slots should stay visible but disabled for selector');
  console.info('Smart Selector Collection options/default and fixed Calendar sections passed');
 }

 // A persisted page with two real smart components, not mocked React widgets.
 const pageName='browserdesign2';
 const payload={
  apiName:pageName,label:'Design 2 Browser',targetObject:'',
  pageType:'App Page',layoutMode:'free-canvas',canvasWidth:1280,canvasHeight:900,
  status:'Draft',devices:['Desktop'],activationAssignments:[],
  components:[
   {id:'browser-design2-cart',type:'Custom:smart_cart',label:'E2E Cart',
    region:'main',visible:true,properties:{label:'E2E Cart',backgroundColor:'#ffffff',
     tableBackgroundColor:'#ffffff',rowBold:false,summaryTextWeight:false},
    position:{x:24,y:28,width:460,height:540}},
   {id:'browser-design2-tabs',type:'Custom:smart_tabs',label:'E2E Tabs',
    region:'main',visible:true,properties:{label:'E2E Tabs',tabCount:2,
     tabColor:'#ffffff',selectedTabColor:'#eaf2ff'},
    position:{x:530,y:28,width:510,height:90}}
  ]
 };
 const created=await page.evaluate(async({token,payload})=>{
  const response=await fetch('/api/metadata/pages/'+payload.apiName,{
   method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  });
  return {status:response.status,body:await response.json().catch(()=>null)};
 },{token,payload});
 assert.equal(created.status,200,'Cannot seed Design 2 E2E page: '+JSON.stringify(created.body));

 await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Search pages').fill('Design 2 Browser');
 await page.getByRole('button',{name:'Design Design 2 Browser',exact:true}).click();
 await page.getByRole('tab',{name:'Design',exact:true}).waitFor({timeout:20000});

 // Select a real cart canvas component. The selected component is the editing target.
 const cart=page.locator('[data-component-id="browser-design2-cart"]').first();
 await cart.waitFor({state:'visible'});
 await cart.click({position:{x:18,y:18}});
 // Ctrl+A is a canvas selection command, never browser text selection or a
 // metadata edit. Verify the real editor selects both existing page blocks.
 await page.keyboard.press('Control+a');
 assert.equal(await page.locator('.record-component.multi-selected').count(),2,
  'Ctrl+A should select both components on the active page');
 await cart.click({position:{x:18,y:18}});
 assert.equal(await page.locator('.record-component.multi-selected').count(),1,
  'A normal click should restore single-component selection after Ctrl+A');
 await page.getByRole('tab',{name:'Design',exact:true}).click();
 const design2=page.locator('.smart-design2-ribbon');
 await design2.waitFor({state:'visible'});
 const areaButtons=()=>page.locator('.smart-design2-area-section > .smart-inspector-section-toggle');
 const chooseArea=async(name)=>{
  const button=page.locator('.smart-design2-area-section[data-design-area="'+name+'"]')
   .locator('button.smart-inspector-section-toggle').first();
  if(await button.getAttribute('aria-expanded')!=='true')await button.click();
 };
 assert.equal(await page.locator('.smart-design2-area-section[data-design-area="Body"] > button')
  .getAttribute('aria-expanded'),'true');
 // The SQL catalog orders the consolidated sections for every component.
 const allAreas=(await areaButtons().allTextContents()).map(value=>value.trim());
 assert.deepEqual(allAreas,['Body','Badge','Image','Header','Header Supporting',
  'Table','Row','Focused','Extras','Row Supporting','Summary','Summary 2','Footer',
  'Button','Button 2','Button 3','Button 4','Button 5','Others']);
 assert.equal(new Set(allAreas).size,allAreas.length,
  'Every metadata area must appear exactly once in the collapsible inspector');
 // FIXED TEMPLATE CONTRACT: The actual on-screen 17 control icons must
 // occupy exactly the same R/C cells with identical dimensions and relative
 // pixel locations in EVERY dropdown. Only enabled/disabled may change.
 const design2GridFingerprint=()=>page.locator('.smart-design2-group .smart-design2-area-section .smart-ribbon-items > .smart-ribbon-row > .smart-property')
  .evaluateAll(elements=>elements.map(element=>{
   const row=element.closest('.smart-ribbon-row');
   const box=element.getBoundingClientRect();
   const rowBox=row.getBoundingClientRect();
   return {
    row:Number(row.dataset.designRow),
    column:Number(element.dataset.designColumn),
    slot:element.dataset.designSlot,
    width:Math.round(box.width),
    height:Math.round(box.height),
    x:Math.round(box.x-rowBox.x),
    visible:getComputedStyle(element).display!=='none',
    hasEditor:!!element.querySelector('button,select,input')
   };
  }).sort((a,b)=>a.row-b.row||a.column-b.column));
 const template=await design2GridFingerprint();
 assert.equal(template.length,16,'The compact Design scaffold has 16 fixed controls; Focus is separate');
 // Count and Padding occupy fixed Extras cells; component applicability still
 // controls their enabled/disabled states, not their position or existence.
 await chooseArea('Extras');
 const countBox=page.locator('.smart-design2-count');
 const countInput=countBox.locator('input.smart-office-number');
 const paddingBox=page.locator('.smart-design2-padding');
 assert.equal(await countBox.count(),1,'Extras always mounts Count');
 assert.equal(await paddingBox.count(),1,'Extras always mounts Padding');
 assert.equal(await countBox.locator('.smart-design2-count-choice').count(),1,
  'Count dropdown and value stay together');
 assert.equal(await countBox.locator('.smart-design2-count-field svg').count(),0,
  'Count must not reintroduce the retired hand icon');
 assert.equal(await countInput.getAttribute('type'),'number');
 assert.equal(await countInput.getAttribute('step'),'1');
 assert.equal(await page.locator('.smart-design2-extras-fixed > .smart-design2-extras-cell').count(),2);
 await chooseArea('Body');

 assert.ok(template.every(item=>item.visible&&item.hasEditor),
  'Every fixed cell must show its real control, even when disabled');
 for(const section of allAreas){
  await chooseArea(section);
  if(section==='Extras'){
   assert.equal(await page.locator('.smart-design2-supplemental').count(),0,
    'Extras for Cart should not show unsupported supplemental properties');
   assert.equal(await countBox.count(),1,'Count must remain in Extras');
   assert.equal(await paddingBox.count(),1,'Padding must remain in Extras');
   continue;
  }
  assert.deepEqual(await design2GridFingerprint(),template,
   'Switching to '+section+' changed fixed icon placements');
  assert.equal(await countBox.count(),0,'Count must not appear outside Extras');
 }
 await chooseArea('Table');
 const inactiveShape=page.locator('.smart-design2-group [data-design-row="1"] [data-design-slot="shape"]');
 assert.equal(await inactiveShape.count(),1,'Table R1C3 Shape must remain visible');
 assert.equal(await inactiveShape.getAttribute('data-supported'),'false',
  'Table R1C3 must be disabled, not hidden');
 assert.equal(await inactiveShape.locator('button').first().isDisabled(),true,
  'Unsupported Table R1C3 must be an actual disabled control');
 await chooseArea('Row');
 // Row 0: fixed C1 selector, C2 eye, C3 X and C4 Y. Values edit the real
 // free-canvas component.position, not a duplicate properties.x/y field.
 await page.getByRole('button',{name:'Dimensions & Alignment',exact:true}).click();
 const rowZero=design2.locator('.smart-design2-context[data-design-row="0"]');
 const xCell=rowZero.locator('[data-property="x"]');
 const yCell=rowZero.locator('[data-property="y"]');
 await xCell.waitFor({state:'visible'});
 await yCell.waitFor({state:'visible'});
 assert.equal(await xCell.getAttribute('data-design-column'),'3');
 assert.equal(await yCell.getAttribute('data-design-column'),'4');
 const xInput=xCell.getByRole('spinbutton',{name:'X Position'});
 const yInput=yCell.getByRole('spinbutton',{name:'Y Position'});
 assert.equal(await xInput.inputValue(),'24');
 assert.equal(await yInput.inputValue(),'28');
 for(const cell of [xCell,yCell]){
  const bounds=await cell.boundingBox();
  assert.ok(bounds&&Math.abs(bounds.width-80)<1&&Math.abs(bounds.height-26)<1,
   'R0 coordinate controls must be exactly 80x26px');
 }
 await xInput.fill('64');
 await yInput.fill('68');
 assert.equal(await cart.evaluate(element=>Number.parseFloat(element.style.left)),64,
  'R0 X did not reposition component on canvas');
 assert.equal(await cart.evaluate(element=>Number.parseFloat(element.style.top)),68,
  'R0 Y did not reposition component on canvas');
 await chooseArea('Row');
 const row=page.locator('.smart-design2-group');
 const rowFill=row.locator('[data-design-row="1"] [data-design-slot="fill"]');
 await rowFill.waitFor();
 assert.equal(await rowFill.getAttribute('data-design-column'),'1',
  'Row Body Color must remain R1C1 even when a renderer hook is unavailable');
 const rowBold=row.locator('[data-property="rowBold"] button');
 await rowBold.waitFor();
 assert.equal(await rowBold.isDisabled(),false,'Row Bold should be enabled');
 await rowBold.click();
 assert.equal(await rowBold.getAttribute('aria-pressed'),'true',
  'Row Bold control did not write metadata value');

 // Renderer must apply the changed value to a real preview row.
 const rowStyle=page.locator('[data-component-id="browser-design2-cart"] .smart-cart-row').first();
 await rowStyle.waitFor({state:'visible'});
 assert.equal(await rowStyle.evaluate(element=>getComputedStyle(element).fontWeight),'700',
  'Cart row does not visually apply Row Bold');

 // R3C2 Alignment is a real ICON dropdown, not a text select.
 await chooseArea('Header');
 const alignCell=row.locator('[data-design-row="3"] [data-design-slot="alignment"]');
 assert.equal(await alignCell.getAttribute('data-design-column'),'2');
 assert.equal(await alignCell.getAttribute('data-supported'),'true');
 const alignTrigger=alignCell.locator('.smart-icon-dropdown-trigger');
 await alignTrigger.click();
 await page.locator('.smart-icon-dropdown-popup [role="menuitemradio"]').nth(2).click();
 assert.match(await alignTrigger.getAttribute('aria-label')??'',/Right/);
 assert.equal(await cart.locator('.smart-cart-header').evaluate(element=>
   getComputedStyle(element).textAlign),'right','R3C2 alignment did not update the Cart header');

 // Image Placement follows Shadow at R2C4; Image Fill is at R3C5.
 // have icon-based menus, including the existing Fit/Fill/Stretch choices.
 await chooseArea('Image');
 const imagePlacement=row.locator('[data-design-row="2"] [data-design-slot="placement"]');
 const imageFill=row.locator('[data-design-row="3"] [data-design-slot="imageFill"]');
 assert.equal(await imagePlacement.getAttribute('data-design-column'),'4');
 assert.equal(await imageFill.getAttribute('data-design-column'),'5');
 assert.equal(await imagePlacement.getAttribute('data-supported'),'true');
 assert.equal(await imageFill.getAttribute('data-supported'),'true');
 assert.equal(await imagePlacement.locator('.design2-icon-trigger').count(),1,
   'R2C4 image placement must be an icon dropdown');
 assert.equal(await imageFill.locator('.design2-icon-trigger').count(),1,
   'R3C5 image fit must be an icon dropdown');
 // Geometry is Excel-owned and remains at 40x26px, not enlarged by
 // the earlier Design tab's wider select CSS.
 const placementRect=await imagePlacement.locator('.design2-icon-trigger').boundingBox();
 const fillRect=await imageFill.locator('.design2-icon-trigger').boundingBox();
 for(const bounds of [placementRect,fillRect]){
  assert.ok(bounds&&Math.abs(bounds.width-40)<1&&Math.abs(bounds.height-26)<1,
    'Image icon dropdown must occupy exactly 40x26 px at its R/C position');
 }
 // Placement now follows the Shadow selector in compact Position.
 const shadowRect=await row.locator('[data-design-row="2"] [data-design-slot="shadow"]').boundingBox();
 assert.ok(shadowRect&&placementRect&&Math.abs(placementRect.x-(shadowRect.x+shadowRect.width+4))<1,
  'Image Placement must immediately follow Shadow in the fixed Position row');
 assert.equal(Math.round(fillRect.x),Math.round(
   template.find(item=>item.row===3&&item.column===5).x+
   (await row.locator('[data-design-row="3"]').boundingBox()).x));
 // Old flex!important plus grid-area:auto!important collapsed Image slots into C1.
 const firstImageCell=row.locator('[data-design-row="1"] [data-design-slot="fill"]');
 const firstRect=await firstImageCell.boundingBox();
 assert.ok(firstRect&&placementRect.x>firstRect.x+150,
   'Image placement must not collapse into C1 from its fixed C4 position');
 assert.ok(firstRect&&fillRect.x>firstRect.x+150,
   'Image fill must not collapse into C1 from its fixed C5 position');
 for(const index of [1,2,3]){
  assert.equal(await row.locator('[data-design-row="'+index+'"]').evaluate(
    element=>getComputedStyle(element).display),'grid',
    'Property row '+index+' must render as grid, not flex');
 }

 const placementTrigger=imagePlacement.locator('.design2-icon-trigger');
 const fillTrigger=imageFill.locator('.design2-icon-trigger');
 assert.equal(await placementTrigger.getAttribute('data-icon-kind'),'imagePlacement');
 assert.equal(await fillTrigger.getAttribute('data-icon-kind'),'imageFill');
 await placementTrigger.click();
 // The popup portal must be ABOVE the canvas actions portal (z-index 11000),
 // otherwise the "Left" choice appears but the floating toolbar steals clicks.
 const dropdownLayer=await page.locator('.design2-icon-popup').evaluate(element=>
  Number(getComputedStyle(element).zIndex));
 const canvasLayer=await page.locator('.canvas-floating-actions-host').first().evaluate(element=>
  Number(getComputedStyle(element).zIndex));
 assert.ok(dropdownLayer>canvasLayer,
  'Design 2 icon popup must stay clickable above the canvas floating toolbar');
 // Cart's pre-existing contract allows ONLY Left and Right, whereas Card
 // Grid and Smart Image offer all four. Do not offer unsupported Top/Bottom.
 assert.deepEqual(await page.locator('.design2-icon-popup [role="menuitemradio"]:not([disabled])')
   .evaluateAll(buttons=>buttons.map(button=>button.title)),['Left','Right']);
 await page.locator('.design2-icon-popup button[title="Left"]').click();
 await fillTrigger.click();
 assert.deepEqual(await page.locator('.design2-icon-popup [role="menuitemradio"]:not([disabled])')
   .evaluateAll(buttons=>buttons.map(button=>button.title)),['Fill','Fit','Stretch']);
 await page.locator('.design2-icon-popup button[title="Fit"]').click();
 assert.match(await fillTrigger.getAttribute('aria-label')??'',/Fit/);

 // Area switching must not change the selected component or old Design view.
 await chooseArea('Table');
 assert.equal(await row.locator('[data-property="tableBackgroundColor"]').getAttribute('data-supported'),'true');
 assert.equal(await row.locator('[data-design-slot="focused"]').count(),0,
  'Focus shortcut must be absent from the main Design rows');
 await chooseArea('Focused');
 assert.equal(await row.locator('[data-design-row="1"] [data-design-slot="fill"]').count(),1,
  'Focused accordion retains the existing focus property controls');
 await chooseArea('Body');
 // Both user-reported "blank spaces" must contain the actual DISABLED icons,
 // immediately after their 40px predecessor, not a phantom 80px C3 track.
 // Body R1C3 Shape -> R1C4 Shape Fill, R3C3 Bold -> R3C4 Wrap.
 const cartBodyShapeSlot=row.locator('[data-design-row="1"] [data-design-slot="shape"]');
 const cartBodyShapeFillSlot=row.locator('[data-design-row="1"] [data-design-slot="shapeFill"]');
 const cartBodyBoldSlot=row.locator('[data-design-row="3"] [data-design-slot="bold"]');
 const cartBodyWrapSlot=row.locator('[data-design-row="3"] [data-design-slot="wrap"]');
 for(const [a,b,description] of [[cartBodyShapeSlot,cartBodyShapeFillSlot,'Shape/Shape Fill'],
   [cartBodyBoldSlot,cartBodyWrapSlot,'Bold/Wrap']]){
  const first=await a.boundingBox(),second=await b.boundingBox();
  assert.ok(first&&second&&Math.abs(second.x-first.x-44)<1,
   description+' must be consecutive fixed 40px icons (+4px gap)');
  assert.ok(Math.abs(first.width-40)<1&&Math.abs(second.width-40)<1,
   description+' must remain 40px wide as in Excel');
 }
 assert.equal(await cartBodyShapeFillSlot.getAttribute('data-supported'),'true',
  'Cart Body Shape Fill is approved; keep its existing enabled status');
 assert.equal(await cartBodyShapeFillSlot.getAttribute('data-kind'),'color',
  'Unsupported Shape Fill must keep its colour icon, not become a blank number input');
 assert.equal(await cartBodyShapeFillSlot.locator('.office-ribbon-colour-property').count(),1,
  'Shape Fill colour icon must render after Shape');
 assert.equal(await cartBodyWrapSlot.getAttribute('data-supported'),'false',
  'Cart Body Wrap is not approved: show it disabled, do not hide it');
 assert.equal(await cartBodyWrapSlot.locator('button.smart-icon-toggle').count(),1,
  'Wrap must render its disabled icon after Bold');
 // The legacy Design tab is retired: Design 2 is the only Design tab.
 assert.equal(await page.getByRole('tab',{name:'Design 2',exact:true}).count(),0,
  'Retired legacy Design tab must not return beside Design 2');

 // Persist, reload and check that Design 2 is editing the same component SQL values.
 const saveResponses=[];
 const captureSave=response=>{
  if(response.url().includes('/api/metadata/pages/'+pageName))
   saveResponses.push({url:response.url(),method:response.request().method(),status:response.status()});
 };
 page.on('response',captureSave);
 const save=page.waitForResponse(response=>response.url().includes(
  '/api/metadata/pages/'+pageName+'/layouts/Desktop/draft')&&response.request().method()==='PUT',
  {timeout:10000}).catch(()=>null);
 await page.getByRole('button',{name:'Save',exact:true}).click();
 const savedResponse=await save;
 page.off('response',captureSave);
 assert.ok(savedResponse,'Design 2 Save did not reach SQL draft. Requests: '+
  JSON.stringify(saveResponses)+' UI: '+(await page.locator('body').innerText()).slice(-1000));
 assert.equal(savedResponse.status(),200,'Design 2 edit failed SQL draft save');
 const {PageRuntime}=await import('../dist-system/system-files/page-runtime.js');
 const runtime=new PageRuntime(db);
 const draft=await runtime.editor(tenantId,pageName,'Desktop');
 assert.equal(draft.components.find(item=>item.id==='browser-design2-cart')?.properties.rowBold,true,
  'Row Bold did not survive SQL save');
 assert.equal(draft.components.find(item=>item.id==='browser-design2-cart')?.properties.headerAlignment,'right',
  'Design 2 R3C2 alignment icon dropdown did not persist');
 assert.equal(draft.components.find(item=>item.id==='browser-design2-cart')?.properties.imagePlacement,'left',
  'Design 2 R2C4 image placement icon dropdown did not persist');
 assert.equal(draft.components.find(item=>item.id==='browser-design2-cart')?.properties.imageFill,'fit',
  'Design 2 R3C5 image fit icon dropdown did not persist');
 assert.equal(draft.components.find(item=>item.id==='browser-design2-cart')?.position?.x,64,
  'Design 2 R0 X position did not survive SQL save');
 assert.equal(draft.components.find(item=>item.id==='browser-design2-cart')?.position?.y,68,
  'Design 2 R0 Y position did not survive SQL save');
 assert.equal(draft.components.find(item=>item.id==='browser-design2-cart')?.properties.x,undefined,
  'Design 2 must not duplicate canvas X in properties.x');
 assert.equal(draft.components.find(item=>item.id==='browser-design2-cart')?.properties.y,undefined,
  'Design 2 must not duplicate canvas Y in properties.y');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('[data-component-id="browser-design2-cart"]').first().click({position:{x:18,y:18}});
 await page.getByRole('tab',{name:'Design',exact:true}).click();
 await chooseArea('Row');
 // SQL draft is already verified above. The editor may still be hydrating its
 // selected-component metadata after navigation; wait for that same saved
 // value to render instead of asserting against the intermediate default.
 await page.waitForFunction(()=>
  document.querySelector('.smart-design2-ribbon[data-smart-api="smart_cart"] [data-property="rowBold"] button')
   ?.getAttribute('aria-pressed')==='true',undefined,{timeout:10000});
 assert.equal(await page.locator('.smart-design2-ribbon[data-smart-api="smart_cart"] [data-property="rowBold"] button')
  .getAttribute('aria-pressed'),'true','Design 2 saved value did not reload');

 // All sections stay visible for Smart Tabs, too. The unsupported Image
 // controls occupy the exact same R/C cells but cannot be edited.
 await page.locator('[data-component-id="browser-design2-tabs"]').first().click({position:{x:18,y:18}});
 const tabsAreas=(await areaButtons().allTextContents()).map(value=>value.trim());
 assert.deepEqual(tabsAreas,allAreas,'All Excel areas must be visible for Smart Tabs');
 await chooseArea('Image');
 for(const [slotKey,rowNumber,column] of [['fill',1,1],['placement',2,4],['imageFill',3,5]]){
  const control=row.locator('[data-design-row="'+rowNumber+'"] [data-design-slot="'+slotKey+'"]');
  assert.equal(await control.count(),1,'Unsupported Image slot must remain visible');
  assert.equal(await control.getAttribute('data-design-column'),String(column));
  assert.equal(await control.getAttribute('data-supported'),'false',
   'Unsupported Image control must not become editable for Smart Tabs');
  assert.ok((await control.getAttribute('class'))?.includes('disabled'),
   'Unsupported Image slot must remain disabled');
 }
 // Selected-state styling was intentionally migrated to Focused R1C1.
 // Verify both the real property binding and its editable control.
 await chooseArea('Focused');
 const tabsFocus=row.locator('[data-design-row="1"] [data-design-slot="fill"]');
 assert.equal(await tabsFocus.getAttribute('data-property'),'selectedTabColor',
   'Focused Fill must preserve the existing Selected Tab colour key');
 assert.equal(await tabsFocus.getAttribute('data-supported'),'true',
   'Selected Tab colour must remain editable in Focused');
 assert.equal(await tabsFocus.locator('button.office-ribbon-colour-property').isDisabled(),false,
   'Selected Tab colour palette must be enabled');
 await page.locator('[data-component-id="browser-design2-cart"]').first().click({position:{x:18,y:18}});
 await chooseArea('Row');
 assert.equal(await row.locator('[data-design-slot="focused"]').count(),0,
  'Row Focus shortcut must be omitted; focus remains in the Focused accordion');
 await chooseArea('Focused');
 assert.equal(await row.locator('[data-design-row="1"] [data-design-slot="fill"]').count(),1,
  'Focused section must retain its editable shared fill slot');
 await chooseArea('Row');
 const {mkdir}=await import('node:fs/promises');
 await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
 await page.screenshot({path:new URL('../artifacts/design2-contextual-ribbon.png',import.meta.url).pathname});

 // The shared editor is permanently docked left. No top ribbon switching
 // or collapse controls may hide editable metadata properties.
 await page.locator('[data-component-id="browser-design2-cart"]').first().click({position:{x:18,y:18}});
 await chooseArea('Body');
 const dock=page.locator('.page-builder-design-dock');
 await dock.locator('.smart-design2-area-section[data-design-area="Body"] > button').waitFor({state:'visible'});
 assert.equal(await page.locator('.office-ribbon-topbar .office-ribbon-tabs').count(),0,
  'The top bar must not duplicate left-side tabs');
 for(const label of ['Collapse the ribbon','Pin the ribbon','Show tabs in the top ribbon','Show tabs in the left panel'])
  assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),0,
   'Retired ribbon switch remains: '+label);
 // The Dimensions & Alignment accordion owns the original 15 commands.
 // Body collapses while Dimensions opens; opening Body again restores its matrix.
 await page.getByRole('button',{name:'Dimensions & Alignment',exact:true}).click();
 assert.equal(await dock.locator('.smart-design2-area-section[data-design-area="Body"] > button')
  .getAttribute('aria-expanded'),'false');
 const dockGroups=await dock.evaluate(root=>
  [['Dimensions','.smart-design2-dimensions',0],
   ['Alignment','[data-design-section="alignment"]',6],
   ['Arrangement','[data-design-section="arrangement"]',6],
   [null,'[data-design-section="dimensions"]',3]].map(([heading,selector,expected])=>{
    const el=root.querySelector(selector);
    const actual=el?.querySelectorAll('.smart-design2-arrange-action').length??-1;
    const css=el?getComputedStyle(el):null;
    return {heading,expected,actual,display:css?.display,
     before:heading&&el?getComputedStyle(el,'::before').content:null};
  })
 );
 assert.equal(dockGroups.length,4);
 for(const g of dockGroups){
  assert.equal(g.display,'flex','Dock section must remain visible: '+g.heading);
  assert.equal(g.actual,g.expected,'Dock section must preserve original actions: '+g.heading);
  if(g.heading)assert.ok(g.before?.includes(g.heading),'Missing dock heading '+g.heading);
 }
 assert.equal(await dock.locator('.smart-design2-arrange-action').count(),15,
  'Dock groups must not duplicate or remove Design commands');

 // Typing must survive intermediate empty/out-of-range values. This reproduces
 // the reported failure: replacing a multi-digit number one key at a time.
 const replaceNumeric=async(input,next)=>{
  await input.focus();
  await input.press('ControlOrMeta+a');
  await input.press('Backspace');
  assert.equal(await input.inputValue(),'','Deleting a number must leave an editable empty draft');
  await input.pressSequentially(next);
  assert.equal(await input.inputValue(),next,'The editor lost keyboard input while typing '+next);
  await input.blur();
  assert.equal(await input.inputValue(),next,'Valid numeric draft did not persist on blur');
 };
 const dockX=dock.locator('.smart-design2-dimensions [data-property="x"] input');
 const dockY=dock.locator('.smart-design2-dimensions [data-property="y"] input');
 // Real pointer click must focus the number's text area and reveal its caret,
 // not merely activate native spinner arrows. Programmatic focus missed this.
 await dockX.click({position:{x:12,y:12}});
 const numericFocus=await dockX.evaluate(input=>({
  focused:document.activeElement===input,
  caret:getComputedStyle(input).caretColor,
  cursor:getComputedStyle(input).cursor
 }));
 assert.equal(numericFocus.focused,true,'Mouse click did not focus numeric text input');
 assert.ok(numericFocus.caret!=='transparent' &&
  numericFocus.caret!=='rgba(0, 0, 0, 0)' &&
  numericFocus.caret!=='auto',
  'Text caret must be visible after clicking the numeric field: '+JSON.stringify(numericFocus));
 assert.equal(numericFocus.cursor,'text','Numeric text area must show text cursor');
 await replaceNumeric(dockX,'120');
 assert.equal(await cart.evaluate(element=>Number.parseFloat(element.style.left)),120,
  'Dock X edit did not update the same canvas position');
 await replaceNumeric(dockX,'64');
 await replaceNumeric(dockY,'140');
 assert.equal(await cart.evaluate(element=>Number.parseFloat(element.style.top)),140,
  'Dock Y edit did not update the same canvas position');
 await replaceNumeric(dockY,'68');
 await chooseArea('Body');
 assert.equal(await dock.locator('.smart-design2-dimensions').count(),0,
  'Dimensions controls must collapse when Body is expanded');
 // Count is edited in Extras; returning to Body must preserve its value.
 await chooseArea('Extras');
 const dockCountInput=dock.locator('.smart-design2-count input.smart-office-number');
 if(!await dockCountInput.isDisabled()){
  const original=await dockCountInput.inputValue();
  const replacement=original==='3'?'4':'3';
  await replaceNumeric(dockCountInput,replacement);
  await replaceNumeric(dockCountInput,original);
 }
 await chooseArea('Body');
 const editableBodyNumber=dock.locator('.smart-ribbon-row .smart-property[data-kind="number"] input:not([disabled])').first();
 if(await editableBodyNumber.count()){
  const original=await editableBodyNumber.inputValue();
  if(original){
   await replaceNumeric(editableBodyNumber,'18');
   await replaceNumeric(editableBodyNumber,original);
  }
 }

 assert.equal(await page.locator('.smart-design2-ribbon').count(),1,'Design 2 must render once, in the dock');
 await page.screenshot({path:new URL('../artifacts/design2-left-dock.png',import.meta.url).pathname});

 // Formula uses twice the previous 440px target width and shifts into the
 // space vacated by the top tab switches, without moving Quick Access.
 const formulaBar=await page.locator('.office-ribbon-topbar-formula').evaluate(el=>{
  const style=getComputedStyle(el),rect=el.getBoundingClientRect();
  return {basis:style.flexBasis,maxWidth:style.maxWidth,width:rect.width};
 });
 assert.equal(formulaBar.basis,'880px');
 assert.equal(formulaBar.maxWidth,'880px');
 assert.ok(formulaBar.width>440,'Formula bar did not expand into the free topbar space: '+JSON.stringify(formulaBar));

 // The left Insert gallery must show every registered Smart tile, not just the
 // first two rows of the retired horizontal ribbon.
 await page.getByRole('tab',{name:'Insert',exact:true}).click();
 const gallery=await dock.locator('.smart-insert-tiles').evaluate(el=>{
  const tiles=[...el.querySelectorAll('.smart-insert-tile')];
  const rows=new Set(tiles.map(tile=>Math.round(tile.getBoundingClientRect().top)));
  const style=getComputedStyle(el);
  const tops=tiles.slice(0,4).map(tile=>Math.round(tile.getBoundingClientRect().top));
  return {count:tiles.length,rows:rows.size,
   columns:style.gridTemplateColumns.split(' ').filter(Boolean).length,tops,
   overflowY:style.overflowY,height:el.clientHeight,scrollHeight:el.scrollHeight};
 });
 assert.ok(gallery.count>10,'Registered Smart components missing: '+JSON.stringify(gallery));
 assert.ok(gallery.rows>=3,'Extra Insert component rows are clipped: '+JSON.stringify(gallery));
 assert.equal(gallery.columns,3,'Insert must use three columns at 100% zoom');
 assert.deepEqual(gallery.tops.slice(0,3),Array(3).fill(gallery.tops[0]),
  'First three Insert components must share one row');
 assert.ok(gallery.tops[3]>gallery.tops[0],'Fourth Insert component must wrap to row two');
 assert.equal(gallery.overflowY,'visible','Insert grid must not hide lower rows');
 assert.ok(gallery.scrollHeight<=gallery.height+2,'Insert grid still clips lower rows: '+JSON.stringify(gallery));
 await page.getByRole('tab',{name:'Design',exact:true}).click();
 await page.locator('[data-component-id="browser-design2-cart"]').first().click({position:{x:18,y:18}});

 // Verify real selected-component binding icon geometry in Chromium, not
 // just the existence of SQL properties or hard-coded source attributes.
 const auditBindings=async(id)=>{
  const root=page.locator('[data-component-id="'+id+'"]').first();
  await root.locator('.canvas-data-icon-button').first().waitFor({state:'visible'});
  const result=await root.evaluate(host=>{
   const icons=[...host.querySelectorAll('.canvas-data-icon-button')];
   const anchors=[...host.querySelectorAll('[data-md-bind]')];
   const bounds=host.getBoundingClientRect(),errors=[];
   for(const icon of icons){
    const key=icon.dataset.bindingProperty;
    const fields=anchors.filter(el=>(el.getAttribute('data-md-bind')||'').split(/\s+/).includes(key));
    if(!fields.length){errors.push('No field: '+key);continue;}
    const rect=icon.getBoundingClientRect();
    if(rect.left<bounds.left-2||rect.top<bounds.top-2||
      rect.right>bounds.right+2||rect.bottom>bounds.bottom+2)errors.push('Outside: '+key);
    const distance=Math.min(...fields.map(field=>{
     const a=field.getBoundingClientRect();
     return Math.hypot(Math.max(a.left-rect.right,rect.left-a.right,0),
      Math.max(a.top-rect.bottom,rect.top-a.bottom,0));
    }));
    if(distance>32)errors.push('Detached: '+key+' '+distance);
   }
   for(let i=0;i<icons.length;i++)for(let j=i+1;j<icons.length;j++){
    const a=icons[i].getBoundingClientRect(),b=icons[j].getBoundingClientRect();
    if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&
     Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)
     errors.push('Overlapping: '+icons[i].dataset.bindingProperty+'/'+icons[j].dataset.bindingProperty);
   }
   return {errors,properties:icons.map(el=>el.dataset.bindingProperty)};
  });
  assert.deepEqual(result.errors,[],'Misplaced '+id+' binding icons: '+JSON.stringify(result));
  return result.properties;
 };
 const tabCanvas=page.locator('[data-component-id="browser-design2-tabs"]').first();
 await tabCanvas.click({position:{x:10,y:10}});
 const tabKeys=await auditBindings('browser-design2-tabs');
 assert.equal(tabKeys.filter(key=>key==='tabCaptionFormula').length,2,
  'One independently editable caption per visible static tab');
 assert.ok(!tabKeys.includes('label'),'Tabs must not expose an unrelated Label icon');
 assert.ok(!tabKeys.includes('collectionFormula'),'Static tabs must not show a collection icon');
 await tabCanvas.locator('[data-binding-property="tabCaptionFormula"]').nth(1).click();
 await page.locator('.smart-data-active-binding').getByText('Tab caption').waitFor({state:'visible'});
 const formulaInput=page.locator('.smart-data-formula-input input').first();
 await formulaInput.waitFor({state:'visible'});
 assert.equal(await formulaInput.inputValue(),'Tab 2',
  'Second tab icon must select its actual caption');
 assert.ok(await formulaInput.evaluate(el=>document.activeElement===el),
  'The existing Formula Bar must be focused after clicking an icon');

 await checkFormulaTooltipPlacement({page,formulaInput});

 const cartCanvas=page.locator('[data-component-id="browser-design2-cart"]').first();
 await cartCanvas.click({position:{x:10,y:10}});
 const cartKeys=await auditBindings('browser-design2-cart');
 assert.ok(!cartKeys.includes('collectionFormula'),
  'Cart items source belongs to Source, never a visual field icon');
 await page.getByRole('button',{name:'Select items source formula'}).click();
 await page.locator('.smart-data-active-binding').getByText('Items source')
  .waitFor({state:'visible'});
 assert.equal(await page.locator('.smart-data-formula-input input').count(),1,
  'Items source must use the same Formula Bar');
 for(const key of ['cartColumn1Header','cartColumn2Header','cartColumn3Header',
  'cartColumn4Header','subtotalLabel','subtotalValue','totalLabel','totalValue'])
  assert.ok(cartKeys.includes(key),'Missing Cart visual binding '+key);
 assert.equal(await tabCanvas.locator('.canvas-data-icon-button').count(),0,
  'Unselected components must not show data icons');
 await cartCanvas.locator('[data-binding-property="cartColumn2Header"]').click();
 await page.locator('.smart-data-active-binding').getByText('Unit price heading')
  .waitFor({state:'visible'});
 await page.screenshot({path:new URL('../artifacts/selected-cart-field-binding-icons.png',import.meta.url).pathname});

 // Ctrl+A, Delete and Undo must agree on the exact multi-selection. A single
 // confirmation removes the full active layout selection, never just selectedId.
 await page.locator('[data-component-id="browser-design2-cart"]').first().click({position:{x:18,y:18}});
 await page.keyboard.press('Control+a');
 assert.equal(await page.locator('.record-component.multi-selected').count(),2,
  'Both Page Builder components must be selected before bulk Delete');
 const dialogs=[];
 page.once('dialog',dialog=>{dialogs.push(dialog.message());void dialog.accept();});
 await page.keyboard.press('Delete');
 await page.waitForFunction(()=>document.querySelectorAll('[data-component-id="browser-design2-cart"],[data-component-id="browser-design2-tabs"]').length===0);
 assert.equal(dialogs.length,1,'Bulk Delete must require one confirmation');
 assert.match(dialogs[0],/2 selected page components/);
 await page.keyboard.press('Control+z');
 await page.locator('[data-component-id="browser-design2-cart"]').first().waitFor({state:'visible'});
 await page.locator('[data-component-id="browser-design2-tabs"]').first().waitFor({state:'visible'});
 assert.equal(await page.locator('[data-component-id="browser-design2-cart"],[data-component-id="browser-design2-tabs"]').count(),2,
  'A single Undo must restore all deleted components');


 // Four controls must be editable on a REAL persisted Page Builder page, with
 // the original icons, fixed SQL coordinates, rendered effect and SQL save.
 const fourPageName='browserdesign2four';
 const fourPayload={
  apiName:fourPageName,label:'Design 2 Four Control',targetObject:'',
  pageType:'App Page',layoutMode:'free-canvas',canvasWidth:1280,canvasHeight:900,
  status:'Draft',devices:['Desktop'],activationAssignments:[],
  components:[
   {id:'four-calendar',type:'Custom:smart_calendar',label:'Focus calendar',
    region:'main',visible:true,
    properties:{selectedDate:'2026-11-04',defaultValueColor:'#2563eb'},
    position:{x:28,y:32,width:330,height:280}},
   {id:'four-grid',type:'Custom:smart_card_grid',label:'Wrap card',
    region:'main',visible:true,
    properties:{textSource:'"Two line card header"',imageHeight:0,wrapText:false,
     textSize:122,headerBoxHeight:44},
    position:{x:402,y:32,width:350,height:280}},
   {id:'four-nav',type:'Custom:smart_navigation',label:'Image navigation',
    region:'main',visible:true,properties:{imageFill:'fill',
     items:[{id:'one',label:'Menu',imageSrc:'https://example.com/menu.png'}]},
    position:{x:28,y:360,width:460,height:128}},
   {id:'four-toggle',type:'Custom:smart_toggle',label:'Shape toggle',
    region:'main',visible:true,properties:{shapeId:'shape:rectangle'},
    position:{x:540,y:360,width:150,height:100}},
   // Large-title regression: same shared card renderer as the Card Grid.
   {id:'four-large-image',type:'Custom:smart_image',label:'Large title image',
    region:'main',visible:true,properties:{
     textSource:'"Eat in"',imageSource:'',imagePlacement:'left',imageWidth:165,
     textSize:122,headerBoxHeight:44,wrapText:true},
    position:{x:760,y:32,width:480,height:180}}
  ]
 };
 const fourCreate=await page.evaluate(async({token,payload})=>{
  const response=await fetch('/api/metadata/pages/'+payload.apiName,{
   method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  });
  return {status:response.status,body:await response.json().catch(()=>null)};
 },{token,payload:fourPayload});
 assert.equal(fourCreate.status,200,'Cannot seed four-control E2E page: '+
   JSON.stringify(fourCreate.body));
 await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Search pages').fill('Design 2 Four Control');
 await page.getByRole('button',{name:'Design Design 2 Four Control',exact:true}).click();
 await page.getByRole('tab',{name:'Design',exact:true}).waitFor({timeout:20000});
 const selectFour=async(id,area)=>{
  const block=page.locator('[data-component-id="'+id+'"]').first();
  await block.waitFor({state:'visible'});
  await block.click({position:{x:8,y:8}});
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await chooseArea(area);
  return block;
 };
 const fourRibbon=page.locator('.smart-design2-group');

 const calendarBlock=await selectFour('four-calendar','Focused');
 const focus=fourRibbon.locator('[data-design-row="1"] [data-design-slot="fill"]');
 assert.equal(await focus.getAttribute('data-property'),'defaultValueColor');
 assert.equal(await focus.getAttribute('data-design-column'),'1');
 assert.equal(await focus.getAttribute('data-supported'),'true');
 const focusTrigger=focus.locator('button.office-ribbon-colour-property');
 assert.equal(await focusTrigger.isDisabled(),false,'Calendar Focus icon must be enabled');
 assert.ok(await focusTrigger.locator('svg').count(),'Calendar Focus must use the palette icon');
 await focusTrigger.click();
 const palette=page.locator('.office-ribbon-colour-palette');
 await palette.getByRole('textbox',{name:'HEX for Default Value Color'}).fill('#126abc');
 await palette.getByRole('button',{name:'Apply',exact:true}).click();
 const focusedDay=calendarBlock.locator('.smart-calendar-selected-day');
 await focusedDay.waitFor({state:'visible'});
 assert.equal(await focusedDay.evaluate(element=>getComputedStyle(element).backgroundColor),
  'rgb(18, 106, 188)','Calendar Focus must paint the selected day');

 const gridBlock=await selectFour('four-grid','Body');
 const wrap=fourRibbon.locator('[data-design-row="3"] [data-design-slot="wrap"]');
 assert.equal(await wrap.getAttribute('data-property'),'wrapText');
 assert.equal(await wrap.getAttribute('data-design-column'),'4');
 assert.equal(await wrap.getAttribute('data-supported'),'true');
 const wrapToggle=wrap.getByRole('button',{name:'Wrap Text'});
 assert.equal(await wrapToggle.isDisabled(),false,'Card Grid Wrap must be editable');
 await wrapToggle.click();
 assert.equal(await wrapToggle.getAttribute('aria-pressed'),'true');
 assert.equal(await gridBlock.locator('.smart-card-content').first().evaluate(element=>
  getComputedStyle(element).whiteSpace),'normal','Card Grid Wrap must change header wrapping');

 // Measure the REAL card DOM in Chromium. Both use SmartCard, but an
 // explicitly authored Card Grid header height must remain bounded and
 // scrollable; standalone Image captions still grow intrinsically.
 const checkLargeCardTitle=async(id)=>{
  const caption=page.locator('[data-component-id="'+id+'"] .smart-card-content').first();
  const metric=await caption.evaluate(element=>{
   const card=element.closest('.smart-card');
   const rect=element.getBoundingClientRect();
   return {fontSize:getComputedStyle(element).fontSize,
     height:rect.height,boxHeight:element.style.height,
     minHeight:getComputedStyle(element).minHeight,
     overflowY:getComputedStyle(element).overflowY,
     contentHeight:element.scrollHeight,clientHeight:element.clientHeight,
     cardScrollHeight:card.scrollHeight,cardClientHeight:card.clientHeight,
     cardOverflow:getComputedStyle(card).overflowY};
  });
  assert.equal(metric.fontSize,'122px',id+' did not render the editor font size');
  assert.equal(metric.boxHeight,'44px',id+' lost Header Box Height metadata');
  assert.equal(metric.cardOverflow,'auto',id+' card must scroll if content exceeds its frame');
  if(id==='four-grid'){
   assert.equal(metric.minHeight,'0px','Authored Card Grid header must remain bounded');
   assert.ok(metric.height<=46,'Card Grid header exceeds authored height: '+JSON.stringify(metric));
   assert.equal(metric.overflowY,'auto','Oversized Card Grid title must scroll inside header');
   assert.ok(metric.contentHeight>metric.clientHeight+2,
    'Card Grid fixture must exercise oversized text: '+JSON.stringify(metric));
   const scrolled=await caption.evaluate(element=>{
    element.scrollTop=element.scrollHeight;
    return element.scrollTop;
   });
   assert.ok(scrolled>0,'Card Grid title must remain reachable through its own scrollbar');
  }else{
   assert.ok(metric.height>44,id+' caption must grow beyond the initial box: '+JSON.stringify(metric));
   assert.equal(metric.minHeight,'max-content',id+' caption must grow with its contents');
   assert.ok(metric.contentHeight<=metric.clientHeight+2,
    id+' still clips content within its caption: '+JSON.stringify(metric));
  }
  if(metric.cardScrollHeight>metric.cardClientHeight+2){
   const scrolled=await page.locator('[data-component-id="'+id+'"] .smart-card').first()
    .evaluate(card=>{card.scrollTop=card.scrollHeight;return card.scrollTop;});
   assert.ok(scrolled>0,id+' bottom text cannot be reached by scrolling');
  }
 };
 await checkLargeCardTitle('four-grid');
 await checkLargeCardTitle('four-large-image');

 const navBlock=await selectFour('four-nav','Image');
 const navFit=fourRibbon.locator('[data-design-row="3"] [data-design-slot="imageFill"]');
 assert.equal(await navFit.getAttribute('data-property'),'imageFill');
 assert.equal(await navFit.getAttribute('data-design-column'),'5');
 assert.equal(await navFit.getAttribute('data-supported'),'true');
 const navFitTrigger=navFit.locator('.design2-icon-trigger');
 assert.equal(await navFitTrigger.isDisabled(),false,'Navigation image fit icon disabled');
 await navFitTrigger.click();
 assert.deepEqual(await page.locator('.design2-icon-popup [role="menuitemradio"]:not([disabled])')
  .evaluateAll(buttons=>buttons.map(button=>button.title)),['Fill','Fit','Stretch']);
 await page.locator('.design2-icon-popup button[title="Fit"]').click();
 assert.equal(await navBlock.locator('.smart-navigation-item img').first().evaluate(element=>
  getComputedStyle(element).objectFit),'contain','Navigation Fit must update image object-fit');

 const toggleBlock=await selectFour('four-toggle','Body');
 const shape=fourRibbon.locator('[data-design-row="1"] [data-design-slot="shape"]');
 assert.equal(await shape.getAttribute('data-property'),'shapeId');
 assert.equal(await shape.getAttribute('data-design-column'),'3');
 assert.equal(await shape.getAttribute('data-supported'),'true');
 const shapeTrigger=shape.locator('button.smart-shapes-trigger');
 assert.equal(await shapeTrigger.isDisabled(),false,'Toggle Shape gallery disabled');
 await shapeTrigger.click();
 await page.getByRole('dialog',{name:'Choose shape or icon'}).getByRole('button',{name:'Oval',exact:true}).click();
 assert.equal(await toggleBlock.locator('.smart-switch-track').evaluate(element=>
  getComputedStyle(element).borderRadius),'50%',
  'Toggle Shape must visibly change the switch track');

 const fourSaved=page.waitForResponse(response=>response.url().includes(
  '/api/metadata/pages/'+fourPageName+'/layouts/Desktop/draft')&&
  response.request().method()==='PUT',{timeout:10000});
 await page.getByRole('button',{name:'Save',exact:true}).click();
 assert.equal((await fourSaved).status(),200,'Four control Design 2 save failed');
 const fourDraft=await runtime.editor(tenantId,fourPageName,'Desktop');
 const fourProps=id=>fourDraft.components.find(item=>item.id===id)?.properties;
 assert.equal(fourProps('four-calendar')?.defaultValueColor,'#126abc');
 assert.equal(fourProps('four-grid')?.wrapText,true);
 assert.equal(fourProps('four-nav')?.imageFill,'fit');
 assert.equal(fourProps('four-toggle')?.shapeId,'shape:oval');
 console.info('Four Design 2 icon controls: enabled, edited, visibly applied and saved in SQL');

 // Exercise the remaining already seeded types under the same geometry test.
 for(const [id,required] of [
  ['four-calendar',['selectedDate']],['four-grid',['textSource']],
  ['four-nav',[]],['four-toggle',['textSource']]
 ]){
  const component=page.locator('[data-component-id="'+id+'"]').first();
  await component.click({position:{x:10,y:10}});
  if(!required.length){
   assert.equal(await component.locator('.canvas-data-icon-button').count(),0);
   continue;
  }
  const keys=await auditBindings(id);
  for(const key of required)assert.ok(keys.includes(key),id+' missing '+key);
 }
 // Audit every other Smart component family in this authenticated SQL Builder.
 // Fields without visible anchors must never generate unpositioned icons.
 const bindingsPageName='browserallsmartbindings';
 const families=[
  ['smart_button',{label:'Start order'},['label']],
  ['smart_text',{textSource:'"Product text"'},['textSource']],
  ['smart_textbox',{label:'Product name',textSource:'"Sample"'},['label','textSource']],
  ['smart_image',{imageHeight:80},['imageSource']],
  ['smart_lookup',{placeholder:'Search products',lookupValueFormula:'"test"'},['label','lookupValueFormula']],
  ['smart_label',{label:'Smart caption'},['label']],
  ['smart_table',{textSource:'"Name"'},['column2Source','column3Source']],
  ['smart_container',{},[]],
  ['smart_icon',{},[]]
 ];
 const bindingPayload={...payload,apiName:bindingsPageName,label:'All Smart Data Bindings',
  canvasWidth:1320,canvasHeight:1750,
  components:families.map(([api,properties],i)=>({
   id:'binding-'+api,type:'Custom:'+api,label:api,region:'main',visible:true,
   properties,position:{x:24+(i%3)*426,y:24+Math.floor(i/3)*520,width:390,height:440}
  }))};
 const bindingCreate=await page.evaluate(async({token,payload})=>{
  const response=await fetch('/api/metadata/pages/'+payload.apiName,{
   method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  });
  return {status:response.status,body:await response.json().catch(()=>null)};
 },{token,payload:bindingPayload});
 assert.equal(bindingCreate.status,200,'Cannot seed all-Smart data audit page: '+
  JSON.stringify(bindingCreate.body));
 await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Search pages').fill('All Smart Data Bindings');
 await page.getByRole('button',{name:'Design All Smart Data Bindings',exact:true}).click();
 for(const [api,,expected] of families){
  const root=page.locator('[data-component-id="binding-'+api+'"]').first();
  await root.waitFor({state:'visible'});
  await root.click({position:{x:12,y:12}});
  if(api==='smart_button'){
   // A Smart Button may not have a Source grant; its inspector section must
   // still be discoverable with the selector disabled by SQL when unsupported.
   const sourceSection=page.locator('.smart-source-section');
   await sourceSection.waitFor({state:'visible'});
   const sourceToggle=sourceSection.locator('button.smart-inspector-section-toggle');
   assert.match(await sourceToggle.innerText(),/Object Source \(1\)/);
   const canvasViewport=page.locator('.page-preview-area');
   const measureCanvas=()=>canvasViewport.evaluate(viewport=>{
    const canvas=viewport.querySelector('.record-preview.free-canvas-preview');
    return {width:canvas?.getBoundingClientRect().width??0,
     viewportWidth:viewport.clientWidth,scrollWidth:viewport.scrollWidth};
   });
   // Wait for the Smart Button selection's Fit Width/ResizeObserver cycle
   // to settle before attributing a zoom change to expanding Object Source.
   await page.waitForTimeout(200);
   const before=await measureCanvas();
   await sourceToggle.click();
   assert.equal(await sourceToggle.getAttribute('aria-expanded'),'true');
   assert.equal(await sourceSection.getByRole('combobox',{name:'Object 1'}).count(),1);
   assert.equal(await sourceSection.locator('button.smart-source-add').count(),1);
   assert.equal(await sourceSection.locator('button.smart-source-add-label').count(),1);
   const after=await measureCanvas();
   assert.ok(Math.abs(after.width-before.width)<1,
    'Expanding Object Source must not alter canvas zoom or width: '+
     JSON.stringify({before,after}));
   assert.ok(after.scrollWidth<=after.viewportWidth+2,
    'Fit Width must not create a horizontal canvas scrollbar: '+JSON.stringify(after));
   await chooseArea('Body');
   assert.equal(await sourceToggle.getAttribute('aria-expanded'),'false',
    'Object Source must collapse when another Design section opens');
  }
  if(!expected.length){
   assert.equal(await root.locator('.canvas-data-icon-button').count(),0,
    api+' must not invent icons for unbound visual fields');
   continue;
  }
  const keys=await auditBindings('binding-'+api);
  for(const key of expected)assert.ok(keys.includes(key),
   api+' must display an icon beside '+key+' when selected: '+keys.join(','));
  assert.equal(await root.locator('.canvas-data-icon-button.is-fallback').count(),0,
   api+' must never render a bottom-right fallback grid');
 }
 console.info('All Smart families: no icon piles; every displayed icon is field-anchored');

 // The shared Arrange handlers must also work from the fixed Design 2 R0
 // commands on a REAL three-component SQL draft. Single selection aligns to
 // canvas edges; multi selection distributes, groups and unlocks normally.
 const arrangePageName='browserdesign2arrange';
 const arrangePayload={...payload,apiName:arrangePageName,label:'Design 2 Arrange',
  components:[
   {...payload.components[0],id:'arrange-one',label:'Arrange One',
    position:{x:50,y:40,width:160,height:160}},
   {...payload.components[1],id:'arrange-two',label:'Arrange Two',
    position:{x:250,y:70,width:160,height:160}},
   {...payload.components[1],id:'arrange-three',label:'Arrange Three',
    position:{x:590,y:100,width:160,height:160}}
  ]};
 const arrangeCreated=await page.evaluate(async({token,payload})=>{
  const response=await fetch('/api/metadata/pages/'+payload.apiName,{
   method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  });
  return {status:response.status,body:await response.json().catch(()=>null)};
 },{token,payload:arrangePayload});
 assert.equal(arrangeCreated.status,200,'Arrange E2E page was not seeded: '+
  JSON.stringify(arrangeCreated.body));
 await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Search pages').fill('Design 2 Arrange');
 await page.getByRole('button',{name:'Design Design 2 Arrange',exact:true}).click();
 const arrangeOne=page.locator('[data-component-id="arrange-one"]').first();
 await arrangeOne.waitFor({state:'visible'});
 await arrangeOne.click({position:{x:18,y:18}});
 await page.getByRole('tab',{name:'Design',exact:true}).click();
 const dimensionToggleArrange=page.getByRole('button',{name:'Dimensions & Alignment',exact:true});
 if(await dimensionToggleArrange.getAttribute('aria-expanded')!=='true')await dimensionToggleArrange.click();
 const actionRow=page.locator('.smart-design2-arrange-actions');
 const buttons=actionRow.locator('button.smart-design2-arrange-action');
 assert.equal(await buttons.count(),15,'Exactly 15 R0 Arrange actions are required');
 const actionLabels=['Align left','Align centre','Align right','Align top','Align middle',
   'Align bottom','Distribute horizontally','Distribute vertically','Bring to front',
   'Send backward','Group','Ungroup','Lock / Unlock component','Component nesting','Fill canvas'];
 // In the permanent left dock, controls wrap into Dimensions, Alignment and
 // Arrangement sections. The retired top ribbon's 40px/44px C7–C21 x offsets
 // are no longer meaningful; check the real dock dimensions and grouping.
 const arrangeDock=page.locator('.page-builder-design-dock');
 const dockBounds=await arrangeDock.boundingBox();
 const selectorRect=await arrangeDock.locator('.smart-design2-area-section[data-design-area="Body"] > button').boundingBox();
 assert.ok(dockBounds&&selectorRect&&
   selectorRect.width>=dockBounds.width-26&&selectorRect.width<=dockBounds.width,
  'The collapsible section heading must fill the compact inspector content area');
 const rects=[];
 for(let i=0;i<15;i++){
  const button=buttons.nth(i);
  assert.equal(await button.getAttribute('data-design-row'),'0');
  assert.equal(await button.getAttribute('data-design-column'),String(i+7));
  assert.equal(await button.getAttribute('title'),actionLabels[i]);
  const rect=await button.boundingBox();
  const expectedWidth=i===12||i===13?58:66;
  assert.ok(rect&&Math.abs(rect.width-expectedWidth)<1&&Math.abs(rect.height-26)<1,
   'R0 C'+(i+7)+' action must measure '+expectedWidth+'×26px in the left dock: '+JSON.stringify(rect));
  assert.ok(rect.x>=dockBounds.x-2&&rect.x+rect.width<=dockBounds.x+dockBounds.width+2,
   'R0 C'+(i+7)+' action must fit inside the dock without horizontal clipping');
  rects.push(rect);
 }
 for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
  const a=rects[i],b=rects[j];
  assert.ok(a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||
    a.y+a.height<=b.y+1||b.y+b.height<=a.y+1,
   'R0 actions must not overlap in wrapped dock sections: C'+(i+7)+' and C'+(j+7));
 }
 assert.ok(rects.slice(0,4).every(rect=>Math.abs(rect.y-rects[0].y)<2),
  'The first four alignment actions must share one row in the compact inspector');
 assert.ok(rects.slice(4,6).every(rect=>Math.abs(rect.y-rects[4].y)<2)&&
   rects[4].y>rects[0].y+3,
  'The remaining two alignment actions must wrap together onto the next row');
 assert.equal(await buttons.nth(0).isDisabled(),false,'Align left must work for a single component');
 assert.equal(await buttons.nth(6).isDisabled(),true,'Distribute needs three selected components');
 assert.equal(await buttons.nth(10).isDisabled(),true,'Group needs multiple selected components');
 await chooseArea('Header');
 assert.equal(await buttons.count(),0,'Dimensions commands collapse while another section is open');
 await page.getByRole('button',{name:'Dimensions & Alignment',exact:true}).click();
 assert.equal(await buttons.count(),15,'Dimensions commands must return when expanded');
 const coord=async(axis)=>arrangeOne.evaluate((node,axis)=>
  Number.parseFloat(axis==='x'?node.style.left:node.style.top),axis);
 for(const [index,axis,expected] of [
   [0,'x',0],[1,'x',560],[2,'x',1120],
   [3,'y',0],[4,'y',370],[5,'y',740]
 ]){
  assert.equal(await buttons.nth(index).isDisabled(),false,'Alignment action is disabled');
  await buttons.nth(index).click();
  assert.equal(await coord(axis),expected,
   actionLabels[index]+' did not reposition the selected canvas component');
 }
 assert.equal(await buttons.nth(8).isDisabled(),false,'Bring to front should be available');
 await buttons.nth(8).click();
 assert.equal(await buttons.nth(9).isDisabled(),false,'Send backward should be available after moving to front');
 await buttons.nth(9).click();
 assert.equal(await buttons.nth(12).isDisabled(),false,'Lock must be usable in Body');
 await buttons.nth(12).click();
 assert.equal(await buttons.nth(12).getAttribute('aria-pressed'),'true');
 assert.equal(await buttons.nth(0).isDisabled(),true,'Locked component must not align');
 assert.equal(await buttons.nth(12).getAttribute('title'),'Unlock component');
 await buttons.nth(12).click();
 assert.equal(await buttons.nth(12).getAttribute('aria-pressed'),'false');
 assert.equal(await buttons.nth(0).isDisabled(),false,'Unlocked component must align again');
 await page.keyboard.press('Control+a');
 assert.equal(await page.locator('.record-component.multi-selected').count(),3,
  'All three page components must be selected for distribution and grouping');
 assert.equal(await buttons.nth(6).isDisabled(),false,'Horizontal distribution must enable with three');
 assert.equal(await buttons.nth(7).isDisabled(),false,'Vertical distribution must enable with three');
 await buttons.nth(6).click();
 await buttons.nth(7).click();
 assert.equal(await buttons.nth(10).isDisabled(),false,'Group must enable with three unlocked siblings');
 await buttons.nth(10).click();
 // Regression: selecting a grouped Cart must still expose its own field icons.
 // Earlier code suppressed ALL icons whenever ribbonSelectedMembers.length > 1.
 const groupedCart=page.locator('[data-component-id="arrange-one"]').first();
 await groupedCart.click({position:{x:18,y:18}});
 assert.equal(await page.locator('.record-component.multi-selected').count(),3,
  'Clicking a grouped component must retain its grouped canvas selection');
 const groupedLabelIcon=groupedCart.locator('.canvas-data-icon-button[data-binding-property="label"]');
 await groupedLabelIcon.waitFor({state:'visible'});
 assert.ok(await groupedCart.locator('.canvas-data-icon-button').count()>1,
  'Grouped Smart Cart must keep its field-specific yellow icons');
 await groupedLabelIcon.click();
 await page.locator('.smart-data-active-binding').getByText('Cart title').waitFor({state:'visible'});
 const groupedFormula=page.locator('.smart-data-formula-input input').first();
 await groupedFormula.waitFor({state:'visible'});
 assert.equal(await groupedFormula.inputValue(),'E2E Cart',
  'Grouped Cart title icon must open its own label formula');
 assert.equal(await groupedFormula.isDisabled(),false,
  'Group selection must not disable the selected Cart field editor');
 await groupedFormula.fill('= "Group cart only"');
 // Updates must change the selected cart only, not grouped Smart Tabs siblings.
 const stagedGroupTitle=await page.locator('[data-component-id="arrange-one"] .smart-cart-header').innerText();
 assert.ok(stagedGroupTitle.includes('Group cart only'),
  'Selected Cart title must update without applying to grouped siblings');
 await page.getByRole('tab',{name:'Design',exact:true}).click();
 const dimensionToggle=page.getByRole('button',{name:'Dimensions & Alignment',exact:true});
 if(await dimensionToggle.getAttribute('aria-expanded')!=='true')await dimensionToggle.click();
 assert.equal(await buttons.nth(11).isDisabled(),false,'Ungroup must enable for a persisted canvas group');
 await buttons.nth(11).click();
 assert.equal(await buttons.nth(11).isDisabled(),true,'Ungroup must clear the canvas group');
 assert.equal(await buttons.nth(10).isDisabled(),true,
  'Ungroup correctly resets multi-selection to the chosen component');
 await page.keyboard.press('Control+a');
 assert.equal(await buttons.nth(10).isDisabled(),false,
  'Selecting the three ungrouped siblings must re-enable Group');
 assert.equal(await buttons.nth(13).isDisabled(),false,'Nesting action should be enabled');
 await buttons.nth(13).click();
 assert.equal(await page.getByRole('tab',{name:'Advanced',exact:true}).getAttribute('aria-selected'),'true',
  'Component nesting must open the existing Advanced nesting editor');
 // Verify the approximately 30% narrower dock stays free of horizontal
 // overflow in every Design area, with identical fixed icon positions.
 await page.getByRole('tab',{name:'Design',exact:true}).click();
 await dock.waitFor({state:'visible'});
 const dockWidth=await dock.evaluate(node=>node.getBoundingClientRect().width);
 assert.ok(Math.abs(dockWidth-308)<=2,
  'The inspector must be 308 CSS px (30% narrower than 440), found '+dockWidth);
 const assertDockGeometry=async(section)=>{
  const extent=await dock.evaluate(node=>({
   scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,
   overflowX:getComputedStyle(node).overflowX
  }));
  assert.ok(extent.scrollWidth<=extent.clientWidth+2,
   'Design dock horizontally overflows in '+section+': '+JSON.stringify(extent));
  assert.equal(extent.overflowX,'hidden','The dock must not display x-scroll');
  if(section!=='Extras'){
   assert.deepEqual(await design2GridFingerprint(),template,
    'Fixed icon locations changed in '+section);
  }
 };
 for(const section of ['Body','Header','Image','Badge']){
  await chooseArea(section);
  assert.equal(await dock.locator('.smart-design2-count').count(),0,
   'Count must not reappear in the '+section+' icon grid');
  await assertDockGeometry(section);
 }
 await chooseArea('Extras');
 assert.equal(await dock.locator('.smart-design2-count').count(),1);
 assert.equal(await dock.locator('.smart-design2-padding').count(),1);
 await assertDockGeometry('Extras');
 console.info('Compact Design dock: 16 fixed controls, Extras positions, no horizontal overflow');
 console.info('Design 2 browser E2E: original Design preserved; Row Bold persisted; Ctrl+A/Delete removes all selected, one Undo restores all');
}
