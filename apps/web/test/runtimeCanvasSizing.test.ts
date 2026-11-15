import test from 'node:test';
import assert from 'node:assert/strict';
import type {LightningPageMetadata,PageComponentMetadata} from '../src/core/metadata/Definitions/metadata';
import {
  runtimeCanvasWidthScale,runtimeCanvasExtraWidth,
  runtimeRightColumnStart,runtimeResponsiveComponentStyle
} from '../src/core/pages/PageRuntime/runtimeCanvasSizing';
import {resolvePageComponentStyle} from '../src/core/pages/TemplatePageRuntime/pageComponentLayout';

const component=(id:string,x:number,y:number,width:number,height:number):PageComponentMetadata=>({
  id,type:'Custom:smart_card_grid',label:id,visible:true,properties:{},
  position:{x,y,width,height}
});
const products=component('products',18,185,772,590);
const dock=component('dock',18,812,772,56);
const cart=component('cart',810,170,570,710);
const customer=component('customer',1070,15,300,42);
const background=component('background',0,0,1400,900);
const page={
  canvasWidth:1400,canvasHeight:900,components:[background,products,dock,cart,customer]
} as Pick<LightningPageMetadata,'canvasWidth'|'canvasHeight'|'components'>;

test('published free canvases fit narrow screens by width, never shrink just for height',()=>{
  assert.equal(runtimeCanvasWidthScale(1400,1050),.75);
  assert.equal(runtimeCanvasWidthScale(1400,1600),1);
  assert.equal(runtimeCanvasWidthScale(1400,1400),1);
  assert.equal(runtimeCanvasExtraWidth(1400,1050),0);
  assert.equal(runtimeCanvasExtraWidth(1400,1800),400);
  assert.equal(runtimeCanvasWidthScale(0,1000),1);
});

test('a large right-hand panel is detected generically from saved geometry',()=>{
  assert.equal(runtimeRightColumnStart(page),810);
  assert.equal(runtimeRightColumnStart({
    canvasWidth:1400,canvasHeight:900,components:[background,products,dock]
  }),null,'one-column pages must not invent a cart');
});

test('wide desktops anchor the cart right while expanding left surfaces',()=>{
  const column=runtimeRightColumnStart(page);
  assert.deepEqual(runtimeResponsiveComponentStyle(page,cart,column),{
    left:'calc(810px + var(--md-runtime-canvas-extra, 0px))'
  });
  assert.deepEqual(runtimeResponsiveComponentStyle(page,customer,column),{
    left:'calc(1070px + var(--md-runtime-canvas-extra, 0px))'
  });
  assert.deepEqual(runtimeResponsiveComponentStyle(page,products,column),{
    width:'calc(772px + var(--md-runtime-canvas-extra, 0px))'
  });
  assert.deepEqual(runtimeResponsiveComponentStyle(page,dock,column),{
    width:'calc(772px + var(--md-runtime-canvas-extra, 0px))'
  });
  assert.deepEqual(runtimeResponsiveComponentStyle(page,background,column),{
    width:'calc(1400px + var(--md-runtime-canvas-extra, 0px))'
  });
});

test('non-column pages preserve normal sized controls and nested layouts',()=>{
  const lonely=component('button',200,100,180,60);
  assert.deepEqual(runtimeResponsiveComponentStyle(page,lonely,null),{});
  assert.deepEqual(runtimeResponsiveComponentStyle(page,{...cart,parentId:'inside'},810),{});
});

test('standard layout component direct fill is visible in the design renderer',()=>{
  assert.equal(resolvePageComponentStyle({backgroundColor:'#ffdf70'},'Container').backgroundColor,'#ffdf70');
  assert.equal(resolvePageComponentStyle({visualStyle:{backgroundColor:'#e5e7eb'},backgroundColor:'#ffdf70'},'Container').backgroundColor,'#e5e7eb');
});
