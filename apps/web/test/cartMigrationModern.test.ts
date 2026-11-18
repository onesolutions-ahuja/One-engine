import test from 'node:test';
import assert from 'node:assert/strict';
import {rewriteLegacyCartText} from '../../../scripts/cart/cart-legacy-references.mjs';

test('the deploy-time Cart migration leaves current page-session lookups as written',()=>{
 const modern='=GETRECORD(Cart, SessionKey, @ThisPage.Session.Id, Status, "Open", AS(cur))';
 assert.equal(rewriteLegacyCartText(modern,{page:true}),modern);
 assert.equal(rewriteLegacyCartText('=GETRECORD(Cart, SessionKey, $session.id, AS(c))',{page:true}),
  '=GETRECORD(Cart, Id, $session.cartId, AS(c))');
});
