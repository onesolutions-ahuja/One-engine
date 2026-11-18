import test from 'node:test';
import assert from 'node:assert/strict';
import {compileActionFormula} from '../../server/src/page-compiler/code/generateCode';

test('CALLOUT and REPEAT compile to server steps with a bounded wait',()=>{
 const code=compileActionFormula("=ACTIONS(CALLOUT('QR.CreateOrder', 'Amount', 5, 'Reference', \"Sale 1\", AS(qo)), "
  +"REPEAT(CALLOUT('QR.GetOrder', 'OrderId', qo.Id, AS(qk)), qk.Result <> \"Pending\", 3, 100), "
  +"IF(qk.Result = \"Paid\", @ThisPage.Note.Value = \"Paid\", @ThisPage.Note.Value = \"Not paid\"))",'');
 assert.equal(code.data,true);
 assert.match(code.js,/\$\.service\("CALLOUT", \["QR\.CreateOrder", \{"Amount": 5, "Reference": "Sale 1"\}\]\)/);
 assert.match(code.js,/for \(let tries = 0, most = /);
 assert.match(code.js,/\$\.service\("SLEEP", \[3\]\)\)\.timeUp\) break;/);
});

test('CALLOUT needs Connector.Operation and pairs; REPEAT cannot nest',()=>{
 assert.throws(()=>compileActionFormula("=CALLOUT('QR', 'Amount', 5)",''),/Connector\.Operation/);
 assert.throws(()=>compileActionFormula("=CALLOUT('QR.CreateOrder', 'Amount')",''),/pairs/);
 assert.throws(()=>compileActionFormula("=REPEAT(REPEAT(CLOSESCREEN(), TRUE), TRUE)",''),/REPEAT cannot be nested/);
});
