import assert from 'node:assert/strict';
/** Verify Object Manager and the authenticated graph endpoint in a real browser. */
export async function runRelationshipGraphBrowserCheck({page,origin,db,tenantId,token}){
 const built=new URL('../dist-system/system-files/',import.meta.url);
 const {ObjectDefinitionService}=await import(new URL('object-definition.js',built).href);
 const defs=new ObjectDefinitionService(db);
 const name=[{apiName:'Name',label:'Name',dataType:'Text(80)',required:true}];
 await defs.create(tenantId,'BrowserRelParent__c','Browser Relation Parent',name);
 await defs.create(tenantId,'BrowserRelChild__c','Browser Relation Child',name);
 for(const [fieldApi,relationName] of [['PrimaryParentId','PrimaryParent'],['ReviewParentId','ReviewParent']]){
  await defs.addField(tenantId,'BrowserRelChild__c',fieldApi,'Lookup(BrowserRelParent__c)',undefined,relationName,{
   relationship:{type:'Lookup',targetObject:'BrowserRelParent__c',relationshipName:relationName,
    childRelationshipName:relationName+'Children',deleteBehavior:'Clear'}
  });
 }
 await page.goto(origin+'/une/setup/object-manager',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Object Manager',exact:true}).waitFor({timeout:20000});
 const child=page.getByRole('row').filter({hasText:'BrowserRelChild__c'});
 await child.getByRole('link',{name:'Browser Relation Child',exact:true}).click();
 await page.getByRole('button',{name:'Fields & Relationships'}).click();
 await page.getByText('PrimaryParentId',{exact:true}).waitFor({timeout:15000});
 await page.getByText('ReviewParentId',{exact:true}).waitFor({timeout:15000});
 await page.getByRole('button',{name:'Object actions'}).click();
 await page.getByRole('button',{name:'New Field',exact:true}).click();
 const wizard=page.getByRole('dialog',{name:'New Field'});
 await wizard.getByLabel('Data Type').selectOption({label:'Lookup Relationship'});
 await wizard.getByRole('button',{name:'Next'}).click();
 const selfOption=wizard.getByLabel('Related Object').locator('option[value="BrowserRelChild__c"]');
 assert.equal(await selfOption.count(),1,'Object Manager must offer an object as its own lookup target');

 const graph=await page.evaluate(async token=>{
  const response=await fetch('/api/metadata/relationships?objectApi=BrowserRelParent__c',{
   headers:{Authorization:'Bearer '+token}
  });
  return {status:response.status,cache:response.headers.get('cache-control'),
   body:await response.json()};
 },token);
 assert.equal(graph.status,200,'Authenticated relationship graph API failed');
 assert.match(graph.cache??'',/no-store/);
 assert.deepEqual(graph.body.relationships.filter(x=>x.sourceObject==='BrowserRelChild__c')
  .map(x=>x.fieldApiName),['PrimaryParentId','ReviewParentId']);
 assert.deepEqual(graph.body.relationships.filter(x=>x.sourceObject==='BrowserRelChild__c')
  .map(x=>x.childRelationshipName),['PrimaryParentChildren','ReviewParentChildren']);
 const forbidden=await page.evaluate(async ()=>{
  const response=await fetch('/api/metadata/relationships?objectApi=BrowserRelParent__c');
  return response.status;
 });
 assert.ok(forbidden===401||forbidden===403,'Unauthenticated relationship metadata must not be public');
 console.info('Phase 2C Chromium Object Manager and scoped relationship API passed');
}
