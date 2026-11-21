import test from 'node:test';
import assert from 'node:assert/strict';
import {runFormulaText} from '../src/core/pages/PageCompiler/formulaText';
import {evaluateFlowFormula} from '../../server/src/system-files/flow-formula-runtime';
import {smartCustomButtonAppearance} from '../src/component-libraries/smart/shared/SmartCustomButtonAppearance.js';

test('CHAR(10) puts a new line in page and Flow formulas (Excel style)',()=>{
 assert.equal(runFormulaText('="Ann" & CHAR(10) & "ann@example.com"',{}).value,'Ann\nann@example.com');
 assert.equal(evaluateFlowFormula('"A" & CHAR(10) & "B"',()=>undefined,{}),'A\nB');
 assert.equal(runFormulaText('=CHAR(65)',{}).value,'A');
 assert.match(String(runFormulaText('=CHAR(0)',{}).error),/CHAR needs a character code/);
});

test('custom button wrap: blank keeps CSS, false one line, true wraps with line breaks',()=>{
 assert.deepEqual(smartCustomButtonAppearance({},'customButton1'),{});
 assert.deepEqual(smartCustomButtonAppearance({customButton1WrapText:false},'customButton1'),{whiteSpace:'nowrap'});
 assert.deepEqual(smartCustomButtonAppearance({customButton2WrapText:true},'customButton2'),{whiteSpace:'pre-line'});
});
