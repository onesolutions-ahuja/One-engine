import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCashMove} from '../../server/src/system-support/cash-movement-service.ts';
import {compileActionFormula} from '../../server/src/page-compiler/code/generateCode';
import {FORMULA_DICTIONARY} from '../../server/src/page-compiler/code/formulaDictionary';

const session='3c18f66b-4386-4446-9cdc-1d9619e903d2';
test('CASHMOVE validates direction, amount, reason and session',()=>{
 assert.deepEqual(validateCashMove({direction:'in',amount:'20.5',reason:'Float top-up',session,reference:'cash-12345678'}),
  {direction:'IN',amount:2050,reason:'Float top-up',session,reference:'cash-12345678'});
 assert.throws(()=>validateCashMove({direction:'SIDEWAYS',amount:1,reason:'x',session,reference:'cash-12345678'}),/IN" or "OUT/);
 assert.throws(()=>validateCashMove({direction:'OUT',amount:0,reason:'x',session,reference:'cash-12345678'}),/more than zero/);
 assert.throws(()=>validateCashMove({direction:'OUT',amount:-5,reason:'x',session,reference:'cash-12345678'}),/Invalid cash amount/);
 assert.throws(()=>validateCashMove({direction:'OUT',amount:5,reason:'  ',session,reference:'cash-12345678'}),/reason/);
 assert.throws(()=>validateCashMove({direction:'OUT',amount:5,reason:'Bank drop',session:'',reference:'cash-12345678'}),/Open the till first/);
});
test('CASHMOVE compiles to a server step that writes CashLedger',()=>{
 assert.ok(FORMULA_DICTIONARY.CASHMOVE);
 const c=compileActionFormula('=ACTIONS(CASHMOVE("OUT", @ThisPage.amt.Value, @ThisPage.why.Value, @ThisPage.sess.Value, AS(m)), @ThisPage.msg.Value = "Done")','cash_count__c');
 assert.match(JSON.stringify(c),/CASHMOVE/);
});
test('CASHMOVE reports its ledger row so open lists and totals refresh',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../../server/src/system-support/page-code-runtime.ts',import.meta.url),'utf8');
 const branch=(name:string)=>source.slice(source.indexOf(`if(name==='${name}')`),source.indexOf('return result;',source.indexOf(`if(name==='${name}')`)));
 assert.match(branch('CASHMOVE'),/this\.saved\('CashLedger',result\.ledgerId,'create'\)/);
 assert.equal(source.includes("name==='RECORDPAYMENT'"),false);
});
