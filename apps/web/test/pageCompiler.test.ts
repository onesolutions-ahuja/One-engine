import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {compilePage} from '../src/core/pages/PageCompiler/compilePage';
import {generatePageScript} from '../src/core/pages/PageCompiler/generatePageScript';
import {scriptFormulaOperators,scriptFormulaLibrary} from '../src/core/pages/PageCompiler/pageScriptHost';
import {evaluateFieldExpression} from '../src/component-libraries/shared/FieldExpression.js';
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
  {id:'broken',type:'Custom:smart_text',label:'Broken',visible:true,properties:{textSource:'=IF(1,'}}
 ]} as unknown as LightningPageMetadata;

test('identical Object + filter reads share one data source',()=>{
 const compiled=compilePage(page,objects);
 const product=compiled.dataSources.filter(source=>source.objectApiName==='Product');
 assert.equal(product.length,1);
 assert.deepEqual(product[0].components,['grid1','grid2','grid3']);
 const cart=compiled.dataSources.find(source=>source.objectApiName==='CartLine');
 assert.deepEqual(cart?.stateInputs,['activeCartId']);
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

test('unsupported features fall back per component and errors are reported at compile time',()=>{
 const compiled=compilePage(page,objects);
 const menu=compiled.components.find(item=>item.id==='menu')!;
 assert.equal(menu.mode,'legacy');
 assert.ok(menu.legacyReasons.includes('named collection formula'));
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
 assert.deepEqual(woken,['cart']);
 const calls:string[]=[];
 const layer=createCompiledDataLayer(compiled,compiledSourceLoader(objects,()=>'s',async(object)=>{
  calls.push(object);
  return object==='Product'?{records:[{Id:'p1',Name:'Tea',Category:'Drinks'}],total:1}:{records:[],total:0};
 }),store.get);
 await layer.start();
 assert.deepEqual(calls.sort(),['CartLine','Product'],'3 grids + 1 cart = 2 reads, not 4');
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
 const productSource=compiled.dataSources.find(source=>source.objectApiName==='Product')!;
 assert.equal(layer.get(productSource.id).records.length,1,'catalogue untouched');
});
