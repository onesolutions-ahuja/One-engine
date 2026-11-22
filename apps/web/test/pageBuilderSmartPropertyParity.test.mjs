import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applySmartBuilderPropertyParity,BUILDER_SMART_APIS}
 from '../../server/src/system-support/smart-builder-property-parity.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('property parity upgrade registers all 26 smart components and stays idempotent',async()=>{
 const calls=[];
 await applySmartBuilderPropertyParity({query:async(sql,params)=>{calls.push({sql,params});}});
 const statements=calls.map(call=>call.sql);
 const registered=statements.find(sql=>sql.includes('INSERT INTO md_builder_ribbon_components(component_api)'));
 assert.ok(registered);
 assert.equal(BUILDER_SMART_APIS.length,26);
 assert.equal(new Set(BUILDER_SMART_APIS).size,26);
 for(const api of BUILDER_SMART_APIS)
  assert.ok(registered.includes("'"+api+"'"),'missing '+api);
 assert.ok(statements.every(sql=>/ON CONFLICT|UPDATE md_builder_ribbon_component_rules|DELETE FROM md_builder_design2_slot_rules/.test(sql)),
  'all upgrade writes must be repeatable');
 assert.match(statements.join('\n'),/WHERE property_key='shapeFill'/);
});

test('a single selected-part key is written for each SQL slot, with no duplicate UPSERT inputs',async()=>{
 const calls=[];
 await applySmartBuilderPropertyParity({query:async(sql)=>{calls.push(sql);}});
 const mappingQuery=calls.find(sql=>sql.includes('INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)'));
 assert.ok(mappingQuery);
 const rows=[...mappingQuery.matchAll(/\('smart_([^']+)','([^']+)','([^']+)','([^']+)'\)/g)];
 const slots=new Set();
 for(const m of rows){
  const slot=m[1]+'/'+m[2]+'/'+m[3];
  assert.ok(!slots.has(slot),'duplicate slot: '+slot);
  slots.add(slot);
 }
 for(const [api,area,slot,key] of [
  ['smart_card_grid','Header','width','headerBoxWidth'],
  ['smart_card_grid','Grid','border','gridBorderColor'],
  ['smart_card_grid','Grid','radius','gridRadius'],
  ['smart_card_grid','Footer','radius','footerRadius'],
  ['smart_cart','Row','shadow','rowShadow'],
  ['smart_numpad','Focused','bold','numpadFocusedBold'],
  ['smart_image','Image','width','imageWidth'],
  ['smart_image','Header','alignment','labelAlignment'],
  ['smart_card_grid','Body','fill','gridBackgroundColor'],
  ['smart_id_card','Body','fill','gridBackgroundColor'],
  ['smart_card_grid','Button','width','customButton1Width'],
  ['smart_card_grid','Button 2','width','customButton2Width'],
  ['smart_card_grid','Button 3','width','cardButtonWidth'],
  ['smart_cart','Button','width','customButton1Width'],
  ['smart_cart','Button 2','width','customButton2Width'],
  ['smart_cart','Button 4','width','qtyIncreaseWidth'],
  ['smart_cart','Button 5','width','qtyDecreaseWidth'],
  ['smart_cart','Footer','alignment','footerAlignment'],
  ['smart_textbox','Header','height','headerBoxHeight'],
  ['smart_textbox','Header','width','headerBoxWidth'],
  ['smart_calendar','Focused','fill','defaultValueColor']
 ]){
  assert.ok(mappingQuery.includes("('"+[api,area,slot,key].join("','")+"')"),
   'missing binding '+[api,area,slot,key].join('/'));
 }
 assert.ok(calls.some(sql=>sql.includes("component_api='smart_cart' AND area='Button 3'")),
  'Cart Button 3 has no rendered target and must stay disabled');
});

test('Page Builder loads current frame geometry from position, not stale instance properties',()=>{
 const ribbon=read('../src/core/builders/PageBuilder/SmartRibbon.tsx');
 assert.match(ribbon,/const canvasValue=kind==='position'&&useCanvasPosition&&position/);
 assert.match(ribbon,/canvasValue\?\?properties\[key\]/);
 assert.match(ribbon,/onPositionChange\(\{\.\.\.position,\[property\.id\]:v\}/);
 assert.match(ribbon,/height:'cardBodyHeight',width:'cardBodyWidth'/);
});

test('selected-part styles are actually consumed by the correct component renderers',()=>{
 const card=read('../src/component-libraries/smart/shared/SmartRuntime.jsx');
 const cart=read('../src/component-libraries/smart_cart/SmartCart.jsx');
 const table=read('../src/component-libraries/smart_table/SmartTable.jsx');
 const chart=read('../src/component-libraries/smart_chart/SmartChart.jsx');
 const buttons=read('../src/component-libraries/smart/shared/SmartCustomButtonAppearance.js');
 for(const key of ['headerBoxWidth','headerWrapText','headerShadow','imageRadius','imageShadow',
  'badgeShadow','badgeWrapText','badgeTextAlignment','gridBorderColor','gridRadius','gridShadow',
  'supportingBoxWidth','supportingBoxHeight','supportingRadius','supportingShadow',
  'cardButtonShadow','footerRadius','footerShadow','cardBodyHeight','cardBodyWidth','focusedCardHeight','focusedCardWidth'])
  assert.ok(card.includes('p.'+key),'Card Grid missing '+key);
 for(const key of ['headerBoxWidth','headerShadow','supportingBoxWidth','supportingShadow',
  'imageWidth','imageRadius','imageShadow','footerRadius','footerShadow','rowShadow'])
  assert.ok(cart.includes('p.'+key),'Cart missing '+key);
 for(const key of ['headerShadow','rowShadow','footerAlignment'])
  assert.ok(table.includes('p.'+key),'Table missing '+key);
 for(const key of ['plotBackgroundColor','plotBorderColor','plotRadius','plotShadow'])
  assert.ok(chart.includes('p.'+key),'Chart missing '+key);
 assert.ok(buttons.includes("p[key+'Shadow']"));
});

test('Smart Image Header selection edits the rendered Label Alignment value',()=>{
 const runtime=read('../src/component-libraries/smart/shared/SmartRuntime.jsx');
 assert.match(runtime,/textAlign:\(single\?p\.labelAlignment\|\|p\.headerAlignment:p\.headerAlignment\|\|p\.labelAlignment\)\|\|"left"/);
 assert.match(runtime,/const header=text\(headerResult\.value\)\|\|\(sample\?"Product Name":preview\?"Text here":""\)/);
 assert.match(runtime,/\(Boolean\(badge\)\|\|p\.builderPreview\)/);
});
