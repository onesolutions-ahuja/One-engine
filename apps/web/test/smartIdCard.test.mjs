import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 ID_CARD_MAX_FIELDS,ID_CARD_ROW_PROPERTIES,idCardFieldKeys,idCardFieldCount,idCardFieldColumns,
 idCardFieldLayout,idCardFieldSlots,idCardFieldStyle,idCardLabelStyle
} from '../src/component-libraries/smart_id_card/idCardFields.mjs';
import {PART_SNAP_RULES,partSnapRule,partOffsetKeys} from '../src/core/builders/PageBuilder/canvasPartSnap.ts';
import {applySmartIdCard} from '../../server/src/system-support/smart-id-card.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Smart ID Card has ten metadata fields: caption + value formula each',()=>{
 assert.equal(ID_CARD_MAX_FIELDS,10);
 assert.deepEqual(idCardFieldKeys(3),{source:'field3Source',label:'field3Label',offset:'field3',area:'Field 3',
  textColor:'field3TextColor',textSize:'field3TextSize',bold:'field3Bold',alignment:'field3Alignment',
  fill:'field3BackgroundColor',border:'field3BorderColor',wrap:'field3WrapText'});
 assert.equal(ID_CARD_ROW_PROPERTIES.length,20);
 assert.ok(ID_CARD_ROW_PROPERTIES.includes('field10Source')&&ID_CARD_ROW_PROPERTIES.includes('field1Label'));
});

test('field count, columns and caption layout are bounded with safe defaults',()=>{
 assert.equal(idCardFieldCount({}),4);
 assert.equal(idCardFieldCount({idCardFieldCount:'7'}),7);
 assert.equal(idCardFieldCount({idCardFieldCount:99}),10);
 assert.equal(idCardFieldCount({idCardFieldCount:-2}),0);
 assert.equal(idCardFieldColumns({}),1);
 assert.equal(idCardFieldColumns({idCardFieldColumns:5}),3);
 assert.equal(idCardFieldLayout({}),'inline');
 assert.equal(idCardFieldLayout({idCardFieldLayout:'stacked'}),'stacked');
});

test('published cards skip empty slots; the Page Builder keeps every slot clickable',()=>{
 const p={idCardFieldCount:5,field1Source:'@Product.Price',field3Label:'Category'};
 assert.deepEqual(idCardFieldSlots(p).map(slot=>slot.n),[1,3]);
 assert.deepEqual(idCardFieldSlots(p,true).map(slot=>slot.n),[1,2,3,4,5]);
 assert.equal(idCardFieldSlots(p,true)[1].configured,false);
});

test('each field area styles only what was authored',()=>{
 assert.deepEqual(idCardFieldStyle({},2),{});
 assert.deepEqual(idCardFieldStyle({field2TextColor:'#111',field2TextSize:200,field2Bold:true,
  field2Alignment:'right',field2BackgroundColor:'#eee',field2BorderColor:'#ccc',field2WrapText:false},2),
  {color:'#111',fontSize:96,fontWeight:700,textAlign:'right',backgroundColor:'#eee',
   border:'1px solid #ccc',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'});
 assert.deepEqual(idCardLabelStyle({idCardLabelColor:'#888',idCardLabelSize:11}),{color:'#888',fontSize:11});
});

test('dragging the image or any field saves X/Y on the component (applies to every card)',()=>{
 const rules=PART_SNAP_RULES.smart_id_card;
 for(const area of ['Image','Header','Badge',...Array.from({length:10},(_,i)=>'Field '+(i+1))])
  assert.ok(rules[area],area);
 assert.deepEqual(partOffsetKeys(partSnapRule('Custom:smart_id_card','Image')),{x:'imageOffsetX',y:'imageOffsetY'});
 assert.deepEqual(partOffsetKeys(partSnapRule('Custom:smart_id_card','Field 7')),{x:'field7OffsetX',y:'field7OffsetY'});
 assert.equal(partSnapRule('Custom:smart_id_card','Field 7').property,'field7Alignment');
});

test('renderer reuses the Card Grid engine and draws fields as Design areas + data bindings',()=>{
 const runtime=read('../src/component-libraries/smart/shared/SmartRuntime.jsx');
 assert.match(runtime,/const isGridKind=kind=>kind==="smart_card_grid"\|\|kind==="smart_id_card"/);
 assert.match(runtime,/else if\(isGridKind\(name\)\)\{/);
 assert.match(runtime,/<SmartIdCardFields p=\{p\} record=\{record\}/);
 const fields=read('../src/component-libraries/smart_id_card/SmartIdCardFields.jsx');
 assert.match(fields,/data-design-area=\{builder\?keys\.area:undefined\}/);
 assert.match(fields,/data-md-bind=\{builder\?keys\.source:undefined\}/);
 assert.match(fields,/offsetStyle\(keys\.offset\)/);
 assert.match(read('../src/core/components/RegisteredComponent/componentFormulaProps.ts'),
  /smart_id_card:new Set\(\['textSource','imageSource','badgeText',\.\.\.ID_CARD_ROW_PROPERTIES\]\)/);
});

test('Smart ID Card is registered like every Smart component',()=>{
 const manifest=JSON.parse(read('../src/component-libraries/manifest.json'));
 assert.ok(manifest.components.includes('smart_id_card/component.json'));
 const definition=JSON.parse(read('../src/component-libraries/smart_id_card/component.json'));
 assert.equal(definition.apiName,'smart_id_card');
 assert.match(read('../src/component-libraries/smart_id_card/SmartComponent.jsx'),/kind="smart_id_card"/);
 assert.match(read('../../server/src/app-seeders/smart-components.ts'),/"smart_id_card"/);
 assert.match(read('../../server/src/app-seeders/core-objects.ts'),/core-objects-unified-v(?:1[5-9]|[2-9][0-9])/);
 assert.match(read('../../server/src/system-support/system-migrations.ts'),/applySmartIdCard\(client\)/);
});

test('SQL metadata: fields, Field 1–10 Design areas and Card Grid reuse (no buttons/footer)',async()=>{
 const statements=[];
 await applySmartIdCard({query:async(sql,params)=>{statements.push({sql,params});}});
 const all=statements.map(item=>item.sql).join('\n');
 assert.match(all,/'smart-bundled:smart_id_card'/);
 for(const key of ['field1Label','field10Source','field4TextColor','field9Alignment','idCardFieldCount','idCardFieldLayout'])
  assert.ok(all.includes("'"+key+"'"),key);
 assert.match(all,/WHERE r\.component_api='smart_card_grid' AND NOT \(r\.property_key LIKE 'customButton%'/);
 assert.match(all,/'Field 10',10,'size','field10TextSize'/);
 assert.match(all,/h\.area='Header' AND h\.slot_key=s\.slot_key/);
 assert.ok(statements.every(item=>/ON CONFLICT|UPDATE md_builder_shared_properties/.test(item.sql)),
  'every statement is idempotent');
 const copied=statements.find(item=>/g\.component_api='smart_card_grid'/.test(item.sql));
 assert.deepEqual(copied.params[0],['Body','Header','Badge','Image','Grid','Focused','Others','Extras']);
});
