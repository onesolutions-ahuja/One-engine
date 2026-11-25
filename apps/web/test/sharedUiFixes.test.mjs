import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Dates and times use the business time zone (Company Settings) before the device zone',()=>{
 const text=read('../src/core/pages/PageCompiler/formulaText.ts');
 assert.match(text,/export function businessTimeZone\(\):string\{/);
 assert.match(text,/validZone\(companyZone\(\)\)\|\|validZone\(identity\(\)\?\.user\?\.TimeZone\)/);
 assert.match(text,/try\{return tenantValue\('Timezone'\);\}catch\{return '';\}/,'a missing company setting never breaks a date');
 const runtime=read('../src/core/pages/PageCompiler/pageCodeRuntime.ts');
 assert.match(runtime,/timeZone\(\)\{return businessTimeZone\(\);\}/);
 assert.match(runtime,/timeZone:businessTimeZone\(\)\}\);/,'server taps get the same zone');
 assert.doesNotMatch(runtime,/resolvedOptions\(\)\.timeZone:undefined/);
});

test('Popups take the corner radius of their own sheet and reserve no scrollbar strip',()=>{
 const dialog=read('../src/core/pages/PageRuntime/FormulaScreenDialog.tsx');
 assert.match(dialog,/export function matchSheetRadius\(/);
 assert.match(dialog,/dialog\.formula-screen-modal\{padding:0;border:0;border-radius:var\(--formula-screen-radius,12px\);overflow:auto;\n/);
 assert.match(dialog,/\[0,150,600\]\.map\(delay=>window\.setTimeout\(\(\)=>matchSheetRadius\(popupBox\(\)\),delay\)\)/);
});

test('Tab scroll arrows: a round chevron centred on the tabs, no grey box on plain tabs',()=>{
 const runtime=read('../src/component-libraries/smart/shared/SmartRuntime.jsx');
 assert.match(runtime,/className="smart-tabs-arrow-icon"/);
 assert.match(runtime,/background:fade\?"linear-gradient/);
 assert.match(read('../src/component-libraries/smart/shared/smart.css'),/\.smart-tabs-arrow-icon\{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%/);
});

test('Grid card images leave room for the name, price and buttons',()=>{
 assert.match(read('../src/component-libraries/smart/shared/SmartRuntime.jsx'),/grid\?\(hasImageHeight\?"0 1 "\+imageHeight\+"px":"1 1 0px"\)/);
});

test('Popups open like a macOS sheet: short fade and slight scale, no genie pinch',()=>{
 const dialog=read('../src/core/pages/PageRuntime/FormulaScreenDialog.tsx');
 assert.match(dialog,/const OPEN:Keyframe\[\]=\[\{transform:'scale\(\.96\)',opacity:0\},\{transform:'scale\(1\)',opacity:1\}\];/);
 assert.match(dialog,/duration:closing\?120:160/);
 assert.doesNotMatch(dialog,/translateY\(55vh\)/);
});
