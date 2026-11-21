import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SmartCart from '../src/component-libraries/smart_cart/SmartComponent.jsx';
import SmartCardGrid from '../src/component-libraries/smart_card_grid/SmartComponent.jsx';

globalThis.React=React;

test('Cart Footer honours explicit width, height and text size without max-width clamp',()=>{
 const html=renderToStaticMarkup(React.createElement(SmartCart,{
  builderPreview:true,summaryVisible:true,footerWidth:380,footerHeight:62,
  footerTextSize:23,footerTextColor:'#124578',footerBold:false
 }));
 const footer=html.match(/<div[^>]*class="smart-cart-summary-line smart-cart-total"[^>]*>/)?.[0]??'';
 assert.ok(footer,'Footer must render');
 assert.match(footer,/width:380px/);
 assert.match(footer,/max-width:none/);
 assert.match(footer,/height:62px/);
 assert.match(footer,/font-size:23px/);
 assert.match(footer,/color:#124578/);
 assert.match(footer,/font-weight:400/);
});
test('Card Body dimensions control repeated card tracks, without changing the whole grid size',()=>{
 const html=renderToStaticMarkup(React.createElement(SmartCardGrid,{
  builderPreview:true,cardBodyWidth:214,cardBodyHeight:184,
  cardsPerRow:2,cardsPerColumn:2,imageHeight:60
 }));
 assert.match(html,/grid-template-columns:repeat\(2,214px\)/);
 assert.match(html,/grid-auto-rows:184px/);
 assert.ok(!html.includes('FORMULAERROR'));
});
