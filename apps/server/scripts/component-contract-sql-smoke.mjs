import {readBaselineMigration} from './baseline-sql-section.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {ComponentLibraryService} from '../dist-system/system-support/component-library-service.js';
import {RbacEngine} from '../dist-system/system-files/rbac-engine.js';
import {readComponentContract,validatePageComponentContracts} from '../dist-system/system-support/component-contract-store.js';

/** Runs inside the existing disposable SQL smoke fixture, with real central RBAC. */
export async function componentContractSqlSmoke(db,tenant,user,permissionSet){
 const service=new ComponentLibraryService(db,new RbacEngine(db));
 await assert.rejects(()=>service.list(tenant,user),/Permission denied/);
 for(const action of ['create','manage','read'])await db.query(`INSERT INTO md_permission_rules
  (tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'ComponentDefinition',$3,'allow')`,
  [tenant,permissionSet,action]);
 const propertyDefinitions=[{propertyKey:'settings',label:'Settings',kind:'GROUP',schemaVersion:1,defaultValue:{},fields:[
  {propertyKey:'count',label:'Count',kind:'NUMBER',min:0,max:10,defaultValue:0},
  {propertyKey:'enabled',label:'Enabled',kind:'BOOLEAN',defaultValue:false}
 ]}];
 const eventDefinitions=[{apiName:'select',label:'Select'}];
 const input={apiName:'ContractSmokeCard',label:'Contract smoke card',description:'',surfaces:['page'],
  resize:{defaultWidth:320,defaultHeight:180,minWidth:10,minHeight:10},jsxSource:'',cssSource:'',publicationStatus:'Draft'};
 const created=await service.save(tenant,user,{...input,propertyDefinitions,eventDefinitions});
 assert.deepEqual(created.propertyDefinitions,propertyDefinitions);
 const published=await service.publish(tenant,user,input.apiName);
 assert.equal(published.version,2);
 assert.deepEqual(published.eventDefinitions,eventDefinitions);
 // Omission retains schemas; clearing a draft cannot change the published schema.
 const draft=await service.save(tenant,user,input,input.apiName);
 assert.deepEqual(draft.propertyDefinitions,propertyDefinitions);
 const cleared=await service.save(tenant,user,{...input,propertyDefinitions:[]},input.apiName);
 assert.deepEqual(cleared.propertyDefinitions,[]);
 assert.deepEqual(cleared.eventDefinitions,eventDefinitions);
 await assert.rejects(()=>validatePageComponentContracts(db,tenant,[{
  type:'Custom:'+input.apiName,properties:{settings:{count:11}}
 }],'Desktop'),/settings.count/);
 await validatePageComponentContracts(db,tenant,[{
  type:'Custom:'+input.apiName,properties:{settings:{count:0,enabled:false,legacy:''},unknown:'keep'}
 }],'Mobile');
 const restored=await service.publish(tenant,user,input.apiName,1);
 assert.deepEqual(restored.propertyDefinitions,propertyDefinitions);
 assert.deepEqual(restored.eventDefinitions,eventDefinitions);
 assert.deepEqual(await readComponentContract(db,randomUUID(),input.apiName,restored.version),{});
 // Replaying the additive DDL preserves populated, version-owned schema rows.
 const ddl=await readBaselineMigration('20270107-component-property-contract.sql');
 await db.query(ddl);await db.query(ddl);
 assert.deepEqual(await readComponentContract(db,tenant,input.apiName,restored.version),{propertyDefinitions,eventDefinitions});
 console.info('Component contract SQL lifecycle, RBAC, tenant isolation and DDL replay: passed');
}
