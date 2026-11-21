/**
 * One formula engine: every value a page shows comes from page code (the page
 * converter's generated functions). The previous run-time formula interpreter, its
 * routes and its action interpreter are gone; this test fails if any comes back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkPageFormulas} from '../../server/src/page-compiler/code/checkPageFormulas';
import {looksLikeFormula,runFormulaNode,runFormulaText,formulaCompilers} from '../src/core/pages/PageCompiler/formulaText';
import {createPageCodeRuntime,type PageCode} from '../src/core/pages/PageCompiler/pageCodeRuntime';
import {runComponentFormula} from '../src/component-libraries/shared/formulaCodeLookup.js';
import {buildCollectionSource} from '../src/component-libraries/shared/collectionSource.js';
import {hiddenByShowWhen} from '../src/component-libraries/shared/showWhen.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const files=(dir:string):string[]=>readdirSync(dir).flatMap(name=>{
 const full=path.join(dir,name);
 if(name==='node_modules'||name==='dist')return [];
 return statSync(full).isDirectory()?files(full):/\.(?:[cm]?[jt]sx?)$/.test(name)?[full]:[];
});

test('no code uses the old formula interpreter, its routes or its action interpreter',()=>{
 const forbidden:Array<[RegExp,string]>=[
  [/FieldExpression\.js/,'the FieldExpression interpreter'],
  [/\bevaluateFieldExpression(?:Detailed)?\b|\bevaluateCollectionFormula\b|\bevaluateParsedExpression\b/,'interpreter calls'],
  [/\bexecuteActionPlan\b|\bexecuteServerDataAction\b|\bexecuteActionFormula\b/,'the action interpreter'],
  [/['"`]\/(?:api\/)?formulas\/evaluate(?:-many)?\b/,'/formulas/evaluate routes'],
  [/\/action-formulas\/execute-data/,'/action-formulas/execute-data'],
  [/compiled-actions/,'compiled-actions routes'],
  [/PageRuntime\/formulaAction['"]/,'formulaAction.ts'],
  [/oldEngineMeter/,'the old engine meter']
 ];
 const found:string[]=[];
 for(const dir of ['apps/web/src','apps/server/src'])
  for(const file of files(path.join(root,dir))){
   const text=readFileSync(file,'utf8');
   for(const [pattern,label] of forbidden)if(pattern.test(text))found.push(path.relative(root,file)+': '+label);
  }
 assert.deepEqual(found,[],'Route these through page code (formulaText.ts / pageCodeRuntime.ts) instead');
});

const field=(apiName:string,dataType='Text')=>({apiName,label:apiName,dataType,required:false,unique:false});
const objects=[
 {apiName:'Invoice',label:'Invoice',fields:[field('Name'),field('Total','Currency'),field('Status'),field('InvoiceDate','DateTime')]},
 {apiName:'Cart',label:'Cart',fields:[field('Name'),field('Status'),field('SessionKey')]},
 {apiName:'Product',label:'Product',fields:[field('Name'),field('Price','Currency'),field('Category')]}
];
const text=(id:string,properties:Record<string,unknown>)=>({id,type:'Custom:smart_text',label:id,visible:true,properties});
/** One page per group the previous engine still answered (dashboards, reports, labels, tables, filters, tabs). */
const dashboard={apiName:'dashboard',label:'Dashboard',pageType:'App Page',layoutMode:'free-canvas',components:[
 text('sales',{textSource:'=SUMIFS(Invoice, Total, Status, "Paid")'}),
 text('held',{textSource:'=COUNTIFS(Cart, Status, "Held")'}),
 text('week',{textSource:'=SUMIFS(Invoice, Total, InvoiceDate, ">=" & TEXT(ADDDAYS(TODAY(), -7)))'}),
 text('tenant',{textSource:'=@ThisTenant.Company.Name'}),
 text('clock',{textSource:'=RIGHT("0" & TEXT(HOUR(NOW())), 2) & ":" & RIGHT("0" & TEXT(MINUTE(NOW())), 2)'}),
 text('cash',{textSource:'=BLANKVALUE(@ThisPage.CashBox.Value, "0.00")'}),
 {id:'invoices',type:'Custom:smart_table',label:'Invoices',visible:true,properties:{objectApiName:'Invoice',
  textSource:'@Invoice.Name',column2Source:'@Invoice.Total',column3Source:'="£" & FORMAT(@Invoice.Total, "0.00")',
  filterMode:'Formula',filterFormula:'@Invoice.InvoiceDate >= ADDDAYS(TODAY(), -30)'}},
 {id:'chart',type:'Custom:smart_chart',label:'Chart',visible:true,properties:{objectApiName:'Invoice',
  textSource:'@Invoice.Name',column2Source:'@Invoice.Total'}},
 {id:'tabs',type:'Custom:smart_tabs',label:'Tabs',visible:true,properties:{objectApiName:'Product',
  collectionFormula:'=COLLECTION("Menu", "Hot", "Cold")',textSource:'=BLANKVALUE("", "*")'}}
]};

test('dashboard, report, label, table, chart, filter and tab formulas all convert to page code',()=>{
 assert.deepEqual(checkPageFormulas(dashboard as never,objects as never),[]);
 // A formula the converter cannot turn into code is reported (never handed to another engine).
 const broken={...dashboard,components:[text('bad',{textSource:'=NOPE(1)'}),text('bare',{textSource:'"£" & @Total'})]};
 const issues=checkPageFormulas(broken as never,objects as never);
 assert.deepEqual(issues.map(issue=>issue.componentId),['bad','bare']);
 assert.match(issues[0].error,/not in the formula dictionary/);
});

test('formulas given at run time run as converted code with the page values',()=>{
 const now=new Date('2026-11-21T09:05:00Z');
 assert.equal(runFormulaText('=BLANKVALUE(@ThisPage.Input.cash, "0.00")',{},{pageState:{cash:'12.50'}}).value,'12.50');
 assert.equal(runFormulaText('=BLANKVALUE(@ThisPage.Input.cash, "0.00")',{},{}).value,'0.00');
 assert.equal(runFormulaText('=BLANKVALUE("", "*")',{}).value,'*');
 assert.equal(runFormulaText('=TEXT(ADDDAYS(TODAY(), -7))',{},{now}).value,'2026-11-14');
 assert.equal(runFormulaText('@Invoice.Total',{Total:42},{rowObject:'Invoice'}).value,42);
 assert.equal(runFormulaText('"£" & @Invoice.Total',{Total:42},{rowObject:'Invoice'}).value,'£42');
 assert.deepEqual(runFormulaText('=COLLECTION("Tabs", "a", "b")',{}).value,{name:'Tabs',items:['a','b']});
 // Plain text stays text; a formula that cannot convert is an error, not another engine.
 assert.equal(runFormulaText('Fish & Chips',{}).value,'Fish & Chips');
 assert.equal(looksLikeFormula('qa@example.com'),false);
 assert.match(String(runFormulaText('=NOPE(1)',{}).error),/not in the formula dictionary/);
 // A total over rows the page does not hold is blank here (page code asks the server).
 assert.deepEqual(runFormulaText('=SUMIFS(Invoice, Total, Status, "Paid")',{}),{value:''});
});

test('components use page code first, then the same converter; never another engine',()=>{
 const calls:string[]=[];
 const functions=new Map([['=@Invoice.Total * 2',(row:Record<string,unknown>)=>{calls.push('page');return Number(row.Total)*2;}]]);
 const p={__formulaCode:{functions,...formulaCompilers({rowObject:'Invoice'})}};
 assert.equal(runComponentFormula(p,'=@Invoice.Total * 2',{Total:5}).value,10);
 assert.deepEqual(calls,['page']);
 assert.equal(runComponentFormula(p,'=@Invoice.Total * 3',{Total:5}).value,15);
 assert.equal(runComponentFormula(p,'Plain',{}).value,'Plain');
 // A component outside a page uses the converter the app registered (same converter).
 assert.equal(runComponentFormula({},'=1+1',{}).value,2);
 // No page code and no converter: a formula is not shown as raw text and not interpreted.
 const key=Symbol.for('une.formulaCompilers'),registered=(globalThis as Record<symbol,unknown>)[key];
 delete (globalThis as Record<symbol,unknown>)[key];
 try{assert.match(String(runComponentFormula({},'=1+1',{}).error),/not converted/);}
 finally{(globalThis as Record<symbol,unknown>)[key]=registered;}
 assert.equal(hiddenByShowWhen({...p,visibleFormula:'=@Invoice.Total > 10'},{Total:5}),true);
 assert.equal(hiddenByShowWhen({...p,visibleFormula:'=@Invoice.Total > 10'},{Total:50}),false);
});

test('a page code runtime converts a given formula with its own `$` (server totals batch)',async()=>{
 const asked:unknown[]=[];
 const code:PageCode={formulas:{},sources:{},actions:{},recordSets:[]};
 const runtime=createPageCodeRuntime(code,{request:(async(_path:string,init?:RequestInit)=>{
   asked.push(JSON.parse(String(init?.body)));return {values:[99]};}) as never,
  endpoint:'/apps/a',build:{buildId:'b'},sessionId:()=>'s',state:()=>({})});
 const total=runtime.compile('=SUMIFS(Invoice, Total, Status, "Paid")','')!;
 assert.throws(()=>total({}),/loading/);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(total({}),99);
 assert.equal(asked.length,1,'one request for the totals not held');
});

test('a COLLECTION data source lists loaded rows; its values run as page code',()=>{
 const rows=[{Id:'1',Name:'Tea',Category:'Hot'},{Id:'2',Name:'Cola',Category:'Cold'}];
 const value=(node:Parameters<typeof runFormulaNode>[0])=>runFormulaNode(node,{}).value;
 const built=buildCollectionSource('=COLLECTION(Menu, @Product.Category = "Hot")',{Product:rows},{Product:['Id','Name','Category']},value);
 assert.equal(built.error,undefined);
 assert.deepEqual(built.value?.items.map(item=>(item as {label:string}).label),['Hot']);
 const table=buildCollectionSource('=TABLE(@Product, @Product.Name)',{Product:rows},{Product:['Id','Name','Category']});
 assert.equal(table.value?.items.length,2);
});
