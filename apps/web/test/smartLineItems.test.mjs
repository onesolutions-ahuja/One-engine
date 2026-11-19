import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lineItemRows,lineItemSettings,lineText,LINE_ITEMS_PREVIEW}
 from '../src/component-libraries/smart_line_items/lineItems.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const formulas={textSource:row=>row.Quantity+' x '+row.Name,column2Source:row=>row.LineTotal,
 column3Source:row=>row.Notes,column4Source:row=>row.Discount?'Discount':'',column5Source:row=>row.Discount?-row.Discount:''};
const reader=sources=>(key,row)=>sources[key]?.(row);

test('Smart Line Items shows one line per record, however many there are',()=>{
 const one=lineItemRows([{Id:'a',Name:'Burger',Quantity:2,LineTotal:10.98,Notes:'No onions'}],reader(formulas));
 assert.deepEqual(one,[{id:'a',text:'2 x Burger',amount:'10.98',second:'No onions',extraText:'',extraAmount:''}]);
 const many=Array.from({length:100},(_,i)=>({Id:'r'+i,Name:'Item '+i,Quantity:1,LineTotal:i}));
 assert.equal(lineItemRows(many,reader(formulas)).length,100);
 assert.deepEqual(lineItemRows([],reader(formulas)),[]);
 assert.deepEqual(lineItemRows(null,reader(formulas)),[]);
});

test('Smart Line Items shows the extra (discount) line only when it has something',()=>{
 const [row]=lineItemRows([{Id:'d',Name:'Coke',Quantity:1,LineTotal:1.2,Discount:0.2}],reader(formulas));
 assert.equal(row.extraText,'Discount');
 assert.equal(row.extraAmount,'-0.20');
 const [plain]=lineItemRows([{Id:'p',Name:'Tea',Quantity:1,LineTotal:1}],reader(formulas));
 assert.equal(plain.extraText,'');
 assert.equal(plain.second,'');
});

test('Smart Line Items falls back to Name and LineTotal when no formula is set',()=>{
 const rows=lineItemRows([{Id:'x',Name:'Chips',LineTotal:2.5},{Id:'y'}],()=>undefined);
 assert.deepEqual(rows.map(row=>[row.text,row.amount]),[['Chips','2.50']]);
 assert.equal(lineText(3),'3.00');
 assert.equal(lineText('£5.49'),'£5.49');
 assert.equal(lineText(null),'');
 assert.equal(LINE_ITEMS_PREVIEW.length,2);
});

test('Smart Line Items settings default safely',()=>{
 assert.deepEqual(lineItemSettings({}),{separator:'dashed',monospace:false,bold:false});
 assert.equal(lineItemSettings({lineItemsSeparator:'none'}).separator,'none');
 assert.equal(lineItemSettings({lineItemsSeparator:'zigzag'}).separator,'dashed');
 assert.equal(lineItemSettings({lineItemsFont:'monospace',rowBold:true}).monospace,true);
});

test('Smart Line Items grows in a Print Template: its own box scrolls on screen, never on paper',()=>{
 const css=read('../src/component-libraries/smart_line_items/SmartComponent.css');
 assert.match(css,/\.smart-line-items\{[^}]*height:100%[^}]*overflow-y:auto/);
 assert.match(read('../src/component-libraries/smart_line_items/SmartComponent.jsx'),/data-print-flow="true"/);
});

test('Smart Line Items is registered like every Smart component',()=>{
 const manifest=JSON.parse(read('../src/component-libraries/manifest.json'));
 assert.ok(manifest.components.includes('smart_line_items/component.json'));
 const descriptor=JSON.parse(read('../src/component-libraries/smart_line_items/component.json'));
 assert.equal(descriptor.apiName,'smart_line_items');
 assert.deepEqual(descriptor.propertyDefinitions,[]);
 assert.match(read('../../server/src/app-seeders/smart-components.ts'),/"smart_line_items"/);
 assert.match(read('../../server/src/app-seeders/core-objects.ts'),/core-objects-unified-v(?:1[4-9]|[2-9][0-9])/);
 assert.match(read('../../server/src/system-support/system-migrations.ts'),/await applySmartLineItems\(client\)/);
 const sql=read('../../server/src/system-support/smart-line-items.ts');
 for(const key of ['lineItemsSeparator','lineItemsFont','textSource','column2Source','column3Source','column4Source','column5Source'])
  assert.match(sql,new RegExp("'"+key+"'"));
 // Others-row slot numbers must not collide with Smart Chart (301+), row buttons (401+) or multi-select (500).
 assert.match(sql,/addOthersSlots\(client,SMART_LINE_ITEMS_PROPERTY_SPECS,600\)/);
});
