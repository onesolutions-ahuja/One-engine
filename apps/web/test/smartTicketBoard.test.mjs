import test from 'node:test';
import assert from 'node:assert/strict';
import {lineVisible,fieldName,groupTickets,timeOf,sortTickets,formatAge,ageLevel,lineState,packColumns,columnCountFor,estimateHeight}
 from '../src/component-libraries/smart_ticket_board/ticketBoardModel.js';

test('group field: any spelling becomes the row field',()=>{
 for(const text of ['@OrderLine.Order','OrderLine.Order','Order',' =@OrderLine.Order '])assert.equal(fieldName(text),'Order');
 assert.equal(fieldName(''),'');
});
test('rows group into tickets in first-seen order; no group field = one ticket per row',()=>{
 const rows=[{Id:'1',Order:'B'},{Id:'2',Order:'A'},{Id:'3',Order:'B'},{Id:'4',Order:''},null];
 assert.deepEqual(groupTickets(rows,'@OrderLine.Order').map(t=>[t.key,t.rows.map(r=>r.Id)]),[['B',['1','3']],['A',['2']]]);
 assert.deepEqual(groupTickets(rows,'').map(t=>t.key),['1','2','3','4']);
});
test('tickets sort oldest first; untimed ones keep order at the end',()=>{
 const list=[{key:'a',time:null},{key:'b',time:300},{key:'c',time:100},{key:'d',time:null}];
 assert.deepEqual(sortTickets(list).map(t=>t.key),['c','b','a','d']);
 assert.equal(timeOf('2026-11-25T10:00:00Z'),Date.parse('2026-11-25T10:00:00Z'));
 assert.equal(timeOf('soon'),null);
});
test('age text and colour level (defaults 10 / 15 minutes)',()=>{
 assert.equal(formatAge(65000),'1:05');
 assert.equal(formatAge(3725000),'1:02:05');
 assert.equal(ageLevel(9*60000),'ok');
 assert.equal(ageLevel(10*60000),'warn');
 assert.equal(ageLevel(15*60000),'late');
 assert.equal(ageLevel(6*60000,5,8),'warn');
 assert.equal(ageLevel(6*60000,'',''),'ok','blank keeps defaults');
});
test('line state words',()=>{
 assert.equal(lineState('Done'),'done');
 assert.equal(lineState('Void'),'void');
 assert.equal(lineState('86'),'void');
 assert.equal(lineState('Short'),'short');
 assert.equal(lineState('Held'),'held');
 assert.equal(lineState('New'),'');
});
test('cards pack into the shortest column, oldest top-left',()=>{
 const tickets=[{k:1,h:500},{k:2,h:100},{k:3,h:100},{k:4,h:100}];
 assert.deepEqual(packColumns(tickets,2,t=>t.h).map(c=>c.map(t=>t.k)),[[1],[2,3,4]]);
 assert.deepEqual(packColumns(tickets,0,t=>t.h).length,1);
 assert.equal(columnCountFor(1260,300,14),4);
 assert.equal(columnCountFor(1240,300,14),3);
 assert.equal(columnCountFor(200,300,14),1);
 assert.equal(estimateHeight({lines:Array.from({length:50},()=>({}))},560),560,'long tickets are capped (they scroll inside)');
});
test('show line when: only false-like values hide a line',()=>{
 for(const v of [false,'FALSE',0,'0','no'])assert.equal(lineVisible(v),false);
 for(const v of [true,'TRUE','',null,'Grill'])assert.equal(lineVisible(v),true);
});
