import test from 'node:test';
import assert from 'node:assert/strict';
import {criteriaMatch,aggregateRows,rowMatches} from '../../server/src/page-compiler/code/formulaLibrary.ts';

test('SUMIFS by day matches Date fields stored with a time (agrees with COUNTIFS)',()=>{
 const rows=[{Total:6.99,InvoiceDate:'2026-11-18T00:00:00.000Z'},{Total:3.98,InvoiceDate:'2026-11-18'},
  {Total:9,InvoiceDate:'2026-11-17T23:00:00.000Z'}];
 const today=rows.filter(row=>rowMatches(row,[['InvoiceDate','2026-11-18']]));
 assert.equal(aggregateRows('SUMIFS',today,'Total'),10.97);
 assert.equal(criteriaMatch(new Date('2026-11-18T10:00:00Z'),'2026-11-18'),true);
 assert.equal(criteriaMatch('2026-11-18x','2026-11-18'),false);
 assert.equal(criteriaMatch('Cash','Cash'),true);
});
