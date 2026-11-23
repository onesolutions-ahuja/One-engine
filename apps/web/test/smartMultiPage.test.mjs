import test from 'node:test';
import assert from 'node:assert/strict';
import {pageKeyList,shownPages,activePage} from '../src/component-libraries/smart_multipage/multiPageModel.js';

const pages=['Cash','Card','PayPal','GiftCard'].map(key=>({key,label:key}));
test('visible tabs keep formula order and ignore blanks/duplicates',()=>{
 assert.deepEqual(pageKeyList(' paypal, Cash ,,cash'),['paypal','Cash']);
 assert.deepEqual(shownPages(pages,'PayPal,Cash').map(p=>p.key),['PayPal','Cash']);
 assert.equal(shownPages(pages,'').length,4);
 assert.equal(shownPages(pages,'Cash',true).length,4);
 assert.deepEqual(shownPages(pages,'Klarna'),[]);
});
test('open page: builder selection, then tapped tab, then Active tab, then first',()=>{
 const shown=shownPages(pages,'Cash,PayPal');
 assert.equal(activePage(shown,{}).key,'Cash');
 assert.equal(activePage(shown,{active:'paypal'}).key,'PayPal');
 assert.equal(activePage(shown,{active:'PayPal',picked:'Cash'}).key,'Cash');
 assert.equal(activePage(shown,{active:'Card'}).key,'Cash');
 assert.equal(activePage(pages,{picked:'Cash',selected:'GiftCard'}).key,'GiftCard');
 assert.equal(activePage([],{}),null);
});
