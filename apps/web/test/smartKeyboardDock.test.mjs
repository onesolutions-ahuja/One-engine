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

test('Smart Dock shows 1–12 items with labels, badges, visibility and active item',()=>{
 assert.equal(dockSettings({}).count,4);
 assert.equal(dockSettings({dockItemCount:9}).count,9);
 assert.equal(dockSettings({dockItemCount:20}).count,12);
 assert.equal(dockSettings({dockItemCount:0}).count,4);
 const p={dockItemCount:3,dockItem1Icon:'house',dockItem1Label:'Home',dockItem2Icon:'receipt',
  dockItem2Label:'Orders',dockItem2Badge:'1200',dockItem3Label:'Hidden',dockItem3Visible:'false'};
 const items=dockItems(p);
 assert.deepEqual(items.map(i=>i.index),[1,2]);
 assert.equal(items[1].badge,'99+');
 assert.equal(dockItems({dockItem1Badge:'0'})[0].badge,'');
 assert.equal(dockSettings({__dockActiveItem:'3'}).activeItem,3);
 assert.equal(dockSettings({__dockActiveItem:'13'}).activeItem,null);
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
  ['click',...Array.from({length:12},(_,i)=>'dockItem'+(i+1))]);
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

test('Smart Table and Smart Icon also use the iOS Style',()=>{
 const table=read('../src/component-libraries/smart_table/SmartTable.jsx');
 assert.match(table,/const ios=true;/);
 assert.match(table,/colour\(p\.headerBodyColor,ios\?"#f9f9fb":"#f3f6fb"\)/,'configured colour still first');
 assert.match(read('../src/component-libraries/smart_table/SmartComponent.css'),/^@import "\.\.\/smart\/shared\/smart-ios\.css";/);
 const icon=read('../src/component-libraries/smart_icon/SmartComponent.jsx');
 assert.match(icon,/p\.iconFillColor:ios\?"#007aff":"#000000"/);
 assert.match(read('../../server/src/system-support/smart-ios-keyboard-dock.ts'),/const STYLED=\['smart_table','smart_icon'/);
});

test('iOS Style is the only Smart style and never overrides configured values',()=>{
 const runtime=read('../src/component-libraries/smart/shared/SmartRuntime.jsx');
 assert.match(runtime,/const ios=true;/);
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
 assert.match(ribbon,/'tableSidePadding','visualStyle'\]\.includes\(property\.id\)/,'no Classic\/iOS switch in Others');
});


test('Key Gap uses the shared Card Gap setting for every key-based component',()=>{
 const numpad=read('../src/component-libraries/smart_numpad/SmartNumpad.jsx');
 const keyboard=read('../src/component-libraries/smart_keyboard/SmartKeyboard.jsx');
 const dock=read('../src/component-libraries/smart_dock/SmartDock.jsx');
 for(const component of [numpad,keyboard,dock]){
  assert.match(component,/p\.gap\?\?p\.numpadGap/,
   'shared gap wins; legacy page values remain readable');
  assert.doesNotMatch(component,/size\(p\.numpadGap,/);
 }
 const sql=read('../../server/src/system-support/system-migrations.ts');
 for(const api of ['smart_numpad','smart_keyboard','smart_dock'])
  assert.match(sql,new RegExp("\\('"+api+"'"));
 assert.match(sql,/property_key='gap'/);
 assert.match(sql,/slot_key='extra_cardGap'/);
 assert.match(sql,/SET enabled=false\s+WHERE property_key='numpadGap'/);
 const seeder=read('../../server/src/system-support/smart-ios-keyboard-dock.ts');
 assert.doesNotMatch(seeder,/\['numpadGap'/);
 const hidden=read('../src/core/builders/PageBuilder/layoutRibbonVisibility.ts');
 assert.match(hidden,/'numpadGap'/);
 const ribbon=read('../src/core/builders/PageBuilder/SmartRibbon.tsx');
 assert.match(ribbon,/properties\.numpadGap:undefined/);
 const style=read('../src/core/builders/PageBuilder/PageBuilderDesignDock.css');
 assert.match(style,/\[data-others-group="Spacing"\][\s\S]*?repeat\(2,minmax\(0,1fr\)\)/);
});

test('Design properties keep their place for every selection and feature groups follow visibility',()=>{
 const ribbon=read('../src/core/builders/PageBuilder/SmartRibbon.tsx');
 const pageRibbon=read('../src/core/builders/PageBuilder/editor/ribbon/createPageRibbon.tsx');
 const layoutVisibility=read('../src/core/builders/PageBuilder/layoutRibbonVisibility.ts');
 const css=read('../src/core/builders/PageBuilder/PageBuilderDesignDock.css');

 // The Design area list cannot be filtered by the selected component.
 assert.doesNotMatch(ribbon,/fixedAreaComponents/);
 assert.match(ribbon,/const design2Areas=\[\.\.\.new Map\(design2Slots/);
 assert.match(ribbon,/aria-label=\{group\} data-others-group=\{group\}/);
 assert.match(ribbon,/\['Calendar','Keyboard','Dock','Chart'\]\.map\(group=>/);
 assert.match(pageRibbon,/renderSmartRibbon\('designTail'\)/);
 assert.match(ribbon,/property\.components\.includes\(api\)/);

 // Only the former UI duplicates disappear; saved values still use original keys.
 assert.match(ribbon,/const basePaddingKey=api==='smart_card_grid'\?'cardPadding':'numpadPadding'/);
 assert.match(ribbon,/const paddingKey=api==='smart_cart'\?'tableSidePadding':basePaddingKey/);
 assert.match(ribbon,/api==='smart_dock'\?\[\{key:'dockItemCount',label:'Count'\}\]/);
 assert.match(ribbon,/\['numpadGap','numpadPadding','dockItemCount',\s*'numpadPrefix','numpadSuffix','tableSidePadding','visualStyle'\]/);
 assert.match(ribbon,/\[paddingKey\]:next\},\[paddingKey\]/);
 assert.match(ribbon,/\?properties\.numpadGap:undefined/);

 // All 12 Dock items use the same real icon picker.
 assert.match(ribbon,/\^dockItem\(\?:\[1-9\]\|1\[0-2\]\)Icon\$/);
 assert.match(ribbon,/allowIcons onChange=\{write\}/);

 // A single visibility toggle remains, with conditional rules still editable.
 assert.doesNotMatch(pageRibbon,/Visible on this page/);
 assert.match(ribbon,/aria-label="Component visibility"/);
 assert.match(pageRibbon,/Edit conditional visibility/);
 assert.match(layoutVisibility,/propertyKey==='tabWidth'\|\|propertyKey==='tabHeight'/);
 assert.match(css,/smart-design2-tail/);
});
