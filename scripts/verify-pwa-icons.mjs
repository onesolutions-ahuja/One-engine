// PWA installability contract: actual PNG bytes, distinct maskable safe-zone icon.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const dir=new URL('../apps/web/public/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.webmanifest',dir),'utf8'));
const required=[
 {src:'icon-180.png',size:180,purpose:'any'},
 {src:'icon-192.png',size:192,purpose:'any'},
 {src:'icon-512.png',size:512,purpose:'any'},
 {src:'icon-512-maskable.png',size:512,purpose:'maskable'}
];
const expectedSignature=Buffer.from([137,80,78,71,13,10,26,10]);
for(const {src,size,purpose} of required){
 const icon=manifest.icons.find(i=>i.src===src);
 assert.ok(icon,`Missing ${src} manifest reference`);
 assert.equal(icon.type,'image/png');
 assert.equal(icon.purpose,purpose);
 assert.equal(icon.sizes,`${size}x${size}`);
 assert.ok(existsSync(new URL(src,dir)),`Referenced PWA file missing: ${src}`);
 const png=readFileSync(new URL(src,dir));
 assert.ok(png.length>45,`Truncated PNG: ${src}`);
 assert.ok(png.subarray(0,8).equals(expectedSignature),`Not PNG: ${src}`);
 assert.equal(png.toString('ascii',12,16),'IHDR',`PNG missing IHDR: ${src}`);
 assert.equal(png.readUInt32BE(16),size,`Incorrect PNG width: ${src}`);
 assert.equal(png.readUInt32BE(20),size,`Incorrect PNG height: ${src}`);
}
assert.notEqual(readFileSync(new URL('icon-512.png',dir)).toString('base64'),
  readFileSync(new URL('icon-512-maskable.png',dir)).toString('base64'),
  'Any and maskable icons must be independently drawn, not mislabeled copies');
console.log('PWA PNG icons verified:',required.map(i=>i.src).join(', '));
