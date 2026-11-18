import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFormulaDateBinary} from '../../server/src/expression-engine/FormulaDate';

test('a Date compares with a DateTime by calendar day (no matching-types error)',()=>{
 assert.deepEqual(evaluateFormulaDateBinary('=','2026-11-18T00:00:00.000Z','2026-11-18','Europe/London'),{handled:true,value:true});
 assert.deepEqual(evaluateFormulaDateBinary('<','2026-11-17T23:30:00.000Z','2026-11-18','Europe/London'),{handled:true,value:true});
 assert.deepEqual(evaluateFormulaDateBinary('<>','2026-11-12','2026-11-18T10:00:00.000Z','UTC'),{handled:true,value:true});
 assert.throws(()=>evaluateFormulaDateBinary('-','2026-11-18T00:00:00.000Z','2026-11-18','UTC'),/matching types/);
});
