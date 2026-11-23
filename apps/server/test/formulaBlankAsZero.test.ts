import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFormulaBinary} from '../src/expression-engine/FormulaParser.js';

test('blank values count as 0 in arithmetic, as in Excel',()=>{
 assert.equal(evaluateFormulaBinary('*',2,null),0);       // Quantity * blank Cost
 assert.equal(evaluateFormulaBinary('-',0,''),0);
 assert.equal(evaluateFormulaBinary('+',1,undefined),1);
 assert.throws(()=>evaluateFormulaBinary('*',2,'abc'),/finite/); // real text still fails
});
