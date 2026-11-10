import test from 'node:test';
import assert from 'node:assert/strict';
import {partSnapRule,snapPartValue,partSnapLabel} from '../src/core/builders/PageBuilder/canvasPartSnap';
import {smartPartOrderStyle,smartPartSide} from '../src/component-libraries/smart/shared/SmartPartPlacement.js';

const box={left:100,top:200,width:300,height:150};
const at=(fx:number,fy:number)=>({x:box.left+fx*box.width,y:box.top+fy*box.height});

test('only listed parts of listed components can be dragged',()=>{
 assert.deepEqual(partSnapRule('Custom:smart_card_grid','Badge'),{property:'badgeAlignment',mode:'badge'});
 assert.equal(partSnapRule('Custom:smart_cart','Button 5')?.property,'qtyDecreasePlacement');
 assert.equal(partSnapRule('Custom:smart_cart','Button 4')?.property,'qtyIncreasePlacement');
 assert.equal(partSnapRule('Custom:smart_card_grid','Button 3')?.property,'cardButtonPlacement');
 assert.equal(partSnapRule('Custom:smart_card_grid','Body'),undefined);
 assert.equal(partSnapRule('Custom:smart_numpad','Button 2'),undefined);
 assert.equal(partSnapRule('Custom:smart_card_grid','constructor'),undefined);
 assert.equal(partSnapRule('Custom:smart_card_grid',undefined),undefined);
});

test('badge snaps to the seven positions the badge dropdown offers',()=>{
 assert.equal(snapPartValue('badge',at(.05,.05),box),'image-top-left');
 assert.equal(snapPartValue('badge',at(.5,.1),box),'image-top-center');
 assert.equal(snapPartValue('badge',at(.95,.1),box),'image-top-right');
 assert.equal(snapPartValue('badge',at(.5,.5),box),'image-center');
 assert.equal(snapPartValue('badge',at(.1,.9),box),'image-bottom-left');
 assert.equal(snapPartValue('badge',at(.5,.95),box),'image-bottom-center');
 assert.equal(snapPartValue('badge',at(.9,.9),box),'image-bottom-right');
 // Middle row at a side goes to the nearer corner.
 assert.equal(snapPartValue('badge',at(.05,.4),box),'image-top-left');
 assert.equal(snapPartValue('badge',at(.95,.6),box),'image-bottom-right');
 // Dropped outside the card: clamped to the nearest edge.
 assert.equal(snapPartValue('badge',{x:9999,y:-50},box),'image-top-right');
});

test('image snaps to the nearest edge; buttons to a side; text to a third',()=>{
 assert.equal(snapPartValue('edges',at(.02,.5),box),'left');
 assert.equal(snapPartValue('edges',at(.5,.03),box),'top');
 assert.equal(snapPartValue('edges',at(.97,.5),box),'right');
 assert.equal(snapPartValue('edges',at(.5,.98),box),'bottom');
 assert.equal(snapPartValue('sides',at(.49,.5),box),'left');
 assert.equal(snapPartValue('sides',at(.51,.5),box),'right');
 assert.equal(snapPartValue('align',at(.2,.5),box),'left');
 assert.equal(snapPartValue('align',at(.5,.5),box),'center');
 assert.equal(snapPartValue('align',at(.8,.5),box),'right');
 assert.equal(partSnapLabel('image-bottom-center'),'Bottom Center');
 assert.equal(partSnapLabel('left'),'Left');
});

test('button side adds no style unless moved off the side it always used',()=>{
 assert.deepEqual(smartPartOrderStyle(undefined,'right'),{});
 assert.deepEqual(smartPartOrderStyle('','left'),{});
 assert.deepEqual(smartPartOrderStyle('right','right'),{});
 assert.deepEqual(smartPartOrderStyle('left','right'),{order:-1});
 assert.deepEqual(smartPartOrderStyle('right','left'),{order:1});
 assert.equal(smartPartSide('middle','left'),'left');
});
