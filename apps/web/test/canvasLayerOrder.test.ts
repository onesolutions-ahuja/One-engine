import test from 'node:test';
import assert from 'node:assert/strict';
import {canMoveCanvasLayer, moveCanvasLayer, shiftCanvasLayer} from '../src/core/builders/PageBuilder/canvasLayerGroups.ts';

const c = (id: string, x: number, y: number, width: number, height: number) =>
  ({id, type: 'X', label: id, properties: {}, position: {x, y, width, height}}) as any;
const page = [c('bg', 0, 0, 1000, 800), c('grid', 100, 100, 300, 200), c('btn', 600, 50, 80, 40)];
const ids = (list: any[]) => list.map(item => item.id).join(',');

test('Send to back stops above a covering background', () => {
  assert.equal(ids(moveCanvasLayer(page, 'grid', 'back')), 'bg,grid,btn');
  assert.equal(ids(moveCanvasLayer(page, 'btn', 'back')), 'bg,btn,grid');
  assert.equal(canMoveCanvasLayer(page, 'grid', 'back'), false);
  assert.equal(canMoveCanvasLayer(page, 'btn', 'backward'), true);
});
test('Send backward never goes under the covering background', () => {
  assert.equal(ids(shiftCanvasLayer(page, 'grid', -1)), 'bg,grid,btn');
  assert.equal(ids(shiftCanvasLayer(page, 'btn', -1)), 'bg,btn,grid');
});
test('Non-covering siblings still reorder normally', () => {
  const flat = [c('a', 0, 0, 50, 50), c('b', 100, 0, 50, 50)];
  assert.equal(ids(moveCanvasLayer(flat, 'b', 'back')), 'b,a');
  assert.equal(ids(moveCanvasLayer(flat, 'a', 'front')), 'b,a');
});
