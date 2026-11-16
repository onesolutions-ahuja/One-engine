import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeQr} from '../src/component-libraries/smart_qr/qrEncode.mjs';

test('Smart QR encodes text into a valid-size matrix with finder patterns',()=>{
 for(const [text,size] of [['hello',21],['https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T',37]]){
  const m=encodeQr(text);
  assert.equal(m.length,size);
  // Top-left finder: dark outer ring, light ring, dark 3x3 centre.
  assert.equal(m[0][0],true);assert.equal(m[1][1],false);assert.equal(m[3][3],true);
  assert.equal(m[0][size-1],true);assert.equal(m[size-1][0],true);
 }
 assert.deepEqual(encodeQr('same'),encodeQr('same'));
 assert.equal(encodeQr('x'.repeat(900)).length>100,true);
 assert.throws(()=>encodeQr('x'.repeat(3000)),/too long/);
});
