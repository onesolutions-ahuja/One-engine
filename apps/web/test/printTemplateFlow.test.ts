import test from 'node:test';
import assert from 'node:assert/strict';
import {flowBoxes,flowedHeight} from '../src/core/pages/PageRuntime/printTemplateFlow.ts';

// Receipt: shop name, items list (96..516), totals under it, thanks at the end.
const receipt=(delta:number)=>[{top:20,height:34,delta:0},{top:96,height:420,delta},
 {top:534,height:24,delta:0},{top:616,height:34,delta:0},{top:706,height:28,delta:0}];

test('a print template fits its rows: 1 item uses less paper, 100 items more',()=>{
 const one=flowBoxes(receipt(-340));
 assert.deepEqual(one.map(b=>b.top),[20,96,194,276,366]);
 assert.equal(one[1].height,80);
 assert.equal(flowedHeight(one),414);
 const many=flowBoxes(receipt(3000));
 assert.equal(many[4].top,3706);
 assert.equal(flowedHeight(many),3754);
 assert.deepEqual(flowBoxes(receipt(0)),receipt(0).map(({top,height})=>({top,height})));
});

test('things beside the list (not below it) stay where they are; lists never vanish',()=>{
 const out=flowBoxes([{top:100,height:200,delta:-500},{top:120,height:20,delta:0},{top:310,height:20,delta:0}]);
 assert.equal(out[0].height,24);
 assert.equal(out[1].top,120);
 assert.equal(out[2].top,134);
});
