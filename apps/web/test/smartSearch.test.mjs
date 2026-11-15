import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Smart Search is registered like the other Smart components',()=>{
 const manifest=JSON.parse(read('../src/component-libraries/manifest.json'));
 assert.ok(manifest.components.includes('smart_search/component.json'));
 const descriptor=JSON.parse(read('../src/component-libraries/smart_search/component.json'));
 assert.equal(descriptor.apiName,'smart_search');
 assert.deepEqual(descriptor.eventDefinitions.map(item=>item.apiName),['change','enter']);
 assert.match(read('../../server/src/app-seeders/smart-components.ts'),/"smart_search"/);
 assert.match(read('../../server/src/system-support/system-migrations.ts'),/await applySmartSearch\(client\)/);
 assert.match(read('../src/component-libraries/smart/shared/SmartRuntime.jsx'),/name==="smart_search"\)content=<SmartSearch/);
 const events=read('../src/core/builders/PageBuilder/SmartEventActionsRibbon.tsx');
 assert.match(events,/'smart_lookup','smart_search'/);
 assert.match(events,/event==='enter'\?api==='smart_search'/);
});

test('Smart Search fires from the 3rd letter, debounced, and Enter fires at once',()=>{
 const source=read('../src/component-libraries/smart_search/SmartSearch.jsx');
 assert.match(source,/const MIN_LETTERS=3;/);
 assert.match(source,/const DEBOUNCE_MS=250;/);
 assert.match(source,/if\(term===lastFired\.current\)return;/,'no repeated query for the same text');
 assert.match(source,/fire\("enter",value\)/);
 assert.match(source,/\^\\d\{4,\}\$/,'scanned codes are cleared for the next scan');
 assert.doesNotMatch(source,/role="listbox"/,'no dropdown list');
});

test('Preview lists each formula issue in red with the component name',()=>{
 const bar=read('../src/core/pages/PageCompiler/CompiledPreviewBar.tsx');
 assert.match(bar,/className="compiled-preview-issues"/);
 assert.match(bar,/navigatorName/);
 assert.match(read('../src/core/pages/PageCompiler/CompiledPreviewBar.css'),/\.compiled-preview-issues\{[^}]*color:#b91c1c/);
 assert.match(read('../../server/src/page-compiler/compilePage.ts'),/if\(!formula\|\|formula==='='\)return null;/);
});

test('STATE(key, …) without quotes registers the Page State write, so readers refresh',()=>{
 const compiler=read('../../server/src/page-compiler/compilePage.ts');
 assert.match(compiler,/steps\.filter\(step=>step\.name==='STATE'&&identifier\.test\(step\.object\)\)/);
 assert.match(compiler,/\['smart_tabs','smart_navigation','smart_selector'\]\.includes\(libraryApiName\)/);
});

test('Tabs keep their configured background; segmented look only without one',()=>{
 assert.match(read('../src/component-libraries/smart/shared/SmartRuntime.jsx'),/"smart-tabs"\+\(p\.backgroundColor\?"":" is-segmented"\)/);
 assert.match(read('../src/component-libraries/smart/shared/smart-ios.css'),/\.smart-tabs\.is-segmented\{/);
});

test('A component mostly inside the right column moves with it on wide screens',()=>{
 assert.match(read('../src/core/pages/PageRuntime/runtimeCanvasSizing.ts'),/p\.x \+ p\.width \/ 2 >= rightColumnStart/);
});

test('Cart Padding also insets the totals box left and right',()=>{
 assert.match(read('../src/component-libraries/smart_cart/SmartCart.jsx'),/paddingLeft:n\(p\.tableSidePadding,6,0,80\),paddingRight:n\(p\.tableSidePadding,6,0,80\)/);
});

test('Action event values @recordId and @value resolve (SCREEN(page, popup, @recordId) from a cart row)',()=>{
 const expression=read('../src/component-libraries/shared/FieldExpression.js');
 assert.match(expression,/\['recordId','value','index','label'\]\.includes\(reference\)/);
 assert.match(read('../src/core/pages/PageCompiler/CompiledPageRuntime.tsx'),/rootObjectApiName:objectApiName\}\);\s*if\(result\.error\)throw Error\('SCREEN record Id: '/);
});
