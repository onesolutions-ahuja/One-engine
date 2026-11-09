import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {compilePage} from '../src/core/pages/PageCompiler/compilePage';
import {generatePageScript} from '../src/core/pages/PageCompiler/generatePageScript';
import {scriptFormulaOperators,scriptFormulaLibrary} from '../src/core/pages/PageCompiler/pageScriptHost';
import {evaluateFieldExpression,evaluateFieldExpressionDetailed,evaluateCollectionFormula} from '../src/component-libraries/shared/FieldExpression.js';
import {relationshipFormulaFields} from '../src/core/builders/PageBuilder/relationshipFormulaFields';
import type {LightningPageMetadata,ObjectMetadata} from '../src/core/metadata/Definitions/metadata';

const field=(apiName:string,dataType='Text')=>({apiName,label:apiName,dataType,required:false,unique:false});
const objects=[
 {apiName:'Product',label:'Product',pluralLabel:'Products',kind:'Custom Object',description:'',
  fields:[field('Name'),field('Price','Currency'),field('Category')]},
 {apiName:'Cart',label:'Cart',pluralLabel:'Carts',kind:'Custom Object',description:'',fields:[field('Name')]},
 {apiName:'CartLine',label:'Cart Line',pluralLabel:'Cart Lines',kind:'Custom Object',description:'',
  fields:[field('Quantity','Number'),{...field('Cart','Lookup(Cart)'),relationship:{targetObject:'Cart'}}]}
] as unknown as ObjectMetadata[];
const card=(id:string)=>({id,type:'Custom:smart_card_grid',label:id,visible:true,
 properties:{objectApiName:'Product',filters:[{field:'Category',operator:'Equals',value:'Drinks'}],
  titleFieldApiName:'Name',label:'=UPPER("menu") & " " & 2',
  actionFlows:{click:{actionType:'Formula',
   formula:'ACTIONS(CREATERECORD(CartLine, Quantity, 1, Cart, $state.activeCartId), UPDATERECORD(Cart, $state.activeCartId, Name, "x"))'}}}});
const page={apiName:'till',label:'Till',targetObject:'',pageType:'App Page',layoutMode:'free-canvas',
 canvasWidth:1000,canvasHeight:800,status:'Draft',devices:['Desktop'],components:[
  card('grid1'),card('grid2'),card('grid3'),
  {id:'cart',type:'Custom:smart_cart',label:'Cart',visible:true,properties:{objectApiName:'CartLine',
   filters:[{field:'Cart',operator:'Equals',value:{source:'PageState',key:'activeCartId'}}]}},
  {id:'pick',type:'Custom:smart_button',label:'Pick',visible:true,properties:{
   actionFlows:{click:{actionType:'PageState',stateKey:'activeCartId',value:'$event.value'}}}},
  ...Array.from({length:50},(_,i)=>({id:'text'+i,type:'Custom:smart_text',label:'T'+i,visible:true,
   properties:{textSource:'=IF(1 > 0, "a" & '+i+', "b")'}})),
  {id:'menu',type:'Custom:smart_tabs',label:'Menu',visible:true,properties:{objectApiName:'Product',
   collectionFormula:'=COLLECTION("Menu", Product.Category)'}},
  {id:'broken',type:'Custom:smart_text',label:'Broken',visible:true,properties:{textSource:'=IF(1,'}},
  {id:'mention',type:'Custom:smart_text',label:'Mention',visible:true,properties:{objectApiName:'Product',
   textSource:'@Product.Name',label:'=$session.user.email & " / " & $session.cartId'}},
  {id:'related',type:'Custom:smart_table',label:'Related',visible:true,properties:{objectApiName:'CartLine',relatedFilterKey:'activeCartId'}}
 ]} as unknown as LightningPageMetadata;

test('identical Object + filter reads share one data source',()=>{
 const compiled=compilePage(page,objects);
 const product=compiled.dataSources.filter(source=>source.objectApiName==='Product'&&Array.isArray(source.filters));
 assert.equal(product.length,1);
 const unfiltered=compiled.dataSources.filter(source=>source.objectApiName==='Product'&&!source.filters);
 assert.deepEqual(unfiltered.map(source=>source.components),[['menu','mention']]);
 assert.deepEqual(product[0].components,['grid1','grid2','grid3']);
 const cart=compiled.dataSources.find(source=>source.objectApiName==='CartLine');
 // The cart follows its filter key and the usual active-cart keys (cart scope).
 assert.deepEqual(cart?.stateInputs,['activeCartId','cartId','currentCartId']);
});

test('a state change redraws only its readers, not all components',()=>{
 const compiled=compilePage(page,objects);
 const readers=compiled.stateReaders.activeCartId;
 assert.ok(readers.includes('cart'));
 assert.ok(!readers.some(id=>id.startsWith('text')));
 assert.ok(compiled.objectReaders.CartLine.includes('cart'));
 assert.ok(!compiled.objectReaders.CartLine.includes('grid1'),'add-to-cart must not reload the catalogue');
});

test('actions are compiled once and their server part split off',()=>{
 const compiled=compilePage(page,objects);
 const click=compiled.components.find(item=>item.id==='grid1')!.actions[0];
 assert.equal(click.kind,'ActionPlan');
 assert.equal(click.serverDataSteps,2);
 assert.deepEqual(click.writesObjects,['Cart','CartLine']);
});

test('every feature compiles: collections, mentions, session references, related lists, cart scope',()=>{
 const compiled=compilePage(page,objects);
 const menu=compiled.components.find(item=>item.id==='menu')!;
 assert.equal(menu.mode,'compiled');
 assert.equal(compiled.dataSources.find(source=>source.id===menu.dataSourceId)!.complete,true,'a collection loads all its rows');
 assert.equal(compiled.components.find(item=>item.id==='mention')!.mode,'compiled');
 assert.equal(compiled.stats.legacy,0,'nothing runs on a fallback engine');
 const related=compiled.components.find(item=>item.id==='related')!;
 assert.equal(related.mode,'compiled');
 assert.deepEqual(compiled.dataSources.find(source=>source.id===related.dataSourceId)!.scope,
  {kind:'key',key:'activeCartId',field:''});
 const cart=compiled.components.find(item=>item.id==='cart')!;
 assert.equal(compiled.dataSources.find(source=>source.id===cart.dataSourceId)!.scope.kind,'auto');
 assert.equal(compiled.components.find(item=>item.id==='grid1')!.mode,'compiled');
 assert.ok(compiled.diagnostics.some(d=>d.componentId==='broken'&&d.level==='error'));
});

test('generated TS is valid TypeScript and generated JS gives the interpreter result',async()=>{
 const compiled=compilePage(page,objects);
 const source=generatePageScript(compiled,'ts');
 const out=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 assert.deepEqual(out.diagnostics?.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
 const js=generatePageScript(compiled,'js');
 const module=await import('data:text/javascript,'+encodeURIComponent(js));
 const formulas=module.createFormulas({operators:scriptFormulaOperators,formulaLibrary:scriptFormulaLibrary});
 const ctx={record:{Name:'Tea'},state:{},sessionId:'s'};
 for(const id of ['grid1:label','text7:textSource']){
  const formula=compiled.components.flatMap(c=>c.formulas.map(f=>({id:c.id+':'+f.property,f}))).find(x=>x.id===id)!.f;
  assert.equal(formulas[id](ctx),evaluateFieldExpression(formula.source,ctx.record,{pageState:{},sessionId:'s'}));
 }
 assert.equal(formulas['grid1:label'](ctx),'MENU 2');
 assert.throws(()=>formulas['broken:textSource'](ctx),/Formula error/);
});

test('one store: a state write wakes only its readers; one load per shared source',async()=>{
 const {createCompiledPageStore,createCompiledDataLayer}=await import('../src/core/pages/PageCompiler/compiledPageStore');
 const {compiledSourceLoader}=await import('../src/core/pages/PageCompiler/compiledSourceLoader');
 const compiled=compilePage(page,objects);
 const store=createCompiledPageStore(compiled);
 const woken:string[]=[];
 for(const item of compiled.components)store.subscribeComponent(item.id,()=>woken.push(item.id));
 store.set('activeCartId','c-1');
 assert.deepEqual(woken,['cart','related'],'only the two components that show cart data wake up');
 const calls:string[]=[];
 const layer=createCompiledDataLayer(compiled,compiledSourceLoader(objects,()=>({sessionId:'s'}),async(object)=>{
  calls.push(object);
  return object==='Product'?{records:[{Id:'p1',Name:'Tea',Category:'Drinks'}],total:1}:{records:[],total:0};
 }),store.get);
 await layer.start();
 assert.deepEqual(calls.sort(),['CartLine','Product','Product'],'6 data components, 3 distinct queries = 3 reads');
 // Changing the selected cart reloads only the cart lines.
 calls.length=0;
 await layer.stateChanged(['activeCartId']);
 assert.deepEqual(calls,['CartLine']);
 // A saved CartLine row is patched into the loaded list without any read.
 calls.length=0;
 await layer.saved({objectApiNames:['CartLine'],recordChanges:[{objectApiName:'CartLine',operation:'create',
  record:{Id:'11111111-1111-4111-8111-111111111111',Quantity:1,Cart:'c-1'}}]});
 const cartSource=compiled.dataSources.find(source=>source.objectApiName==='CartLine')!;
 assert.equal(layer.get(cartSource.id).records.length,1);
 assert.deepEqual(calls,[],'saved row shown with no extra request');
 const productSource=compiled.dataSources.find(source=>source.objectApiName==='Product'&&Array.isArray(source.filters))!;
 assert.equal(layer.get(productSource.id).records.length,1,'catalogue untouched');
});

test('lists load 50 rows, then the next 50 on scroll; a refresh keeps scrolled rows',async()=>{
 const {createCompiledDataLayer}=await import('../src/core/pages/PageCompiler/compiledPageStore');
 const {compiledSourceLoader}=await import('../src/core/pages/PageCompiler/compiledSourceLoader');
 const list={...page,components:[{id:'list',type:'Custom:smart_card_grid',label:'L',visible:true,
  properties:{objectApiName:'Product',titleFieldApiName:'Name'}}]} as unknown as LightningPageMetadata;
 const compiled=compilePage(list,objects);
 const all=Array.from({length:120},(_,i)=>({Id:'p'+i,Name:'P'+i}));
 const windows:string[]=[];
 const layer=createCompiledDataLayer(compiled,compiledSourceLoader(objects,()=>({sessionId:'s'}),async(_o,{limit,offset})=>{
  windows.push(offset+'+'+limit);
  return {records:all.slice(offset,offset+limit),total:all.length};
 }),()=>({}));
 const id=compiled.dataSources[0].id;
 await layer.start();
 assert.equal(layer.get(id).records.length,50);
 assert.equal(layer.get(id).hasMore,true);
 await layer.loadMore(id);
 assert.equal(layer.get(id).records.length,100);
 await layer.loadMore(id);
 assert.equal(layer.get(id).records.length,120);
 assert.equal(layer.get(id).hasMore,false);
 windows.length=0;
 await layer.reload(id);
 assert.equal(layer.get(id).records.length,120,'refresh keeps what the user scrolled through');
 assert.deepEqual(windows,['0+100','100+20']);
});

test('a cart shows only its own cart: active cart first, else the session cart (found once, refreshed after a Cart save)',async()=>{
 const {createCompiledDataLayer,createCompiledPageStore}=await import('../src/core/pages/PageCompiler/compiledPageStore');
 const {compiledSourceLoader}=await import('../src/core/pages/PageCompiler/compiledSourceLoader');
 const cartObjects=[...objects.filter(o=>o.apiName!=='Cart'),{...objects.find(o=>o.apiName==='Cart')!,
  fields:[field('Name'),field('SessionKey')]}] as unknown as ObjectMetadata[];
 const cartPage={...page,components:[{id:'cart',type:'Custom:smart_cart',label:'Cart',visible:true,
  properties:{objectApiName:'CartLine'}}]} as unknown as LightningPageMetadata;
 const compiled=compilePage(cartPage,cartObjects);
 const store=createCompiledPageStore(compiled);
 const reads:string[]=[];
 const cartId='22222222-2222-4222-8222-222222222222';
 let carts:Record<string,unknown>[]=[];
 const loader=compiledSourceLoader(cartObjects,()=>({sessionId:'session-1'}),async(object,options)=>{
  reads.push(object+':'+(options.filter?options.filter.field+'='+options.filter.value:'all'));
  if(object==='Cart')return {records:carts,total:carts.length};
  return {records:[{Id:'l1',Cart:cartId}],total:1};
 });
 const layer=createCompiledDataLayer(compiled,loader,store.get);
 const id=compiled.dataSources[0].id;
 await layer.start();
 assert.equal(layer.get(id).records.length,0,'no cart yet: never all cart lines');
 carts=[{Id:cartId,SessionKey:'session-1'}];
 reads.length=0;
 await layer.saved({objectApiNames:['Cart','CartLine']});
 assert.deepEqual(reads,['Cart:SessionKey=session-1','CartLine:Cart='+cartId]);
 reads.length=0;
 await layer.saved({objectApiNames:['CartLine']});
 assert.deepEqual(reads,['CartLine:Cart='+cartId],'the session cart is remembered');
 reads.length=0;
 store.set('activeCartId',cartId);
 await layer.stateChanged(['activeCartId']);
 assert.deepEqual(reads,['CartLine:Cart='+cartId],'active cart from page state, no lookup');
});

test('category filters still use complete sources, but scalar field formulas do not force an array',()=>{
 const listPage={...page,components:[
  {id:'grid',type:'Custom:smart_card_grid',label:'G',visible:true,properties:{objectApiName:'Product',textSource:'@Product.Name',filterKey:'category'}},
  {id:'row-fields',type:'Custom:smart_card_grid',label:'Row fields',visible:true,
   properties:{objectApiName:'Product',textSource:'@Product.Name',badgeText:'=@Product.Price * 2'}},
  {id:'dataset',type:'Custom:smart_card_grid',label:'Products',visible:true,
   properties:{objectApiName:'Product',textSource:'@Product'}},
  {id:'plain',type:'Custom:smart_table',label:'T',visible:true,properties:{objectApiName:'Cart',titleFieldApiName:'Name'}}]} as unknown as LightningPageMetadata;
 const compiled=compilePage(listPage,objects);
 assert.equal(compiled.dataSources.find(s=>s.components.includes('grid'))!.complete,true);
 // Complete collections are shared between components with identical Object/filter
 // keys; test the scalar-only source independently of that shared category filter.
 const standard=compilePage({...listPage,components:listPage.components.filter(
  (item:any)=>item.id!=='grid')} as LightningPageMetadata,objects);
 assert.equal(standard.dataSources.find(s=>s.components.includes('row-fields'))!.complete,false,'card fields evaluate per row');
 assert.equal(standard.dataSources.find(s=>s.components.includes('dataset'))!.complete,false,'full Object array keeps native pagination');
 assert.equal(standard.dataSources.find(s=>s.components.includes('plain'))!.complete,false,'other lists still page by 50');
});

test('qualified scalar fields and COLLECTION datasets have different contexts',()=>{
 const products=[{Id:'p1',Name:'Tea',Price:4},{Id:'p2',Name:'Coffee',Price:6}];
 const options={rootObjectApiName:'Product',collectionSources:{Product:products},
  collectionSourceFields:{Product:['Id','Name','Price']}};
 assert.equal(evaluateFieldExpressionDetailed('@Product.Name',products[0],options).value,'Tea');
 assert.equal(evaluateFieldExpressionDetailed('=@Product.Price * 2',products[1],options).value,'12');
 assert.equal(evaluateFieldExpressionDetailed('=SUM(@Product.Price)',products[0],options).value,'10');
 assert.match(evaluateFieldExpressionDetailed('@Name',products[0],options).error??'',/Bare @Field/);
 assert.match(evaluateFieldExpressionDetailed('@Menu',products[0],{
  ...options,namedCollections:{Menu:{name:'Menu',items:['Tea']}}}).error??'',/named collection/);
 assert.match(evaluateFieldExpressionDetailed('@Menu.state.Value',products[0],{
  ...options,namedCollectionSelections:{Menu:{Value:'Tea'}}}).error??'',/Collection selection/);
 const result=evaluateCollectionFormula('=COLLECTION("Menu", 2, 3)',{Product:products},{
  primaryObject:'Product',collectionSourceFields:{Product:['Id','Name','Price']}});
 assert.equal(result.error??null,null);
 assert.deepEqual(result.value?.items,[2,3]);
});

test('relationship suggestions use the actual Object.Relationship.Field path',()=>{
 const customer={apiName:'Customer',label:'Customer',pluralLabel:'Customers',
  fields:[field('Name')]} as unknown as ObjectMetadata;
 const product={...objects[0],fields:[...objects[0].fields,{
  ...field('CustomerId','Lookup(Customer)'),
  relationship:{relationshipName:'Customer',targetObject:'Customer'}}]} as ObjectMetadata;
 const refs=relationshipFormulaFields([product,customer],['Product'],'','formula');
 assert.ok(refs.some(item=>item.reference==='@Product.Name'));
 assert.ok(refs.some(item=>item.reference==='@Product.Customer.Name'));
});

test('Smart Lookup searches its Object with 20 guarded prefix matches independently of pagination',async()=>{
 const {compiledSourceLoader}=await import('../src/core/pages/PageCompiler/compiledSourceLoader');
 const compiled=compilePage({...page,components:[{id:'lookup',type:'Custom:smart_lookup',
  label:'Search Products',visible:true,
  properties:{objectApiName:'Product',filters:[{field:'Category',operator:'Equals',value:'Drinks'}]}}]} as unknown as LightningPageMetadata,objects);
 const source=compiled.dataSources[0];
 const calls:Record<string,unknown>[]=[];
 const loader=compiledSourceLoader(objects,()=>({sessionId:'s'}),async(object,options)=>{
  calls.push({object,...options});
  return {records:[{Id:'p1',Name:'Coca-Cola'}],total:1};
 });
 const found=await loader.search(source,{},'coc');
 assert.equal(found[0].Name,'Coca-Cola');
 assert.equal(calls[0].object,'Product');
 assert.equal(calls[0].limit,20);
 assert.equal(calls[0].offset,0);
 assert.equal(calls[0].search,'coc');
 assert.equal(calls[0].searchPrefix,true);
 assert.ok(Array.isArray(calls[0].filters));
 assert.equal((calls[0].filters as Array<{field:string;value:string}>)[0].field,'Category');
 assert.equal((calls[0].filters as Array<{field:string;value:string}>)[0].value,'Drinks');
});
