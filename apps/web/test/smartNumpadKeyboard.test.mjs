import test from 'node:test';
import assert from 'node:assert/strict';
import {numpadKeyAction,selectNumpad,selectedNumpad,onNumpadSelection} from '../src/component-libraries/smart_numpad/numpadKeyboard.mjs';

test('keyboard keys map to numpad keys',()=>{
 assert.equal(numpadKeyAction('7','integer'),'7');
 assert.equal(numpadKeyAction('.','decimal'),'.');
 assert.equal(numpadKeyAction('.','integer'),null);
 assert.equal(numpadKeyAction('Backspace','integer'),'backspace');
 assert.equal(numpadKeyAction('Escape','integer'),'C');
 assert.equal(numpadKeyAction('Enter','integer'),'enter');
 assert.equal(numpadKeyAction('a','integer'),null);
});
test('only one numpad is selected at a time',()=>{
 const seen=[];const stop=onNumpadSelection(id=>seen.push(id));
 selectNumpad('numpad-1');selectNumpad('numpad-2');selectNumpad(null);stop();
 assert.deepEqual(seen,['numpad-1','numpad-2',null]);
 assert.equal(selectedNumpad(),null);
});
