import assert from 'node:assert/strict';

export async function runFieldCatalogueBrowserCheck({page,origin,db,tenantId}){
 await page.goto(origin+'/une/setup/object-manager',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Object Manager',exact:true}).waitFor({timeout:15000});
 await page.getByRole('button',{name:/^(?:New Object|Create new object)$/}).first().click();
 const objectWizard=page.getByRole('dialog',{name:'New Custom Object'});
 await objectWizard.getByLabel('Label',{exact:true}).fill('Browser Fields');
 await objectWizard.getByLabel('Plural Label',{exact:true}).fill('Browser Fields');
 await objectWizard.getByLabel('Record Name Label',{exact:true}).fill('Field Name');
 const created=page.waitForResponse(r=>r.url().endsWith('/api/metadata/objects')&&r.request().method()==='POST');
 await objectWizard.getByRole('button',{name:'Save',exact:true}).click();
 const createdResponse=await created;
 assert.equal(createdResponse.status(),201,'Object Manager object create failed');
 const objectApi=(await createdResponse.json()).object?.apiName;
 assert.match(objectApi??'',/^[A-Za-z][A-Za-z0-9_]*__c$/,
  'Use the object API name persisted by the create endpoint, not a guessed display-label casing');
 await page.getByText('Object definition · Read only').waitFor({timeout:15000});
 const openField=async()=>{
  await page.getByRole('button',{name:'Object actions'}).click();
  await page.getByRole('button',{name:'New Field',exact:true}).click();
  const wizard=page.getByRole('dialog',{name:'New Field'});
  await wizard.waitFor({timeout:10000});
  return wizard;
 };
 const add=async(type,label,setup)=>{
  const wizard=await openField();
  await wizard.getByLabel('Data Type').selectOption({label:type});
  await wizard.getByRole('button',{name:'Next'}).click();
  await wizard.getByLabel('Field Label').fill(label);
  await setup(wizard);
  await wizard.getByRole('button',{name:'Next'}).click();
  await wizard.getByRole('button',{name:'Next'}).click();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/metadata/objects/'+objectApi+'/fields')
    &&r.request().method()==='POST');
  await wizard.getByRole('button',{name:'Save Field'}).click();
  assert.equal((await response).status(),201,'Field wizard save API failed for '+label);
  await wizard.waitFor({state:'detached',timeout:10000});
 };
 await add('Text','ERP External',async wizard=>{
  await wizard.getByLabel('External ID').check();
  await wizard.getByLabel('Treat uppercase and lowercase values as different').check();
  await wizard.getByLabel('Default Value').fill('EXT-1');
 });
 await add('Text','Ticket Code',async wizard=>{
  await wizard.getByLabel('Unique').check();
 });
 await add('Date/Time','Start At',async wizard=>{
  await wizard.getByLabel('Default Value').fill('2026-10-30T15:30');
 });
 const {rows}=await db.query("SELECT api_name,label,data_type,is_unique,external_id,case_sensitive,default_value FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 ORDER BY api_name",[tenantId,objectApi]);
 const ext=rows.find(f=>f.label==='ERP External');
 const unique=rows.find(f=>f.label==='Ticket Code');
 const datetime=rows.find(f=>f.label==='Start At');
 assert.ok(ext,'External ID field was not persisted via UI');
 assert.equal(ext.external_id,true);
 assert.equal(ext.is_unique,false,'External ID must not silently enforce Unique');
 assert.equal(ext.case_sensitive,true,'Nonunique External ID case sensitivity must persist');
 assert.equal(ext.default_value,'EXT-1');
 assert.ok(unique&&unique.is_unique,'Unique attribute not persisted');
 assert.ok(datetime&&datetime.data_type==='datetime'&&datetime.default_value.endsWith('Z'),
  'Local DateTime default was not normalized to UTC before API save');
 console.info('Phase 2B browser UI -> API -> SQL field defaults/unique/external ID passed');
}
