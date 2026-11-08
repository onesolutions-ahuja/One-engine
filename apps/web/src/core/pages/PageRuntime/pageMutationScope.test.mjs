import test from 'node:test';
import assert from 'node:assert/strict';
import {pageComponentReadObjectNames,shouldInvalidatePageComponent} from './pageMutationScope.js';
import {formulaAggregateObjects,mutationAffectsFormulas,isRowIndependentFormula}
 from '../../../component-libraries/shared/useSqlFormulaDisplay.js';

const objects=['Product','MenuCategory','Cart','CartLine'].map(apiName=>({apiName,fields:[{apiName:'Name'},{apiName:'Price'}]}));
const clickFormula='=ACTIONS(IF(COUNTIFS(Cart, SessionKey, $session, Status, "Open") = 0, CREATERECORD(Cart, SessionKey, $session), ""), GETRECORD(Cart, Id, $session.cartId, AS(cart)), UPDATERECORD(Cart, cart.Id, Subtotal, SUMIFS(CartLine, LineTotal, Cart, cart.Id, Status, "Open")))';
const detail=(names,extra={})=>({pageSessionKey:'p',sessionId:'s',objectApiNames:names,...extra});

test('a Product grid whose click formula writes CartLine does not READ CartLine',()=>{
 const reads=pageComponentReadObjectNames('Product',{objectApiName:'Product',onClick:clickFormula,title:'@Name'},objects);
 assert.deepEqual(reads,['Product']);
 assert.equal(shouldInvalidatePageComponent(detail(['CartLine']),'p','s',reads),false);
});
test('a component that displays a CartLine total DOES reload on a CartLine write',()=>{
 const reads=pageComponentReadObjectNames('Cart',{objectApiName:'Cart',total:'=SUMIFS(CartLine,LineTotal,Cart,Id)'},objects);
 assert.ok(reads.includes('CartLine'));
 assert.equal(shouldInvalidatePageComponent(detail(['CartLine']),'p','s',reads),true);
 assert.equal(shouldInvalidatePageComponent(detail(['Product']),'p','s',reads),false);
});
test('unknown writes, session changes and unparseable formulas still refresh everything',()=>{
 assert.equal(shouldInvalidatePageComponent({pageSessionKey:'p',sessionId:'s'},'p','s',['Product']),true);
 assert.equal(shouldInvalidatePageComponent(detail(['CartLine'],{sessionId:'other'}),'p','s',['Product']),true);
 assert.equal(shouldInvalidatePageComponent(detail(['CartLine']),'p','s',null),true);
 assert.equal(shouldInvalidatePageComponent(detail(['CartLine'],{pageSessionKey:'x'}),'p','s',null),false);
});
test('TABLE/COLLECTION sources count as reads even when not selected (never stale)',()=>{
 const reads=pageComponentReadObjectNames('Product',{objectApiName:'Product',collectionFormula:'=TABLE(CartLine,Name)'},objects);
 assert.ok(reads.includes('CartLine'));
});
test('formula refresh: only formulas that aggregate a written object are re-asked',()=>{
 assert.deepEqual(formulaAggregateObjects('SUMIFS(CartLine,LineTotal,Cart,Id)'),['CartLine']);
 assert.deepEqual(formulaAggregateObjects('UPPER(Name)'),[]);
 assert.deepEqual(formulaAggregateObjects('ROUND(SUMIFS(CartLine,LineTotal,S,$session)+COUNTIFS(Cart,S,$session),2)').sort(),['Cart','CartLine']);
 assert.equal(mutationAffectsFormulas(detail(['CartLine']),'p',['CartLine']),true);
 assert.equal(mutationAffectsFormulas(detail(['Product']),'p',['CartLine']),false);
 assert.equal(mutationAffectsFormulas(detail([]),'p',['CartLine']),true);
 assert.equal(mutationAffectsFormulas(detail(['CartLine'],{pageSessionKey:'other'}),'p',['CartLine']),false);
 assert.equal(mutationAffectsFormulas(detail(['CartLine']),'p',[]),false);
});
test('row-independent detection still holds',()=>{
 assert.equal(isRowIndependentFormula('SUMIFS(CartLine,LineTotal,S,$session)'),true);
 assert.equal(isRowIndependentFormula('ROUND(Price,2)'),false);
});
