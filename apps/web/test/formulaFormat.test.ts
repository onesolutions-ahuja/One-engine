import test from 'node:test';
import assert from 'node:assert/strict';
import {formulaFormat} from '../../server/src/expression-engine/FormulaFormat.ts';
import {F} from '../../server/src/page-compiler/code/formulaLibrary.ts';
import {FORMULA_DICTIONARY} from '../../server/src/page-compiler/code/formulaDictionary.ts';

const london={now:()=>new Date('2026-11-18T16:24:05Z'),timeZone:()=>'Europe/London'};

test('FORMAT numbers: fixed decimals, thousands, currency prefix, percent, negatives',()=>{
 assert.equal(formulaFormat(5.5,'0.00'),'5.50');
 assert.equal(formulaFormat(6,'0.00'),'6.00');
 assert.equal(formulaFormat(2.45,'0.0'),'2.5');
 assert.equal(formulaFormat(2.5,'0'),'3');
 assert.equal(formulaFormat(1234.5,'#,##0.00'),'1,234.50');
 assert.equal(formulaFormat(-3.3,'£0.00'),'-£3.30');
 assert.equal(formulaFormat('41.085','0.00'),'41.09');
 assert.equal(formulaFormat(0.125,'0.0%'),'12.5%');
 assert.equal(formulaFormat(7,'000'),'007');
});

test('FORMAT dates use the tenant time zone; MM is month and mm is minutes',()=>{
 const instant='2026-11-18T16:24:05.000Z';
 assert.equal(formulaFormat(instant,'DD-MM-YYYY','Europe/London'),'18-11-2026');
 assert.equal(formulaFormat(instant,'DD/MM/YYYY HH:mm','Europe/London'),'18/11/2026 16:24');
 assert.equal(formulaFormat('2026-07-01T23:30:00Z','DD MMM YY HH:mm','Europe/London'),'02 Jul 26 00:30');
 assert.equal(formulaFormat('2026-11-18','D MMMM YYYY'),'18 November 2026');
});

test('FORMAT never throws: blanks give "", wrong kinds come back as text',()=>{
 assert.equal(formulaFormat(null,'0.00'),'');
 assert.equal(formulaFormat('','DD-MM-YYYY'),'');
 assert.equal(formulaFormat('abc','0.00'),'abc');
 assert.equal(formulaFormat('not a date','DD-MM-YYYY'),'not a date');
 assert.equal(formulaFormat(12,''),'12');
});

test('FORMAT is registered as a page-code function with the tenant clock',()=>{
 assert.equal(F.FORMAT(london,2.5,'£0.00'),'£2.50');
 assert.equal(F.FORMAT(london,'2026-11-18T16:24:05Z','HH:mm'),'16:24');
 assert.ok(FORMULA_DICTIONARY.FORMAT);
});
