import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FONT_CHOICES,componentFontStyle,fontStack,isTextArea,partFontCss,partFonts} from '../src/core/components/Properties/fontChoices';
import SmartEmptyState from '../src/component-libraries/smart/shared/SmartEmptyState.jsx';
// Component bundles use the host's global React.
(globalThis as {React?:unknown}).React=React;

test('font list is the macOS and Windows UI fonts, each with a cross-platform fallback',()=>{
 assert.deepEqual(FONT_CHOICES.map(choice=>choice.label),['System','SF Pro','SF Pro Rounded','New York','SF Mono',
  'Helvetica Neue','Segoe UI','Segoe UI Variable','Cascadia Mono / Consolas']);
 for(const choice of FONT_CHOICES){
  assert.match(choice.stack,/(sans-serif|serif|monospace)$/,choice.label+' ends with a generic family');
  if(/SF|Helvetica|New York/.test(choice.label))assert.match(choice.stack,/Segoe|Consolas|Cascadia|Georgia|Arial/,choice.label+' falls back on Windows');
  if(/Segoe|Cascadia/.test(choice.label))assert.match(choice.stack,/apple-system|SF Mono|Menlo/,choice.label+' falls back on Mac');
 }
 assert.equal(fontStack('nope'),undefined);
});

test('component font goes on the frame; part fonts are scoped CSS; unknown values are ignored',()=>{
 assert.deepEqual(componentFontStyle({}),{});
 assert.equal((componentFontStyle({fontFamily:'segoe-ui'}) as Record<string,string>)['--md-font-family'],fontStack('segoe-ui'));
 assert.deepEqual(partFonts({partFonts:{Header:'sf-pro',Footer:'bad','x;y':'sf-mono'}}),{Header:'sf-pro'});
 const css=partFontCss('cart-1',{partFonts:{Footer:'new-york'}});
 assert.match(css,/\[data-font-scope="cart-1"\] \[data-design-area="Footer"\]/);
 assert.match(css,/New York/);
 assert.equal(partFontCss('cart-1',{}),'');
 assert.equal(isTextArea('Header'),true);
 assert.equal(isTextArea('Image'),false);
});

test('empty Cart and Table show icon, bold title and a grey line',()=>{
 const html=renderToStaticMarkup(React.createElement(SmartEmptyState,{icon:'table',title:'No records found',subtitle:'Try changing the filters.'}));
 assert.match(html,/class="smart-empty-state /);
 assert.match(html,/<svg class="smart-empty-state-icon"/);
 assert.match(html,/<strong class="smart-empty-state-title">No records found<\/strong>/);
 assert.match(html,/smart-empty-state-subtitle">Try changing the filters\./);
});
