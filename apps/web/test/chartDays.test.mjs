import test from 'node:test';
import assert from 'node:assert/strict';
import {chartSettings,chartPoints,dayLabels} from '../src/component-libraries/smart_chart/chartData.mjs';

test('Last N days shows every day in order, with 0 for days without rows',()=>{
 const today=new Date(2026,10,20);
 assert.deepEqual(dayLabels(3,today),['18 Nov','19 Nov','20 Nov']);
 const rows=[{d:'20 Nov',v:5},{d:'18 Nov',v:2},{d:'20 Nov',v:1},{d:'01 Jan',v:9}];
 const points=chartPoints(rows,r=>r.d,r=>r.v,chartSettings({chartDays:3}),today);
 assert.deepEqual(points.map(p=>[p.label,p.value]),[['18 Nov',2],['19 Nov',0],['20 Nov',6]]);
 assert.equal(chartSettings({}).days,0);
 assert.deepEqual(dayLabels(2,new Date(2027,0,1)),['31 Dec','01 Jan']);
});
