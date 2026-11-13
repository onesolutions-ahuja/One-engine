import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyKeyboardKey,keyboardRows,keyboardSettings,nextShift,shouldAutoCapitalize,startPage}
 from '../src/component-libraries/smart_keyboard/keyboardValue.mjs';
import {dockItems,dockSettings} from '../src/component-libraries/smart_dock/dockItems.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Smart Keyboard edits text at the caret, including selections and backspace',()=>{
 assert.deepEqual(applyKeyboardKey('helo','l',3,3),{value:'hello',caret:4});
 assert.deepEqual(applyKeyboardKey('hello world','x',0,5),{value:'x world',caret:1});
 assert.deepEqual(applyKeyboardKey('abc','backspace',3,3),{value:'ab',caret:2});
 assert.deepEqual(applyKeyboardKey('abc','backspace',0,0),{value:'abc',caret:0});
 assert.deepEqual(applyKeyboardKey('abc','backspace',0,3),{value:'',caret:0});
 assert.deepEqual(applyKeyboardKey('a😀','backspace'),{value:'a',caret:1});
 assert.deepEqual(applyKeyboardKey('','space'),{value:' ',caret:1});
 assert.deepEqual(applyKeyboardKey(null,'.com'),{value:'.com',caret:4});
});

test('Smart Keyboard layouts follow iOS pages and keyboard types',()=>{
 const text=keyboardSettings({});
 const letters=keyboardRows('letters',text,'off');
 assert.equal(letters.length,4);
 assert.equal(letters[0].map(k=>k.key).join(''),'qwertyuiop');
 assert.equal(letters[2][0].kind,'shift');
 assert.equal(letters[2].at(-1).kind,'backspace');
 assert.equal(keyboardRows('letters',text,'once')[0][0].key,'Q');
 assert.equal(keyboardRows('numbers',text)[2][0].label,'#+=');
 assert.equal(keyboardRows('symbols',text)[2][0].label,'123');
 const email=keyboardRows('letters',keyboardSettings({keyboardLayout:'email'}))[3].map(k=>k.key);
 assert.ok(email.includes('@')&&email.includes('.'));
 const url=keyboardRows('letters',keyboardSettings({keyboardLayout:'url'}))[3].map(k=>k.key);
 assert.ok(url.includes('/')&&url.includes('.com'));
 assert.equal(startPage(keyboardSettings({keyboardLayout:'number'})),'numbers');
 assert.equal(keyboardSettings({keyboardReturnLabel:'nope'}).returnLabel,'return');
 assert.equal(keyboardRows('letters',keyboardSettings({keyboardReturnLabel:'done'}))[3].at(-1).label,'done');
});

test('Smart Keyboard shift and auto-capitals behave like iOS',()=>{
 assert.equal(nextShift('off',false),'once');
 assert.equal(nextShift('once',true),'lock');
 assert.equal(nextShift('once',false),'off');
 assert.equal(nextShift('lock',false),'off');
 assert.equal(shouldAutoCapitalize('',0),true);
 assert.equal(shouldAutoCapitalize('Hi. ',4),true);
 assert.equal(shouldAutoCapitalize('Hi there',8),false);
 assert.equal(keyboardSettings({keyboardHideDeviceKeyboard:false}).hideDeviceKeyboard,false);
 assert.equal(keyboardSettings({}).showOnFocus,false);
});

test('Smart Dock shows 1–6 items with labels, badges, visibility and active item',()=>{
 assert.equal(dockSettings({}).count,4);
 assert.equal(dockSettings({dockItemCount:9}).count,6);
 assert.equal(dockSettings({dockItemCount:0}).count,4);
 const p={dockItemCount:3,dockItem1Icon:'house',dockItem1Label:'Home',dockItem2Icon:'receipt',
  dockItem2Label:'Orders',dockItem2Badge:'1200',dockItem3Label:'Hidden',dockItem3Visible:'false'};
 const items=dockItems(p);
 assert.deepEqual(items.map(i=>i.index),[1,2]);
 assert.equal(items[1].badge,'99+');
 assert.equal(dockItems({dockItem1Badge:'0'})[0].badge,'');
 assert.equal(dockSettings({__dockActiveItem:'3'}).activeItem,3);
 assert.equal(dockSettings({__dockActiveItem:'7'}).activeItem,null);
 assert.equal(dockSettings({navigationDirection:'vertical'}).direction,'vertical');
 // Builder preview fills blank items with sample icons so the dock is visible.
 assert.equal(dockItems({builderPreview:true})[0].label,'Home');
 assert.equal(dockItems({})[0].label,'');
 // Labels resolve through the shared formula engine when provided.
 const resolved=dockItems({dockItem1Label:'=@Name'},(key,value)=>key==='dockItem1Label'?'Ada':value);
 assert.equal(resolved[0].label,'Ada');
});

test('Smart Keyboard and Dock are registered like every Smart component',()=>{
 const manifest=JSON.parse(read('../src/component-libraries/manifest.json'));
 for(const api of ['smart_keyboard','smart_dock']){
  assert.ok(manifest.components.includes(api+'/component.json'),api);
  const descriptor=JSON.parse(read('../src/component-libraries/'+api+'/component.json'));
  assert.equal(descriptor.apiName,api);
  assert.deepEqual(descriptor.propertyDefinitions,[]);
 }
 const dock=JSON.parse(read('../src/component-libraries/smart_dock/component.json'));
 assert.deepEqual(dock.eventDefinitions.map(e=>e.apiName),
  ['click','dockItem1','dockItem2','dockItem3','dockItem4','dockItem5','dockItem6']);
 const seeder=read('../../server/src/app-seeders/smart-components.ts');
 assert.match(seeder,/"smart_keyboard","smart_dock"/);
 const migration=read('../../server/src/system-support/system-migrations.ts');
 assert.match(migration,/await applySmartIosKeyboardDock\(client\)/);
 const palette=read('../src/core/builders/PageBuilder/editor/ribbon/usePagePalette.tsx');
 assert.match(palette,/'Custom:smart_keyboard':return <Keyboard/);
 assert.match(palette,/'Custom:smart_dock':return <PanelBottom/);
 const events=read('../src/core/builders/PageBuilder/SmartEventActionsRibbon.tsx');
 assert.match(events,/event==='dismiss'\?api==='smart_keyboard'/);
});

test('iOS Style is opt-in per saved component and never overrides configured values',()=>{
 const runtime=read('../src/component-libraries/smart/shared/SmartRuntime.jsx');
 assert.match(runtime,/const ios=p\.visualStyle==="iOS"/);
 assert.match(runtime,/\(ios\?" smart-ios":""\)/);
 // Configured colours stay first in every fallback.
 assert.match(runtime,/p\.backgroundColor\|\|\(ios\?"#007aff":"#2267bc"\)/);
 const css=read('../src/component-libraries/smart/shared/smart-ios.css');
 assert.doesNotMatch(css.replace(/@media \(prefers-reduced-motion[\s\S]*$/,''),/!important/,
  'iOS defaults must not beat inline (configured) styles');
 assert.match(css,/:not\(\[data-builder-preview\]\)/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(read('../src/component-libraries/smart/shared/smart.css'),/^@import "\.\/smart-ios\.css";/);
 const sql=read('../../server/src/system-support/smart-ios-keyboard-dock.ts');
 assert.match(sql,/\['visualStyle','Style','Design2','Others','choice',json\('iOS'\)/);
 assert.doesNotMatch(sql,/UPDATE\s+md_page|DELETE\s+FROM/i,'no saved page or component is rewritten');
 const ribbon=read('../src/core/builders/PageBuilder/SmartRibbon.tsx');
 assert.match(ribbon,/property\.id==='visualStyle'\?'Classic'/);
});
