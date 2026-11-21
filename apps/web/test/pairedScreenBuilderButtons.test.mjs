import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SmartPairedScreens from '../src/component-libraries/smart_paired_screens/SmartComponent.jsx';

globalThis.React=React;

test('builder shows every independent pairing button without actually pairing a device',()=>{
 const rendered=renderToStaticMarkup(React.createElement(SmartPairedScreens,{
  builderPreview:true,label:'Screens',textSource:'"smart_till_customer_display"',
  pairedAddFill:'#111111',pairedPairFill:'#222222',pairedRenameFill:'#333333',
  pairedUnpairFill:'#444444',pairedCancelFill:'#555555',
  pairedRenameTextSize:19,pairedCancelHeight:44
 }));
 const buttons=['Button','Button 2','Button 3','Button 4','Button 5'];
 for(const area of buttons)
  assert.ok(rendered.includes('data-design-area="'+area+'"'),'Missing editable '+area);
 assert.ok(rendered.includes('background-color:#111111'),'Add Fill must take effect');
 assert.ok(rendered.includes('background-color:#222222'),'Pair Fill must take effect');
 assert.ok(rendered.includes('font-size:19px'),'Rename TextSize must take effect');
 assert.ok(rendered.includes('height:44px'),'Cancel Height must take effect');
 assert.ok(rendered.includes('background-color:#555555'),'Cancel Fill must take effect');
 assert.ok(rendered.includes('background-color:#444444'),'Unpair Fill must take effect');
 assert.ok(!rendered.includes('Screens are unavailable'),'No real pairing request in design');
});
