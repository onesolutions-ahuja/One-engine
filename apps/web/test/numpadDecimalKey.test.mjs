import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SmartNumpad from '../src/component-libraries/smart_numpad/SmartNumpad.jsx';
globalThis.React=React;

const keys=html=>[...html.matchAll(/data-numpad-key="([^"]+)"/g)].map(m=>m[1]).filter(k=>!k.startsWith('custom'));

test('A decimal Numpad has its own "." key (no page-made dot button needed)',()=>{
 const html=renderToStaticMarkup(React.createElement(SmartNumpad,{p:{numpadInputMode:'decimal',numpadPrefix:'£'},fire:()=>{},sourceValue:'',buttonLabels:[]}));
 assert.deepEqual(keys(html),['7','8','9','4','5','6','1','2','3','.','0','backspace']);
 assert.match(html,/aria-label="Decimal point"/);
 assert.match(html,/hold to clear/);
});

test('Whole-number and PIN Numpads keep C',()=>{
 for(const mode of ['integer','pin']){
  const html=renderToStaticMarkup(React.createElement(SmartNumpad,{p:{numpadInputMode:mode},fire:()=>{},sourceValue:'',buttonLabels:[]}));
  assert.deepEqual(keys(html),['7','8','9','4','5','6','1','2','3','C','0','backspace']);
 }
});

test('A value an action gives is shown even while the Numpad is being typed in',()=>{
 const html=renderToStaticMarkup(React.createElement(SmartNumpad,{p:{numpadInputMode:'decimal'},fire:()=>{},sourceValue:'12.5',given:{value:'12.5'},buttonLabels:[]}));
 assert.match(html,/value="12.5"/);
});

import {applyNumpadKey,normalizeNumpadValue,numpadSettings} from '../src/component-libraries/smart_numpad/numpadValue.mjs';
test('Date Numpad types DD/MM/YYYY and adds the slashes',()=>{
 const date=numpadSettings({numpadInputMode:'date'});
 let v='';for(const k of '01052001')v=applyNumpadKey(v,k,date);
 assert.equal(v,'01/05/2001');
 assert.equal(applyNumpadKey(v,'9',date),'01/05/2001','no more than 8 digits');
 assert.equal(applyNumpadKey('01/05','backspace',date),'01/0');
 assert.equal(applyNumpadKey('01/0','.',date),'01/0');
 assert.equal(normalizeNumpadValue('2001-05-01',date),'01/05/2001','a saved date shows as DD/MM/YYYY');
});

import SmartRuntime from '../src/component-libraries/smart/shared/SmartRuntime.jsx';
test('A Text box with a Keypad opens on-screen keys instead of the OS keyboard',()=>{
 const html=renderToStaticMarkup(React.createElement(SmartRuntime,{kind:'smart_text',keypad:'date',label:'Date of birth',onAction:()=>{}}));
 assert.match(html,/inputmode="none"/i);
 const plain=renderToStaticMarkup(React.createElement(SmartRuntime,{kind:'smart_text',label:'Name',onAction:()=>{}}));
 assert.doesNotMatch(plain,/inputmode="none"/i);
});
