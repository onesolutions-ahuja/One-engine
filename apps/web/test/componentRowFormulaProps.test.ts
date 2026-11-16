import test from 'node:test';
import assert from 'node:assert/strict';
import {convertedFormula} from '../src/component-libraries/shared/formulaCodeLookup.js';
import {isRowDisplayProperty,resolveComponentFormulaProps} from
 '../src/core/components/RegisteredComponent/componentFormulaProps';

type Row=Record<string,unknown>;
type Code=Map<string,(row:Row)=>unknown>;
const lookup=()=>undefined;

function evaluateRows(
 source:string,rows:Row[],code:Code
):unknown[]{
 const run=convertedFormula(code,source);
 assert.ok(run,'The row renderer must still have the original compiled formula');
 return rows.map(row=>run(row));
}

test('Card Grid: row-bound names, prices, images and buttons are never pre-evaluated on the first record',()=>{
 const records=[{Id:'p1',Name:'Cola',Price:1.5,Image:'cola.png'},
  {Id:'p2',Name:'Juice',Price:2.75,Image:'juice.png'}];
 const code:Code=new Map([
  ['@Product.Name',row=>row.Name],['@Product.Image',row=>row.Image],
  ['=TEXT(@Product.Price)',row=>'£'+Number(row.Price).toFixed(2)],
  ['=UPPER(@Product.Name)',row=>String(row.Name).toUpperCase()],
  ['=SUMIFS(CartLine, LineTotal, Status, "Open")',()=>10.50]
 ]);
 const source={records,objectApiName:'Product',textSource:'@Product.Name',
  imageSource:'@Product.Image',cardValue:'=TEXT(@Product.Price)',
  cardButtonText:'=UPPER(@Product.Name)',
  label:'=SUMIFS(CartLine, LineTotal, Status, "Open")'};
 const props=resolveComponentFormulaProps(source,'smart_card_grid',code,lookup);
 assert.equal(props.textSource,source.textSource);
 assert.equal(props.imageSource,source.imageSource);
 assert.equal(props.cardValue,source.cardValue);
 assert.equal(props.cardButtonText,source.cardButtonText);
 assert.equal(props.label,10.50,'Page-wide formulas still evaluate once');
 assert.deepEqual(evaluateRows(props.textSource as string,records,code),['Cola','Juice']);
 assert.deepEqual(evaluateRows(props.imageSource as string,records,code),['cola.png','juice.png']);
 assert.deepEqual(evaluateRows(props.cardValue as string,records,code),['£1.50','£2.75']);
 assert.deepEqual(evaluateRows(props.cardButtonText as string,records,code),['COLA','JUICE']);
});

test('Tabs and Selector: different category rows keep different captions',()=>{
 const records=[{Id:'c1',Name:'Desserts'},{Id:'c2',Name:'Drinks'},{Id:'c3',Name:'Snacks'}];
 const code:Code=new Map([['@MenuCategory.Name',row=>row.Name]]);
 for(const component of ['smart_tabs','smart_selector','smart_navigation']){
  const props=resolveComponentFormulaProps(
   {records,objectApiName:'MenuCategory',textSource:'@MenuCategory.Name'},component,code,lookup);
  assert.equal(props.textSource,'@MenuCategory.Name',component);
  assert.deepEqual(evaluateRows(props.textSource as string,records,code),
   ['Desserts','Drinks','Snacks'],component);
 }
});

test('Cart: lookup names, quantities, amounts, and row action labels keep their own row',()=>{
 const records=[{Id:'l1',Quantity:1,UnitPrice:5.49,
  __mentionValues:{'@Product.Name':'Burger'}},
 {Id:'l2',Quantity:2,UnitPrice:1.25,
  __mentionValues:{'@Product.Name':'Cola'}}];
 const code:Code=new Map([
  ['@Product.Name',row=>(row.__mentionValues as Row)['@Product.Name']],
  ['@CartLine.Quantity',row=>row.Quantity],
  ['=TEXT(@CartLine.UnitPrice)',row=>'£'+Number(row.UnitPrice).toFixed(2)],
  ['=SUMIFS(CartLine, LineTotal, Status, "Open")',()=>7.99]
 ]);
 const source={records,objectApiName:'CartLine',textSource:'@Product.Name',
  column2Source:'=TEXT(@CartLine.UnitPrice)',column3Source:'@CartLine.Quantity',
  rowSupportingSource:'@Product.Name',totalValue:'=SUMIFS(CartLine, LineTotal, Status, "Open")'};
 const props=resolveComponentFormulaProps(source,'smart_cart',code,lookup);
 assert.equal(props.totalValue,7.99,'Cart summary remains page-wide');
 assert.equal(props.textSource,'@Product.Name');
 assert.equal(props.column2Source,source.column2Source);
 assert.equal(props.column3Source,'@CartLine.Quantity');
 assert.deepEqual(evaluateRows(props.textSource as string,records,code),['Burger','Cola']);
 assert.deepEqual(evaluateRows(props.column2Source as string,records,code),['£5.49','£1.25']);
 assert.deepEqual(evaluateRows(props.column3Source as string,records,code),[1,2]);
});

test('Table, Chart and Calendar defer all per-row projections but not page-level date settings',()=>{
 const rows=[{Id:'r1',Name:'Monday',Value:4},{Id:'r2',Name:'Tuesday',Value:8}];
 const code:Code=new Map([
  ['@Event.Name',row=>row.Name],['@Event.Value',row=>row.Value],
  ['@Event.StartAt',row=>row.StartAt]
 ]);
 for(const component of ['smart_chart','smart_table']){
  const props=resolveComponentFormulaProps({records:rows,objectApiName:'Event',
   textSource:'@Event.Name',column2Source:'@Event.Value'},component,code,lookup);
  assert.equal(props.column2Source,'@Event.Value');
  if(component==='smart_chart')assert.equal(props.textSource,'@Event.Name');
  assert.deepEqual(evaluateRows(props.column2Source as string,rows,code),[4,8]);
 }
 const calendar=resolveComponentFormulaProps({records:rows,objectApiName:'Event',
  calendarStartSource:'@Event.StartAt',calendarTitleSource:'@Event.Name'},
  'smart_calendar',code,lookup);
 assert.equal(calendar.calendarStartSource,'@Event.StartAt');
 assert.equal(calendar.calendarTitleSource,'@Event.Name');
});

test('Single-record displays still run their compiled binding once',()=>{
 const code:Code=new Map([['@Product.Name',row=>row.Name]]);
 const props=resolveComponentFormulaProps({record:{Id:'p',Name:'Cola'},
  objectApiName:'Product',textSource:'@Product.Name'},'smart_text',code,lookup);
 assert.equal(props.textSource,'Cola');
 assert.equal(isRowDisplayProperty('smart_text','textSource',{records:[{Name:'Cola'}]}),false);
});

test('Authored collection and filter expressions survive intact rather than being scalarised',()=>{
 const code:Code=new Map([['=COLLECTION("Tabs", "Drinks", "Food")',()=>['Drinks','Food']]]);
 const props=resolveComponentFormulaProps({records:[],objectApiName:'Product',
  collectionFormula:'=COLLECTION("Tabs", "Drinks", "Food")',
  filterFormula:'@ThisPage.Tabs1.Selected.Id',selectorOptionsFormula:'=COLLECTION("Tabs", "Drinks", "Food")'},
  'smart_tabs',code,lookup);
 assert.equal(props.collectionFormula,'=COLLECTION("Tabs", "Drinks", "Food")');
 assert.equal(props.filterFormula,'@ThisPage.Tabs1.Selected.Id');
 assert.equal(props.selectorOptionsFormula,'=COLLECTION("Tabs", "Drinks", "Food")');
});

test('No-row-data components preserve their existing scalar behaviour',()=>{
 const code:Code=new Map([['@ThisTenant.Company.Name',()=> 'Shop Ltd']]);
 const props=resolveComponentFormulaProps({textSource:'@ThisTenant.Company.Name'},
  'smart_tabs',code,lookup);
 assert.equal(props.textSource,'Shop Ltd');
});
