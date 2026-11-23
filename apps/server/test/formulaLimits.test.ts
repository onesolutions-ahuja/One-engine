import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenize,PAGE_FORMULA_LIMITS} from '../src/expression-engine/FormulaTokenizer.js';
import {Parser} from '../src/expression-engine/FormulaParser.js';

const formula=(terms:number)=>'='+Array.from({length:terms},(_,i)=>String(i)).join(' + ');

test('page action formulas may use up to 1024 tokens',()=>{
 const source=formula(300); // about 600 tokens
 assert.doesNotThrow(()=>new Parser(tokenize(source,PAGE_FORMULA_LIMITS),PAGE_FORMULA_LIMITS.tokens).parse());
});

test('SQL, flow and validation formulas keep the 512-token limit',()=>{
 assert.throws(()=>new Parser(tokenize(formula(300))).parse(),/512-token complexity limit/);
});

test('page formulas above 1024 tokens are refused with the right number',()=>{
 assert.throws(()=>tokenize(formula(600),PAGE_FORMULA_LIMITS),/1024-token complexity limit/);
});
