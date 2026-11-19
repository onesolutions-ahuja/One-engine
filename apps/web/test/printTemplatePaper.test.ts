import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {printPageSize,printPageCss,ROLL_MAX_WIDTH} from '../src/core/pages/PageRuntime/printPaper.ts';
import {designedWidthToDots,rasterBits,escPosRaster,MAX_RECEIPT_DOTS,DIRECT_PRINT_CONNECTIONS}
 from '../../server/src/expression-engine/ActionDevices.ts';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('a receipt prints at its designed size on one page as long as the receipt',()=>{
 // 72 mm wide (272 px), designed 600 px tall, 1 item fits in 414 px, 100 items need 3754 px.
 assert.deepEqual(printPageSize(272,414,600),{width:272,height:414,roll:true});
 assert.deepEqual(printPageSize(272,3754,600),{width:272,height:3754,roll:true});
 assert.equal(ROLL_MAX_WIDTH,400);
});

test('an A4 template keeps its designed page height (long content goes onto more pages)',()=>{
 assert.deepEqual(printPageSize(794,3000,1123),{width:794,height:1123,roll:false});
});

test('the print window gets the designed size, no margins and no scaling',()=>{
 const css=printPageCss({width:272,height:414});
 assert.match(css,/@page\{size:272px 414px;margin:0\}/);
 assert.match(css,/transform:none!important/);
 assert.doesNotMatch(css,/A4|zoom|scale\(/);
});

test('receipt printer image: designed pixels become 203 dpi dots, capped at 72 mm',()=>{
 assert.equal(designedWidthToDots(272),576);
 assert.equal(designedWidthToDots(181),384);   // 48 mm (58 mm roll)
 assert.equal(designedWidthToDots(400),MAX_RECEIPT_DOTS);
 assert.equal(designedWidthToDots(100)%8,0);
});

test('receipt printer image: dark pixels print, light and transparent ones do not',()=>{
 // 9 pixels wide, 1 row: black, white, transparent black, dark grey, then white.
 const px=[0,0,0,255, 255,255,255,255, 0,0,0,0, 60,60,60,255, ...Array(5*4).fill(255)];
 const bits=rasterBits(px,9,1);
 assert.equal(bits.length,2);
 assert.equal(bits[0],0b10010000);
 assert.equal(bits[1],0);
});

test('receipt printer image: ESC/POS raster in bands, then feed and cut',()=>{
 const bits=new Uint8Array(2*300).fill(0xff);
 const bytes=[...escPosRaster(bits,2,300)];
 assert.deepEqual(bytes.slice(0,2),[0x1b,0x40]);
 // First band: GS v 0, 2 bytes wide, 128 rows.
 assert.deepEqual(bytes.slice(2,10),[0x1d,0x76,0x30,0,2,0,128,0]);
 const bands=bytes.reduce((n,b,i)=>n+(b===0x1d&&bytes[i+1]===0x76&&bytes[i+2]===0x30?1:0),0);
 assert.equal(bands,3);
 assert.deepEqual(bytes.slice(-3),[0x1d,0x56,0x01]);
 assert.throws(()=>escPosRaster(new Uint8Array(1),2,1),/Invalid receipt image/);
 assert.deepEqual(DIRECT_PRINT_CONNECTIONS,['USB','Serial','Bluetooth','Network']);
});

test('PRINT() prints straight away: no own preview, receipt printer first, A4 size never forced',()=>{
 const runtime=read('../src/core/pages/PageCompiler/CompiledPageRuntime.tsx');
 assert.match(runtime,/import\('\.\.\/PageRuntime\/printTemplate'\)\)\.printTemplate\(/);
 assert.doesNotMatch(runtime,/width:794,height:1123/);
 const dialog=read('../src/core/pages/PageRuntime/FormulaScreenDialog.tsx');
 assert.doesNotMatch(dialog,/Print \/ Save PDF/);
 assert.match(dialog,/opacity:0;pointer-events:none/);
 const print=read('../src/core/pages/PageRuntime/printTemplate.ts');
 assert.match(print,/findDefaultDevice\(request,'Receipt Printer'\)/);
 assert.match(print,/win\.print\(\)/);
 const cloud=read('../../server/src/system-support/cloudprnt-routes.ts');
 assert.match(cloud,/ADD COLUMN IF NOT EXISTS media_type/);
 assert.match(cloud,/res\.type\('image\/png'\)/);
});
