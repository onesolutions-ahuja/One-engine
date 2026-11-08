import assert from 'node:assert/strict';

/** Authenticated UI regression for archived Page identity collisions. */
export async function runPageCreateBrowserCheck({page,origin,db,tenantId,token}){
 await page.goto(origin+'/une/setup/page-builder',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'New Page',exact:true}).waitFor({timeout:20000});
 // Reproduce an archived page API name hidden from Page Manager. The Create
 // draft modal must create a fresh Page, not PUT/update the archived identity.
 const archivedPageProbe=await page.evaluate(async({token})=>{
   const name='browser_archived_kiosk';
   const payload={apiName:name,label:'Browser Archived Kiosk',targetObject:'',
     pageType:'App Page',layoutMode:'free-canvas',canvasWidth:1440,canvasHeight:900,
     status:'Draft',devices:['Desktop'],components:[],activationAssignments:[]};
   const request=async(path,method,body)=>fetch('/api'+path,{method,
     headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
     ...(body?{body:JSON.stringify(body)}:{})});
   const create=await request('/metadata/pages','POST',payload);
   const remove=create.status===201?await request('/metadata/pages/'+name,'DELETE'):null;
   return {create:create.status,remove:remove?.status};
 },{token});
 assert.deepEqual(archivedPageProbe,{create:201,remove:204});
 const createDialogOpened=page.getByRole('dialog',{name:'Create a page'});
 await page.getByRole('button',{name:'New Page',exact:true}).click();
 await createDialogOpened.getByLabel('Page name').fill('Browser Archived Kiosk');
 await createDialogOpened.locator('input[type="radio"][value="App Page"]').check();
 const createdPageResponse=page.waitForResponse(response=>
   new URL(response.url()).pathname==='/api/metadata/pages'
   && response.request().method()==='POST'&&response.status()===201);
 await createDialogOpened.getByRole('button',{name:'Create draft'}).click();
 assert.equal((await createdPageResponse).status(),201,
   'New Page dialog did not use the create-only endpoint');
 await createDialogOpened.waitFor({state:'hidden'});
 const archivedCheck=await db.query(`SELECT enabled,title FROM md_page_definitions
   WHERE tenant_id=$1 AND api_name='browser_archived_kiosk'`,[tenantId]);
 assert.deepEqual(archivedCheck.rows,[{enabled:false,title:'Browser Archived Kiosk'}],
   'New Page dialog modified an archived Page');
 const createdCheck=await db.query(`SELECT p.api_name,d.page_type,d.status FROM md_page_definitions p
   JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
   WHERE p.tenant_id=$1 AND p.api_name='browser_archived_kiosk_2' AND p.enabled=true`,[tenantId]);
 assert.equal(createdCheck.rows.length,1,'New Page dialog did not create a distinct Page');
 assert.equal(createdCheck.rows[0].page_type,'App Page');
 assert.equal(createdCheck.rows[0].status,'Draft');
 console.info('Archived Page name collision through Create draft UI: passed');

}
