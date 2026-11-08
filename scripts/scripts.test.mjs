// Canonical test archive: one file, original test modules run with their own Node isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const SOURCES=[["scripts/cart/cart-legacy-references.test.mjs","import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {hasLegacyCartReference,rewriteLegacyCartText,rewriteLegacyCartFlow,rewriteLegacyCartPage} from './cart-legacy-references.mjs';\nimport {canDeferOrderCartSessionRetirement,ORDER_LOOKUP_BLOCKER} from './order-cart-session-retirement-guard.mjs';\n\ntest('Formula GETRECORD uses selected cart, not ambiguous browser SessionKey',()=>{\n assert.equal(rewriteLegacyCartText('=GETRECORD(CartSession, SessionKey, $session.id, AS(cart))'),\n  '=GETRECORD(Cart, Id, $session.cartId, AS(cart))');\n assert.equal(rewriteLegacyCartText('=GETRECORD(\"CartSession\", \"SessionKey\", $session, AS(cart))'),\n  '=GETRECORD(Cart, Id, $session.cartId, AS(cart))');\n assert.equal(rewriteLegacyCartText('=GETRECORD(CartSession, SessionKey, {!sessionKey}, AS(cart))'),\n  '=GETRECORD(Cart, Id, {!cartId}, AS(cart))');\n assert.equal(rewriteLegacyCartText('=GETRECORD(CartSession, SessionKey, anything, AS(cart))',{page:true}),\n  '=GETRECORD(Cart, Id, $session.cartId, AS(cart))');\n assert.equal(rewriteLegacyCartText('=COUNTIFS(CartSession, Status, \"Open\", UserId, $session.user.id)'),\n  '=COUNTIFS(Cart, Status, \"Open\", UserId, $session.user.id)');\n assert.equal(rewriteLegacyCartText('=$state.cartSessionId & CartLine.CartSession'),\n  '=$state.activeCartId & CartLine.Cart');\n assert.equal(rewriteLegacyCartText('Open carts use $session.user.id'), 'Open carts use $session.user.id');\n});\ntest('custom Flow preserves other nodes, changes SessionKey single lookup, CartLine parent, ownership',()=>{\n const original={\n  apiName:'CustomCashierFlow',resources:[{name:'cartSessionId',type:'Variable',dataType:'Text',availableForOutput:true}],\n  elements:[\n   {id:1,type:'Get Records',config:{object:'CartSession',recordLimit:'1',outputVariable:'basket',\n    conditions:[{field:'SessionKey',operator:'Equals',value:'{!sessionKey}'}]}},\n   {id:2,type:'Create Records',config:{object:'CartSession',fieldValues:[{field:'Status',value:'Open'}]}},\n   {id:3,type:'Create Records',config:{object:'CartLine',fieldValues:[{field:'CartSession',value:'{!cartSessionId}'}]}},\n   {id:4,type:'Assignment',config:{variable:'foo',value:'unrelated'}},\n  ],connectors:[{from:1,to:2},{from:2,to:3},{from:3,to:4}],\n  customExtensions:{formula:'=GETRECORD(CartSession, SessionKey, $session, AS(cart))'}\n };\n const result=rewriteLegacyCartFlow(original);\n assert.equal(result.changed,true);\n assert.deepEqual(result.graph.elements[0].config.conditions,[\n  {field:'Id',operator:'Equals',value:'{!cartId}'},\n  {field:'UserId',operator:'Equals',value:'{!$User.Id}'}\n ]);\n assert.ok(result.graph.elements[1].config.fieldValues.some(f=>f.field==='UserId'));\n assert.equal(result.graph.elements[2].config.fieldValues[0].field,'Cart');\n assert.equal(result.graph.elements[2].config.fieldValues[0].value,'{!cartId}');\n assert.equal(result.graph.elements[3].config.value,'unrelated');\n assert.ok(result.graph.resources.some(v=>v.name==='cartId'&&v.availableForInput));\n assert.ok(!hasLegacyCartReference(JSON.stringify(result.graph)));\n assert.ok(hasLegacyCartReference(JSON.stringify(original)),'never mutate customer graph');\n assert.equal(rewriteLegacyCartFlow(result.graph).changed,false);\n});\ntest('page metadata rewrites saved card grid, formula, output state without clobbering custom fields',()=>{\n const original={components:[{id:'grid',properties:{objectApiName:'CartSession',\n  relatedFieldApiName:'CartSession',relatedFilterKey:'cartSessionId',\n  autoRecordScope:true,otherFormula:'=GETRECORD(CartSession, SessionKey, $session.id, AS(c))',\n  actionFlows:{click:{flowApiName:'CustomFlow',inputs:{cartSessionId:'$state.cartSessionId'},\n  outputs:{cartSessionId:'cartSessionId'}},hello:{other:'untouched'}}}}]};\n const {page,changed}=rewriteLegacyCartPage(original);\n assert.equal(changed,true);\n const p=page.components[0].properties;\n assert.equal(p.objectApiName,'Cart');\n assert.equal(p.relatedFilterKey,'activeCartId');\n assert.equal(p.relatedFieldApiName,'Cart');\n assert.equal(p.autoRecordScope,false);\n assert.equal(p.actionFlows.click.inputs.cartId,'$session.cartId');\n assert.equal(p.actionFlows.click.outputs.cartId,'activeCartId');\n assert.equal(p.actionFlows.hello.other,'untouched');\n assert.ok(!hasLegacyCartReference(JSON.stringify(page)));\n assert.equal(rewriteLegacyCartPage(page).changed,false);\n});\ntest('unknown resource collisions stop conversion rather than drop Flow/Page state',()=>{\n assert.throws(()=>rewriteLegacyCartFlow({elements:[],resources:[],\n  variables:{cartSessionId:'a',cartId:'b'}}),/collides/);\n assert.throws(()=>rewriteLegacyCartPage({components:[],cartSessionId:'a',activeCartId:'b'}),/collides/);\n});\n\ntest('literal stored CartSession record identifiers resolve to their migrated Cart IDs',()=>{\n const from='11111111-1111-4111-8111-111111111111';\n const to='22222222-2222-4222-8222-222222222222';\n const cartIds=new Map([[from,to]]);\n assert.equal(rewriteLegacyCartText('=GETRECORD(CartSession,Id,\"'+from+'\",AS(c))',{cartIds}),\n  '=GETRECORD(Cart,Id,\"'+to+'\",AS(c))');\n const custom={apiName:'UserAuthored',elements:[{id:2,type:'Get Records',\n  config:{object:'Cart',conditions:[{field:'Id',operator:'Equals',value:from}]}}]};\n assert.equal(rewriteLegacyCartFlow(custom,{cartIds}).graph.elements[0].config.conditions[0].value,to);\n assert.equal(rewriteLegacyCartPage({components:[],formula:'=REF(\"'+from+'\")'},{cartIds}).page.formula,\n  '=REF(\"'+to+'\")');\n});\n\ntest('page draft migration preserves Date metadata and other non-plain runtime values',()=>{\n const updatedAt=new Date('2026-11-07T08:00:00Z');\n const source={updatedAt,components:[{properties:{formula:'=CartSession.Status'}}]};\n const {page}=rewriteLegacyCartPage(source);\n assert.ok(page.updatedAt instanceof Date);\n assert.equal(page.updatedAt.toISOString(),updatedAt.toISOString());\n assert.equal(page.components[0].properties.formula,'=Cart.Status');\n});\n\ntest('all-carts Flow keeps multiple carts but filters by signed-in user',()=>{\n const graph={apiName:'ListMyCarts',resources:[],elements:[{id:1,type:'Get Records',\n  config:{object:'CartSession',recordLimit:'all',conditions:[\n   {field:'Status',operator:'NotEqual',value:'Completed'}]}}]};\n const {graph:updated}=rewriteLegacyCartFlow(graph);\n assert.equal(updated.elements[0].config.object,'Cart');\n assert.equal(updated.elements[0].config.recordLimit,'all');\n assert.deepEqual(updated.elements[0].config.conditions,[\n  {field:'Status',operator:'NotEqual',value:'Completed'},\n  {field:'UserId',operator:'Equals',value:'{!$User.Id}'}\n ]);\n});\n\ntest('custom Flow API names remain callable after CartSession object retirement',()=>{\n const graph={apiName:'CartSessionResume',resources:[],elements:[\n  {id:1,type:'Get Records',config:{object:'CartSession',recordLimit:'all',conditions:[]}},\n  {id:2,type:'Subflow',config:{flowApiName:'CartSessionResume'}}]};\n const {graph:updated}=rewriteLegacyCartFlow(graph);\n assert.equal(updated.apiName,'CartSessionResume');\n assert.equal(updated.elements[0].config.object,'Cart');\n assert.equal(updated.elements[1].config.flowApiName,'CartSessionResume');\n const page={apiName:'CartSessionPage',components:[{properties:{\n  actionFlows:{click:{flowApiName:'CartSessionResume',\n   inputs:{cartSessionId:'$session.cartSessionId'}}}}}]};\n const result=rewriteLegacyCartPage(page);\n assert.equal(result.page.apiName,'CartSessionPage');\n assert.equal(result.page.components[0].properties.actionFlows.click.flowApiName,'CartSessionResume');\n assert.equal(result.page.components[0].properties.actionFlows.click.inputs.cartId,'$session.cartId');\n});\n\n\ntest('Oracle retirement defers only the still-active Order.CartSession lookup',()=>{\n const blocked={ready:false,checks:[ORDER_LOOKUP_BLOCKER]};\n const ready={ready:true,checks:[]};\n assert.equal(canDeferOrderCartSessionRetirement([blocked]),true);\n assert.equal(canDeferOrderCartSessionRetirement([ready,blocked]),true);\n assert.equal(canDeferOrderCartSessionRetirement([ready]),false);\n assert.equal(canDeferOrderCartSessionRetirement([]),false);\n assert.equal(canDeferOrderCartSessionRetirement([{\n  ready:false,checks:['other active CartSession relationship fields: Invoice.CartSession']\n }]),false);\n assert.equal(canDeferOrderCartSessionRetirement([{\n  ready:false,checks:[ORDER_LOOKUP_BLOCKER,'active legacy Flows: CustomFlow']\n }]),false);\n assert.equal(canDeferOrderCartSessionRetirement([{\n  ready:false,checks:['CartSession copy has not run',ORDER_LOOKUP_BLOCKER]\n }]),false);\n});\n"],["scripts/smarttill/apply-visual-drafts.test.mjs","import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {pageNames,visualBlocks,prepareVisualDraft,verifyVisualDraft} from './apply-visual-drafts.mjs';\n\nconst page=(name,components=[],variant='Desktop')=>({\n apiName:name,label:name,pageType:'App Page',targetObject:'',status:'Draft',\n layoutMode:components.length?'free-canvas':'template',draftRevision:0,\n publishedRevision:0,canvasWidth:1440,canvasHeight:900,\n activationAssignments:[],components\n});\n\ntest('both UI-only pages use the existing registered component types in all 4 variants',()=>{\n assert.deepEqual(Object.keys(pageNames),['customer','lock']);\n const variants=['Desktop','Tablet','Mobile','Custom'];\n const allowed=new Set(['smart_container','smart_cart','smart_icon','smart_button','ui_input']);\n for(const variant of variants)for(const type of Object.keys(pageNames)){\n  const blocks=visualBlocks(type,variant),ids=new Set(blocks.map(b=>b.id));\n  assert.equal(ids.size,blocks.length);\n  assert.equal(blocks[0].position.x,0);\n  assert.equal(blocks[0].position.y,0);\n  for(const b of blocks){\n   assert(allowed.has(b.type.slice(7)),b.type);\n   assert.equal(b.properties.libraryComponentId,b.type.slice(7));\n   assert(!Object.hasOwn(b.properties,'objectApiName'));\n   assert(!Object.hasOwn(b.properties,'actionFlows'));\n   assert(!Object.hasOwn(b.properties,'filters'));\n   assert(!Object.hasOwn(b.properties,'textSource'));\n   assert(!Object.hasOwn(b.properties,'subtotalValue'));\n   assert(!Object.hasOwn(b.properties,'totalValue'));\n   assert(b.position.width>0&&b.position.height>0);\n   if(b.parentId){\n    assert(ids.has(b.parentId),'Missing parent: '+b.id);\n    assert.equal(b.properties.layoutParentId,b.parentId);\n   }\n  }\n }\n});\ntest('customer display prepares nine blocks including a hidden thank-you state',()=>{\n const blocks=visualBlocks('customer');\n assert.equal(blocks.length,9);\n assert.equal(blocks.filter(b=>b.visible===false).length,4);\n const cart=blocks.find(b=>b.id==='stcd-order-cart');\n assert.deepEqual(cart.properties.columnVisibility,['Column 1','Column 4']);\n assert.equal(cart.properties.qtyIncreaseVisible,false);\n assert.equal(cart.properties.customButton1Visible,false);\n});\ntest('lock screen uses secure generic input and has no authentication behaviour',()=>{\n for(const variant of ['Desktop','Tablet','Mobile','Custom']){\n  const blocks=visualBlocks('lock',variant);\n  const pin=blocks.find(b=>b.id==='stls-pin-input');\n  assert.equal(pin.type,'Custom:ui_input');\n  assert.equal(pin.properties.inputType,'password');\n  assert.equal(pin.properties.allowTyping,true);\n  assert.equal(pin.properties.maxLength,8);\n  assert.equal(pin.properties.value,'');\n  for(const name of ['stls-unlock','stls-logout']){\n   const button=blocks.find(b=>b.id===name);\n   assert.equal(button.type,'Custom:smart_button');\n   assert(!Object.hasOwn(button.properties,'actionFlows'));\n  }\n }\n});\ntest('draft creation is additive and idempotent',()=>{\n const initial=page('smarttill_customerdisplay');\n const once=prepareVisualDraft(initial,'customer','Desktop');\n assert(once.changed);\n assert.equal(once.draft.components.length,9);\n assert.equal(once.draft.layoutMode,'free-canvas');\n const saved={...once.draft,draftRevision:2};\n verifyVisualDraft(initial,saved,'customer','Desktop',once.added);\n const again=prepareVisualDraft(saved,'customer','Desktop');\n assert.equal(again.changed,false);\n assert.deepEqual(again.draft,saved);\n});\ntest('preserves unrelated author metadata, page binding and actionFlows',()=>{\n const original={\n  id:'user-authored',type:'Custom:smart_button',label:'My existing button',\n  region:'main',visible:true,position:{x:0,y:0,width:1400,height:80},\n  properties:{label:'My button',actionFlows:{click:{actionType:'Flow',flowApiName:'Existing'}}}\n };\n const initial={...page('smarttill_lockscreen',[original]),\n  targetObject:'Account',draftRevision:4,publishedRevision:3};\n const result=prepareVisualDraft(initial,'lock','Desktop');\n assert(result.changed);\n assert.deepEqual(result.draft.components.find(c=>c.id==='user-authored'),original);\n assert.equal(result.draft.targetObject,'Account');\n assert.equal(result.draft.publishedRevision,3);\n const saved={...result.draft,draftRevision:5};\n verifyVisualDraft(initial,saved,'lock','Desktop',result.added);\n});\ntest('rejects incompatible ID, nonempty template, undersized existing canvas',()=>{\n const colliding={...visualBlocks('lock')[0],type:'Custom:smart_text'};\n assert.throws(()=>prepareVisualDraft(page('p',[colliding]),'lock'),/incompatible type/);\n const nonempty={...page('p',[{id:'unknown'}]),layoutMode:'template'};\n assert.throws(()=>prepareVisualDraft(nonempty,'customer'),/free-canvas/);\n const small={...page('p',[{id:'other',type:'Custom:ui_input'}]),\n  layoutMode:'free-canvas',canvasWidth:1000};\n assert.throws(()=>prepareVisualDraft(small,'customer'),/smaller/);\n});\n"]];
test('scripts complete test suite',()=>{
 const created=[];
 try{
  for(const [file,source] of SOURCES){
   if(fs.existsSync(file))throw new Error('Consolidated test source is already materialized: '+file);
   fs.mkdirSync(path.dirname(file),{recursive:true});
   fs.writeFileSync(file,source,'utf8');
   created.push(file);
  }
  const run=spawnSync(process.execPath,['--import','tsx','--test',...SOURCES.map(e=>e[0])],
   {stdio:'inherit',env:process.env,timeout:720000});
  if(run.error)throw run.error;
  assert.equal(run.status,0,'Original test suite failed: '+run.status);
 }finally{
  for(const file of created)fs.rmSync(file,{force:true});
 }
});


test('48 SQL-decodable formulas are covered by one compiler, Record Engine and Action Engine',async()=>{
 const {Parser}=await import('../apps/server/src/expression-engine/FormulaParser.ts');
 const {tokenize}=await import('../apps/server/src/expression-engine/FormulaTokenizer.ts');
 const {compileFormulaSql,SQL_SCALAR_FORMULAS,SQL_RECORD_AGGREGATES}=
  await import('../apps/server/src/expression-engine/FormulaSqlCompiler.ts');
 const {ACTION_FORMULA_FUNCTIONS}=
  await import('../apps/server/src/expression-engine/FormulaActions.ts');
 assert.equal(SQL_SCALAR_FORMULAS.size,39);
 assert.equal(SQL_RECORD_AGGREGATES.size,5);
 const actions=['CREATERECORD','UPDATERECORD','DELETERECORD','GETRECORD'];
 assert(actions.every(name=>ACTION_FORMULA_FUNCTIONS.has(name)));
 const examples={
  ISBLANK:'ISBLANK(@Name)',ISNULL:'ISNULL(@Name)',ISNUMBER:'ISNUMBER(@Name)',
  TEXT:'TEXT(@Name)',VALUE:'VALUE("12.4")',LEN:'LEN(@Name)',LOWER:'LOWER(@Name)',
  UPPER:'UPPER(@Name)',PROPER:'PROPER(@Name)',LEFT:'LEFT(@Name,2)',
  RIGHT:'RIGHT(@Name,2)',FIND:'FIND("a",@Name)',CONTAINS:'CONTAINS(@Name,"a")',
  BEGINS:'BEGINS(@Name,"a")',ISPICKVAL:'ISPICKVAL(@Name,"Paid")',
  INCLUDES:'INCLUDES(@Name,"Paid")',ROUND:'ROUND(2.25,1)',
  ROUNDUP:'ROUNDUP(2.25,1)',ROUNDDOWN:'ROUNDDOWN(2.25,1)',
  MIN:'MIN(2,3)',MAX:'MAX(2,3)',DATE:'DATE(2026,11,7)',
  DATEVALUE:'DATEVALUE("2026-11-07")',TODAY:'TODAY()',NOW:'NOW()',
  DAY:'DAY("2026-11-07")',MONTH:'MONTH("2026-11-07")',
  YEAR:'YEAR("2026-11-07")',HOUR:'HOUR("2026-11-07T12:30:00Z")',
  MINUTE:'MINUTE("2026-11-07T12:30:00Z")',
  SECOND:'SECOND("2026-11-07T12:30:00Z")',
  WEEKDAY:'WEEKDAY("2026-11-07")',ADDDAYS:'ADDDAYS("2026-11-07",2)',
  ADDMONTHS:'ADDMONTHS("2026-11-07",2)',
  TIMEVALUE:'TIMEVALUE("12:30")',TIMENOW:'TIMENOW()',
  GEOLOCATION:'GEOLOCATION(51.5,0)',DISTANCE:'DISTANCE(GEOLOCATION(51,0),GEOLOCATION(52,0),"km")',
  SUM:'SUM(@Orders.Total)'
 };
 assert.deepEqual([...SQL_SCALAR_FORMULAS].sort(),Object.keys(examples).sort());
 for(const [name,formula] of Object.entries(examples)){
  const values=[],bindings={
   bind:value=>{values.push(value);return '$'+(values.length+3);},
   field:reference=>{assert.match(reference,/^[A-Za-z][A-Za-z0-9_.]*$/);return 'r.value_text';},
   sum:reference=>{assert.equal(reference,'Orders.Total');return '(SELECT SUM(amount) FROM authorised_records)';},
   timeZone:'$3::text'
  };
  const sql=compileFormulaSql(new Parser(tokenize(formula)).parse(),bindings);
  assert(sql.length>5,name+' missing SQL');
  assert(!sql.includes('DROP TABLE'),name+' contains injected SQL');
 }
 const encoded='a'+"'); DROP TABLE md_records; --";
 const values=[];
 const sql=compileFormulaSql(new Parser(tokenize('LOWER("'+encoded+'")')).parse(),{
  bind:value=>{values.push(value);return '$4';},
  field:()=>{throw Error('Unexpected SQL field');},sum:()=>{throw Error('Unexpected SUM');},
  timeZone:'$3::text'
 });
 assert(!sql.includes('DROP TABLE'));
 assert.equal(values[0],encoded);
 assert.throws(()=>compileFormulaSql(new Parser(tokenize('IFERROR(1/0,3)')).parse(),{
  bind:()=>'$4',field:()=>'',sum:()=>'',timeZone:'$3::text'
 }),/not SQL-decodable/);
});

test('nested server formulas resolve child values before SQL while preserving typed results',async()=>{
 const {evaluateResolvedFormulaSql}=await import('../apps/server/src/system-support/formula-sql-runtime.ts');
 const calls=[];
 const db={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes('jsonb_array_elements_text('))return {rows:[{value:10}]};
  if(sql.includes('::numeric')&&params.includes('bad'))throw Error('Invalid SQL numeric input');
  if(sql.includes('round('))return {rows:[{value:params.includes(7)?7:10}]};
  // Literals that feed COLLECTION are also decoded by the current SQL bridge.
  if(sql.startsWith('SELECT to_jsonb(($2::'))return {rows:[{value:params[1]}]};
  throw Error('Unexpected SQL formula query: '+sql.slice(0,100));
 }};
 const run=source=>evaluateResolvedFormulaSql(db,source,
  ()=>{throw Error('Unexpected untrusted reference');},{timeZone:'UTC'},'flow_formula');
 assert.equal(await run('=SUM(COLLECTION("Numbers",2,3,5))'),10);
 assert.equal(await run('=ROUND(SUM(COLLECTION("Numbers",2,3,5)),2)'),10);
 assert.equal(await run('=IFERROR(ROUND(SUM(COLLECTION("Numbers",2,3,5)),2),0)'),10);
 assert.equal(await run('=ROUND(IFERROR(VALUE("bad"),7),2)'),7);
 assert.equal(await run('=IF(FALSE,ROUND(SUM(COLLECTION("Unused",1,2)),2),17)'),17,
  'unused conditional branch is not evaluated');
 assert.ok(calls.some(call=>call.sql.includes('round(')&&call.params.includes(10)),
  'the SQL parent receives a bound numeric child, not an unsupported function');
});

test('nested SQL conditional formulas do not execute unused Record Engine aggregates',async()=>{
 const {evaluateFormulaSql}=await import('../apps/server/src/system-support/formula-sql-runtime.ts');
 const identity={name:'Test',email:'test@example.test',time_zone:'UTC',
  locale:'en-GB',currency_iso_code:'GBP',tenant_name:'Test'};
 const db={async query(sql,params){
  if(sql.includes('FROM md_users u JOIN md_tenants'))return {rows:[identity]};
  if(sql.includes('SELECT to_jsonb(')){
   const values=params.filter(value=>typeof value==='number'||typeof value==='boolean'||value==='ok');
   return {rows:[{value:values.at(-1)??null}]};
  }
  throw Error('Unexpected Formula SQL query');
 }};
 const deny=async()=>{throw Error('Unused Record Engine aggregate was queried');};
 const rights={require:deny},records={list:deny,aggregateFiltered:deny};
 const actor={tenant_id:'11111111-1111-4111-8111-111111111111',
  user_id:'22222222-2222-4222-8222-222222222222'};
 const run=formula=>evaluateFormulaSql(db,rights,records,actor,{formula});
 const aggregate='SUMIFS(Secret,Amount,Status,"Active")';
 assert.equal(await run('IF(FALSE,'+aggregate+',17)'),17);
 assert.equal(await run('IF(TRUE,17,'+aggregate+')'),17);
 assert.equal(await run('AND(FALSE,'+aggregate+')'),false);
 assert.equal(await run('OR(TRUE,'+aggregate+')'),true);
 assert.equal(await run('BLANKVALUE("ok",'+aggregate+')'),'ok');
 assert.equal(await run('NULLVALUE(17,'+aggregate+')'),17);
 assert.equal(await run('(FALSE AND '+aggregate+')'),false);
 assert.equal(await run('(TRUE OR '+aggregate+')'),true);
});

test('SQL Formula runtime enforces tenant field rights and authenticates session identity',async()=>{
 const {evaluateFormulaSql}=
  await import('../apps/server/src/system-support/formula-sql-runtime.ts');
 const actor={tenant_id:'11111111-1111-4111-8111-111111111111',
  user_id:'22222222-2222-4222-8222-222222222222'};
 const recordId='33333333-3333-4333-8333-333333333333',seen=[],permissions=[];
 const db={query:async(sql,params)=>{
  seen.push({sql,params});
  if(sql.includes('FROM md_users u JOIN md_tenants'))
   return {rows:[{name:'Test',email:'trusted@example.com',time_zone:'UTC',
    locale:'en-GB',currency_iso_code:'GBP',tenant_name:'Tenant'}]};
  if(sql.includes('FROM md_field_definitions'))
   return {rows:[{data_type:'number',rollup_source_data_type:null}]};
  if(params.filter(value=>value===actor.user_id).length>1)
   return {rows:[{value:actor.user_id}]};
  return {rows:[{value:params.includes(40)?40:42}]};
 }};
 const rbac={require:async(...args)=>{permissions.push(args);}};
 const records={
  list:async()=>({total:2}),
  aggregateFiltered:async(_tenant,_user,_object,_field,filters)=>{
   assert.equal(filters[0]?.value,actor.user_id);
   return {eligible:true,total:2,numericCount:2,sum:40,min:10,max:30};
  }
 };
 const result=await evaluateFormulaSql(db,rbac,records,actor,{
  formula:'ROUND(@Orders.Total, 2)',objectApi:'Orders',recordId
 });
 assert.equal(result,42);
 assert(permissions.some(x=>x[2]==='Orders'&&x[3]==='read'));
 assert(permissions.some(x=>x[2]==='Orders.Total'&&x[3]==='read'));
 const query=seen.at(-1);
 assert.match(query.sql,/md_record_access\(\$1,\$2,r\.id,'read'\)/);
 assert(query.params.includes(recordId));
 assert(query.params.includes('Total'));
 assert(!query.sql.includes(actor.user_id));
 const aggregated=await evaluateFormulaSql(db,rbac,records,actor,{
  formula:'SUMIFS(@Orders,@Total,@CreatedBy,$session.user.id)'
 });
 assert.equal(aggregated,40);
});


test('SQL formula metadata query matches the shipped SQL schema and pure formulas execute as SQL',async()=>{
 const fs=await import('node:fs');
 const schema=fs.readFileSync(new URL('../apps/server/src/system-files/schema.sql',import.meta.url),'utf8');
 const runtime=fs.readFileSync(new URL('../apps/server/src/system-support/formula-sql-runtime.ts',import.meta.url),'utf8');
 assert.match(schema,/CREATE TABLE IF NOT EXISTS md_field_definitions/);
 assert.doesNotMatch(schema,/ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_source_data_type/);
 assert.doesNotMatch(runtime,/SELECT data_type,rollup_source_data_type/);
 const {evaluateFormulaSql}=await import('../apps/server/src/system-support/formula-sql-runtime.ts');
 const queries=[];
 const actor={tenant_id:'11111111-1111-4111-8111-111111111111',
  user_id:'22222222-2222-4222-8222-222222222222'};
 const db={async query(sql,params){
  queries.push({sql,params});
  if(sql.includes('FROM md_users'))return {rows:[{name:'Test',email:'test@example.test',
   time_zone:'UTC',locale:'en-GB',currency_iso_code:'GBP',tenant_name:'Test'}]};
  if(sql.includes('SELECT to_jsonb('))return {rows:[{value:'hello'}]};
  throw Error('Unexpected SQL: '+sql);
 }};
 const rights={async require(){throw Error('A literal or State formula should need no Record access')}};
 const records={async list(){throw Error('Not an aggregate')},
  async aggregateFiltered(){throw Error('Not an aggregate')}};
 const result=await evaluateFormulaSql(db,rights,records,actor,
  {formula:'LOWER("HELLO")',state:{value:8}});
 assert.equal(result,'hello');
 assert.match(queries[1].sql,/SELECT to_jsonb\(/);
 assert.match(queries[1].sql,/lower\(/);
 assert(!queries[1].sql.includes('HELLO'));
 assert(queries[1].params.includes('HELLO'));
});


test('one-version SQL upgrade replays only missing original migrations (including gaps)',async()=>{
 const {planLegacyMigrationTransition}=await import('../apps/server/src/system-support/system-migrations.ts');
 const {createHash}=await import('node:crypto');
 const source=fs.readFileSync(path.resolve('apps/server/src/system-support/migrations/20261107-core-baseline.sql'),'utf8');
 const sections=[...source.matchAll(/^-- BEGIN ORIGINAL MIGRATION ([0-9a-z-]+\.sql)\n([\s\S]*?)^-- END ORIGINAL MIGRATION \1$/gm)]
  .map(match=>({name:match[1],sql:match[2]}));
 assert.equal(sections.length,279,'Approved baseline preserves every original migration');
 const receipts=sections.map(m=>({version:m.name,checksum:createHash('sha256').update(m.sql).digest('hex')}));
 assert.deepEqual(planLegacyMigrationTransition(source,receipts),[],'Fully upgraded databases are never replayed');
 assert.deepEqual(planLegacyMigrationTransition(source,receipts.slice(0,275)).map(m=>m.name),
  sections.slice(275).map(m=>m.name),'Partially upgraded databases get their missing suffix');
 const missingIndex=201;
 assert.deepEqual(planLegacyMigrationTransition(source,receipts.filter((_,i)=>i!==missingIndex))
  .map(m=>m.name),[sections[missingIndex].name],
  'Older runners may have applied later migrations while a newly added file is absent');
 assert.throws(()=>planLegacyMigrationTransition(source,[...receipts.slice(0,3),
  {version:'unknown-production-migration.sql',checksum:'x'}]),/Unknown legacy SQL migration receipt/);
 assert.throws(()=>planLegacyMigrationTransition(source,[{version:receipts[0].version,checksum:'bad'}]),
  /SQL system migration changed after application/);
});


test('legacy migration adoption retains old receipts for API rollback and is idempotent',async()=>{
 const {applySystemMigrations}=await import('../apps/server/src/system-support/system-migrations.ts');
 const {createHash}=await import('node:crypto');
 const source=fs.readFileSync(path.resolve('apps/server/src/system-support/migrations/20261107-core-baseline.sql'),'utf8');
 const sections=[...source.matchAll(/^-- BEGIN ORIGINAL MIGRATION ([0-9a-z-]+\.sql)\n([\s\S]*?)^-- END ORIGINAL MIGRATION \1$/gm)]
  .map(match=>({version:match[1],sql:match[2]}));
 let receipts=sections.slice(0,-1).map(m=>({
  version:m.version,checksum:createHash('sha256').update(m.sql).digest('hex')
 }));
 const deployed=new Set();
 const db={transaction:async callback=>{
  const pending=[...receipts];
  const client={query:async(sql,params=[])=>{
   if(sql.includes('SELECT version,checksum FROM md_system_migrations'))
    return {rows:[...pending]};
   if(sql.startsWith('INSERT INTO md_system_migrations(version,checksum)')){
    assert.ok(!pending.some(row=>row.version===params[0]),'Receipt inserted once');
    pending.push({version:params[0],checksum:params[1]});
   }
   if(sql.includes('ALTER TABLE md_lightning_page_details DROP CONSTRAINT'))
    deployed.add(sql);
   return {rows:[]};
  }};
  await callback(client);
  receipts=pending;
 }};
 await applySystemMigrations(db);
 assert.equal(receipts.length,280,'279 old receipts are retained alongside the new baseline for rollback');
 assert.ok(receipts.some(r=>r.version==='20261107-core-baseline.sql'));
 assert.equal(deployed.size,1,'Only the missing original migration is replayed');
 await applySystemMigrations(db);
 assert.equal(receipts.length,280,'Second boot is idempotent');
 assert.equal(deployed.size,1,'Second boot does not replay historical migrations');
});


test('already-baselined production ignores later migration receipts without replay or deletion',async()=>{
 const {applySystemMigrations}=await import('../apps/server/src/system-support/system-migrations.ts');
 const {createHash}=await import('node:crypto');
 const source=fs.readFileSync(path.resolve('apps/server/src/system-support/migrations/20261107-core-baseline.sql'),'utf8');
 const baseline={version:'20261107-core-baseline.sql',checksum:createHash('sha256').update(source).digest('hex')};
 const later={version:'20270123-normalize-builder-ribbon-properties.sql',checksum:'preserved-post-baseline-receipt'};
 const receipts=[baseline,later];
 let receiptWrites=0;
 const db={transaction:async callback=>{
  await callback({query:async sql=>{
   if(sql.includes('SELECT version,checksum FROM md_system_migrations'))return {rows:[...receipts]};
   if(sql.startsWith('INSERT INTO md_system_migrations')||sql.startsWith('DELETE FROM md_system_migrations'))
    receiptWrites++;
   return {rows:[]};
  }});
 }};
 await applySystemMigrations(db);
 assert.equal(receiptWrites,0,'Do not modify migration receipts on already-baselined databases');
 assert.deepEqual(receipts,[baseline,later],'Leave later migration receipts untouched');
 const corruptDb={transaction:async callback=>{
  await callback({query:async sql=>sql.includes('SELECT version,checksum FROM md_system_migrations')
   ? {rows:[{...baseline,checksum:'corrupt'},later]} : {rows:[]}});
 }};
 await assert.rejects(()=>applySystemMigrations(corruptDb),/SQL system migration changed after application/,
  'An invalid baseline checksum must still stop startup');
});

test('OCI CLI helper emits timestamped live output and a diagnosed collector state',()=>{
 const read=relative=>fs.readFileSync(path.resolve(process.cwd(),relative),'utf8');
 const worker=read('scripts/oracle/metadrive-oci-deploy-latest');
 const broker=read('scripts/oracle/metadrive-mcp-operations');
 const installer=read('scripts/oracle/install-oci-deploy-control.sh');
 const deploy=read('scripts/oracle/deploy-full-stack.sh');
 assert.ok(worker.includes('timestamp_build_output'));
 assert.ok(worker.includes('TZ=UTC awk'));
 assert.ok(worker.includes('tee -a "$build_log_file"'));
 assert.ok(worker.includes('METADRIVE_OCI_DEPLOY_MONITOR=1'));
 assert.ok(broker.includes('log_collector=v2'));
 assert.ok(broker.includes('build_log_state=missing'));
 assert.ok(broker.includes('build_log_state=unreadable'));
 assert.ok(broker.includes('build_log_state=available'));
 assert.ok(installer.includes('OCI operations broker live log collector probe failed'));
 for(const step of ['Backing up production SQL','API and worker activated',
  'Database updates complete','Deploying frontend','local health checks passed'])
  assert.ok(deploy.includes(step),step);
});
