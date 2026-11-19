import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Page Builder list: filters sit on the Page type row, header buttons on one line',()=>{
 const view=read('../src/core/builders/PageBuilder/editor/management/PageManagerView.tsx');
 const tabs=read('../src/core/builders/PageBuilder/PageManagerTabs.tsx');
 const css=read('../src/core/builders/PageBuilder/PageManagerTabs.css');
 assert.match(view,/<\/PageManagerTabs>/);
 assert.match(view,/recordPageContext\?filters:<PageManagerTabs/);
 assert.match(tabs,/page-manager-type-level[\s\S]*\{children\}/);
 assert.match(css,/\.page-manager-filters>\.page-manager-object-filter\{flex:0 1 220px\}/);
 assert.match(css,/page-manager-header-actions\{flex-wrap:nowrap\}/);
});
