import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// A disposable database provides an independent SQL-to-API-service check.
// Never run this smoke test against a production or shared database.
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||!url.includes('/metadrive_2a'))
 throw new Error('Object lifecycle SQL smoke requires a disposable metadrive_2a database');
const built=new URL('../dist-system/system-files/',import.meta.url);
const support=new URL('../dist-system/system-support/',import.meta.url);
const [{SqlPersistence},{applySystemMigrations},{ObjectDefinitionService},{ObjectSchemaLifecycle},
 {RecordEngine},{RbacEngine}]=await Promise.all([
 import(new URL('sql-persistence.js',built).href),
 import(new URL('system-migrations.js',support).href),
 import(new URL('object-definition.js',built).href),
 import(new URL('object-schema-lifecycle.js',built).href),
 import(new URL('record-engine.js',built).href),
 import(new URL('rbac-engine.js',built).href)
]);
const db=new SqlPersistence(url);
try{
 const schema=readFileSync(fileURLToPath(new URL('../src/system-files/schema.sql',import.meta.url)),'utf8');
 await db.query(schema);
 await applySystemMigrations(db);

 // Execute the SQL templates against actual PostgreSQL (not a mock).
 // This verifies all 38 stand-alone scalar functions; SUM/record functions
 // require Record Engine authorization and are tested through their own path.
 const sqlFormula=new URL('../dist-system/expression-engine/',import.meta.url);
 const [{Parser},{tokenize},{compileFormulaSql}]=await Promise.all([
  import(new URL('FormulaParser.js',sqlFormula).href),
  import(new URL('FormulaTokenizer.js',sqlFormula).href),
  import(new URL('FormulaSqlCompiler.js',sqlFormula).href)
 ]);
 const formulaExamples=[
  ['ISBLANK("")',true],['ISNULL(NULL)',true],['ISNUMBER("12.5")',true],
  ['TEXT(42)','42'],['VALUE("3.25")',3.25],['LEN("abcd")',4],
  ['LOWER("HeLLo")','hello'],['UPPER("test")','TEST'],
  ['PROPER("hELLO WORLD")','Hello World'],['LEFT("hello",2)','he'],
  ['RIGHT("hello",2)','lo'],['FIND("el","hello")',2],
  ['CONTAINS("hello","el")',true],['BEGINS("hello","he")',true],
  ['ISPICKVAL("A","A")',true],['INCLUDES("A;B","B")',true],
  ['ROUND(2.555,2)',2.56],['ROUNDUP(-1.2,0)',-2],
  ['ROUNDDOWN(-1.8,0)',-1],['MIN(5,2,3)',2],['MAX(5,2,3)',5],
  ['DATE(2024,2,29)','2024-02-29'],
  ['DATEVALUE("2024-02-29")','2024-02-29'],
  ['TODAY()',/^\d{4}-\d{2}-\d{2}$/],
  ['NOW()',/^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d\.\d{3}Z$/],
  ['DAY("2024-02-29")',29],['MONTH("2024-02-29")',2],
  ['YEAR("2024-02-29")',2024],
  ['HOUR("2024-02-29T13:45:20")',13],
  ['MINUTE("2024-02-29T13:45:20")',45],
  ['SECOND("2024-02-29T13:45:20")',20],
  ['WEEKDAY("2024-02-25")',1],
  ['ADDDAYS("2024-02-28",1)','2024-02-29'],
  ['ADDMONTHS("2024-01-31",1)','2024-02-29'],
  ['TIMEVALUE("13:45:20")','13:45:20.000'],
  ['TIMENOW()',/^\d\d:\d\d:\d\d\.\d{3}$/],
  ['GEOLOCATION(51.5,-0.1)',{latitude:51.5,longitude:-0.1}],
  ['DISTANCE(GEOLOCATION(0,0),GEOLOCATION(0,1),"km")',111.195]
 ];
 const seenFormulaNames=new Set();
 for(const [formula,expected] of formulaExamples){
  seenFormulaNames.add(formula.match(/^[A-Z]+/)?.[0]);
  const params=[];
  const sql=compileFormulaSql(new Parser(tokenize(formula)).parse(),{
   bind(value){params.push(value);return '$'+params.length;},
   field(){throw Error('A scalar SQL formula must not fetch an unbound field');},
   sum(){throw Error('SUM requires Record Engine authorization');},
   timeZone:"'UTC'"
  });
  const {rows}=await db.query('SELECT to_jsonb(('+sql+')) AS value',params);
  const actual=rows[0]?.value;
  if(expected instanceof RegExp)assert.match(actual,expected,formula);
  else if(formula.startsWith('DISTANCE('))assert(Math.abs(actual-expected)<0.01,formula);
  else assert.deepEqual(actual,expected,formula);
 }
 assert.equal(seenFormulaNames.size,38,'Every non-SUM scalar SQL function must have real PostgreSQL coverage');
 console.info('SQL Formula compiler: 38/38 scalar functions executed against PostgreSQL');

 // The Record/Validation/Default services resolve authorised values once and
 // submit selected scalar formulas as parameterised PostgreSQL expressions.
 const {evaluateResolvedFormulaSql}=await import(new URL(
  '../dist-system/system-support/formula-sql-runtime.js',import.meta.url).href);
 const scoped={
  timeZone:'UTC',now:'2024-02-29T12:34:56.000Z'
 };
 const delegatedCases=[
  ['LOWER(@Name)','hello',{Name:'HELLO'}],
  ['IF(ISNUMBER(@Amount),ROUND(@Amount,1),0)',12.3,{Amount:12.34}],
  ['IFERROR(VALUE("bad"),UPPER("fallback"))','FALLBACK',{}],
  ['TODAY()','2024-02-29',{}],
  ['NOW()','2024-02-29T12:34:56.000Z',{}],
  ['GEOLOCATION(51.5,-0.1)',{latitude:51.5,longitude:-0.1},{}],
  ['SUM(COLLECTION("Numbers",2,3,5))',10,{},'flow_formula']
 ];
 for(const [formula,expected,values,argumentsContext] of delegatedCases){
  const value=await evaluateResolvedFormulaSql(db,formula,
   ref=>values[ref]??null,scoped,argumentsContext??'formula_field');
  assert.deepEqual(value,expected,formula);
 }
 console.info('Authorised Record/Validation/Default formula SQL delegation passed real PostgreSQL');

 const {simulateFlowGraph}=await import(new URL('../dist-system/flow-engine/FlowDebugger.js',import.meta.url).href);
 const debug=await simulateFlowGraph({
  apiName:'SqlFlowSmoke',version:1,flowType:'Autolaunched Flow',recordTriggered:false,
  nodes:[{id:1,type:'Start',config:{}},{id:2,type:'End',config:{}}],
  edges:[{from:1,to:2,kind:'normal'}],inputs:{},
  resources:[{name:'Lowered',type:'Formula',dataType:'Text',value:'LOWER("HELLO")'}],
  formulaContext:{timeZone:'UTC'},
  evaluateSql:(expression,resolver,ctx)=>evaluateResolvedFormulaSql(
   db,expression,resolver,ctx,'flow_formula')
 });
 assert.equal(debug.status,'completed');
 assert.equal(debug.variables.Lowered,'hello','Flow debug resources must execute SQL');
 console.info('Flow debug Formula resource delegated to SQL through isolated PostgreSQL');


 const defs=new ObjectDefinitionService(db);
 const lifecycle=new ObjectSchemaLifecycle(db);
 const tenants=[];
 for(const slug of ['phase-2a-primary','phase-2a-secondary']){
  const result=await db.query('INSERT INTO md_tenants(slug,name) VALUES($1,$2) RETURNING id',[slug,slug]);
  tenants.push(result.rows[0].id);
 }
 const [primary,secondary]=tenants;
 // A user with full permissions must still lose record access while the object
 // is in the object recycle bin, and regain access after object restoration.
 const actor=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'object-lifecycle@example.invalid','fixture') RETURNING id",[primary])).rows[0].id;
 const set=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'ObjectLifecycle') RETURNING id",[primary])).rows[0].id;
 await db.query("INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)",[primary,actor,set]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",[primary,set]);
 const fields=[{apiName:'Name',label:'Name',dataType:'Text(80)',required:true}];
 for(const name of ['Milestone__c','Invoice__c']){
  const object=await defs.create(primary,name,name.replace('__c',''),fields);
  assert.equal(object.fields.length,1);
 }
 await defs.create(secondary,'Invoice__c','Other Tenant Invoice',fields);
 // Rename label and keep stable API name, ID and layout using the supported revision contract.
 const invoice=await defs.get(primary,'Invoice__c');
 const modified=await defs.replaceLayouts(primary,'Invoice__c',{
  ...invoice,label:'Customer Invoice'
 },invoice.revision??0);
 assert.equal(modified.label,'Customer Invoice');
 assert.equal(modified.apiName,'Invoice__c');
 assert.equal(modified.id,invoice.id);
 assert.equal(modified.fields[0].apiName,'Name');
 // Recoverable object deletion retains both live and recycled records.
 const record=await db.query("INSERT INTO md_records(tenant_id,object_api) VALUES($1,'Milestone__c') RETURNING id",[primary]);
 const recycled=await db.query("INSERT INTO md_records(tenant_id,object_api,is_deleted) VALUES($1,'Milestone__c',true) RETURNING id",[primary]);
 const recordEngine=new RecordEngine(db,new RbacEngine(db));

 // Actual SQL-backed Record Engine integration: SUM + five filtered aggregates.
 const formulaObject='FormulaProbe__c';
 await defs.create(primary,formulaObject,'Formula Probe',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'Total',label:'Total',dataType:'Number(12,2)'},
  {apiName:'Status',label:'Status',dataType:'Text(32)'}
 ]);
 const inputRecords=[
  {Name:'first',Total:10,Status:'Active'},
  {Name:'second',Total:20,Status:'Active'},
  {Name:'third',Total:5,Status:'Inactive'}
 ];
 const formulaRecordIds=[];
 for(const values of inputRecords)formulaRecordIds.push(await recordEngine.create(primary,actor,formulaObject,values));
 const {evaluateFormulaSql}=await import(new URL(
  '../dist-system/system-support/formula-sql-runtime.js',import.meta.url).href);
 const sqlActor={tenant_id:primary,user_id:actor};
 const formulaRights=new RbacEngine(db);
 const aggregatorCases=[
  ['SUM(@FormulaProbe__c.Total)',35],
  ['COUNTIFS(FormulaProbe__c,Status,"Active")',2],
  ['SUMIFS(FormulaProbe__c,Total,Status,"Active")',30],
  ['AVERAGEIFS(FormulaProbe__c,Total,Status,"Active")',15],
  ['MINIFS(FormulaProbe__c,Total,Status,"Active")',10],
  ['MAXIFS(FormulaProbe__c,Total,Status,"Active")',20]
 ];
 for(const [formula,expected] of aggregatorCases){
  const result=await evaluateFormulaSql(db,formulaRights,recordEngine,sqlActor,{formula});
  assert.equal(result,expected,formula);
 }
 // Metadata-backed SQL formulas must read the authorized row from SQL and reject missing rows.
 const fieldResult=await evaluateFormulaSql(db,formulaRights,recordEngine,sqlActor,{
  formula:'LOWER(@FormulaProbe__c.Name)',objectApi:formulaObject,recordId:formulaRecordIds[0]
 });
 assert.equal(fieldResult,'first','A real metadata-bound formula must run through SQL');
 const numericField=await evaluateFormulaSql(db,formulaRights,recordEngine,sqlActor,{
  formula:'ROUND(@FormulaProbe__c.Total,2)',objectApi:formulaObject,recordId:formulaRecordIds[0]
 });
 assert.equal(numericField,10);
 await assert.rejects(()=>evaluateFormulaSql(db,formulaRights,recordEngine,sqlActor,{
  formula:'LOWER(@FormulaProbe__c.Name)',objectApi:formulaObject,
  recordId:'99999999-9999-4999-8999-999999999999'
 }),/unavailable|permission denied/);
 // Four accepted CRUD formulas must use the shared, permission-checked Record API.
 const {executeServerDataAction}=await import(new URL(
  '../dist-system/system-support/formula-data-action-runtime.js',import.meta.url).href);
 const executeCrud=async formula=>{
  const result=await executeServerDataAction(db,recordEngine,sqlActor,formula,{},1);
  assert.equal(result.supported,true,formula);
  assert.equal(result.error,undefined,formula);
  return result;
 };
 const {executeServerDataAction:executeSqlDataAction}=await import(new URL(
  '../dist-system/system-support/formula-data-action-runtime.js',import.meta.url).href);
 const roundedResult=await executeSqlDataAction(db,recordEngine,sqlActor,
  'CREATERECORD(FormulaProbe__c,Name,"roundtrip",Total,ROUND(12.345,2))',{},1,formulaRights);
 assert.equal(roundedResult.supported,true);
 assert.equal(roundedResult.error,undefined);
 const roundedRecords=(await recordEngine.list(primary,actor,formulaObject,10,0,{
  filters:[{field:'Name',operator:'eq',value:'roundtrip'}]
 })).records;
 assert.equal(roundedRecords.length,1);
 assert.equal(roundedRecords[0].Total,12.35);

 const aliasSql=await executeSqlDataAction(db,recordEngine,sqlActor,
  'ACTIONS(GETRECORD(FormulaProbe__c,Name,"first",AS(row)),'+
  'UPDATERECORD(FormulaProbe__c,row.Id,Total,ROUND(row.Total * 1.025,2)))',{},2,formulaRights);
 assert.equal(aliasSql.supported,true);
 assert.equal(aliasSql.error,undefined,'Existing Record aliases must execute scalar SQL');
 const firstRow=(await recordEngine.list(primary,actor,formulaObject,10,0,{
  filters:[{field:'Name',operator:'eq',value:'first'}]
 })).records[0];
 assert.equal(firstRow.Total,10.25);


 const created=await executeCrud('CREATERECORD(FormulaProbe__c,Name,"temporary",Total,7)');
 assert.equal(created.recordChanged,true);
 const scratch=(await recordEngine.list(primary,actor,formulaObject,10,0,{
  filters:[{field:'Name',operator:'eq',value:'temporary'}]
 })).records;
 assert.equal(scratch.length,1);
 const scratchId=scratch[0].Id;
 await executeCrud('UPDATERECORD(FormulaProbe__c,"'+scratchId+'",Name,"updated")');
 assert.equal((await recordEngine.get(primary,actor,formulaObject,scratchId)).Name,'updated');
 const retrieved=await executeCrud('GETRECORD(FormulaProbe__c,Name,"updated",AS(found))');
 assert.equal(retrieved.variables?.found?.Id,scratchId);
 await executeCrud('DELETERECORD(FormulaProbe__c,"'+scratchId+'")');
 await assert.rejects(()=>recordEngine.get(primary,actor,formulaObject,scratchId),/not found|deleted|unavailable/i);
 console.info('SQL Formula: SUM + five filtered aggregates + four Record API actions passed real PostgreSQL');

 assert.equal((await lifecycle.impact(primary,'Milestone__c')).recordCount,2);
 // Declarative cross-object relationship on a different object blocks deletion.
 await db.query(`INSERT INTO md_field_definitions
  (tenant_id,object_api,api_name,label,data_type,related_object,relationship_type)
  VALUES($1,'Invoice__c','MilestoneRef','Milestone Reference','reference','Milestone__c','Lookup')`,[primary]);
 const impact=await lifecycle.impact(primary,'Milestone__c');
 assert.ok(impact.blockers.some(x=>x.kind==='Inbound relationships'));
 await assert.rejects(()=>lifecycle.delete(primary,'Milestone__c',0),/Inbound relationships/);
 await db.query(`DELETE FROM md_field_definitions WHERE tenant_id=$1
  AND object_api='Invoice__c' AND api_name='MilestoneRef'`,[primary]);
 // Recoverable deletion preserves all definitions and reserves the API name.
 const visibility=async id=>(await db.query(
  "SELECT md_record_access($1,$2,$3,'read') AS allowed",
  [primary,actor,id])).rows[0].allowed;
 assert.equal(await visibility(record.rows[0].id),true,
  'Active object records must remain accessible with proper grants');
 const deleted=await lifecycle.delete(primary,'Milestone__c',0);
 assert.equal(deleted.deleted,true);
 const invisible=await db.query("SELECT md_record_access($1,$2,$3,'read') AS visible",
  [primary,actor,record.rows[0].id]);
 assert.equal(invisible.rows[0].visible,false,'Deleted object must hide every preserved record');
 await assert.rejects(()=>defs.get(primary,'Milestone__c'),/Object not found/);
 assert.equal((await lifecycle.listDeleted(primary)).length,1);
 await assert.rejects(()=>defs.create(primary,'Milestone__c','Duplicate',fields),/API Name already exists|already exists/);
 await assert.rejects(()=>db.query("INSERT INTO md_records(tenant_id,object_api) VALUES($1,'Milestone__c')",[primary]),
  /Object is unavailable/);
 await lifecycle.restore(primary,'Milestone__c');
 assert.equal(await visibility(record.rows[0].id),true,
  'Restored object record read access must return without modifying the record');
 await recordEngine.update(primary,actor,'Milestone__c',record.rows[0].id,{Name:'Preserved Record'});
 assert.equal((await recordEngine.get(primary,actor,'Milestone__c',record.rows[0].id)).Name,
  'Preserved Record','Record updates must work again after object restore');
 const preserved=await db.query('SELECT id,is_deleted FROM md_records WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
  [primary,[record.rows[0].id,recycled.rows[0].id]]);
 assert.equal(preserved.rows.length,2);
 assert.equal(preserved.rows.filter(row=>row.is_deleted).length,1);
 assert.equal((await defs.get(primary,'Milestone__c')).fields[0].apiName,'Name');
 const singlePreserved=await db.query('SELECT id,is_deleted FROM md_records WHERE tenant_id=$1 AND id=$2',
  [primary,record.rows[0].id]);
 assert.equal(singlePreserved.rows[0]?.id,record.rows[0].id,
  'Restore must recover the original record identity');
 assert.equal(singlePreserved.rows[0]?.is_deleted,false);
 const restoredVisibility=await db.query("SELECT md_record_access($1,$2,$3,'read') AS visible",
  [primary,actor,record.rows[0].id]);
 assert.equal(restoredVisibility.rows[0].visible,true,'Restore must recover record visibility');
 assert.equal((await lifecycle.listDeleted(primary)).length,0);
 // A separate tenant can independently delete/recover the same API name.
 const first=await lifecycle.delete(primary,'Invoice__c',1);
 assert.equal(first.deleted,true);
 assert.equal((await defs.get(secondary,'Invoice__c')).label,'Other Tenant Invoice');
 await lifecycle.restore(primary,'Invoice__c');
 await assert.rejects(()=>lifecycle.impact(secondary,'Milestone__c'),/Object not found/);
 assert.equal((await defs.get(primary,'Invoice__c')).label,'Customer Invoice');
 // The shared casefold migration must also preserve tenant FKs and business records.
 const {runApiCasefoldSqlSmoke}=await import('./api-casefold-sql-smoke.mjs');
 await runApiCasefoldSqlSmoke(db);
 console.info('Phase 2A disposable SQL lifecycle smoke: passed (2 objects, 2 tenants, record preservation/relationship blocks, label revision, restore)');
}finally{await db.close();}
