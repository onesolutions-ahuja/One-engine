import {readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
const expected=["apps/server/test/system/backend.test.mjs","apps/web/test/frontend.test.mjs","scripts/scripts.test.mjs"];
const found=[];
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
 if(["node_modules",".git","dist","dist-system"].includes(e.name))continue;
 const p=path.join(dir,e.name);
 if(e.isDirectory())walk(p);
 else if(/\.(test|spec)\.[cm]?[jt]sx?$/.test(p))found.push(p.replaceAll(path.sep,"/"));
}}
for(const dir of ['apps','scripts'])if(existsSync(dir))walk(dir);
const extra=found.filter(p=>!expected.includes(p));
const missing=expected.filter(p=>!found.includes(p));
if(extra.length||missing.length)throw new Error(JSON.stringify({extra,missing}));
console.log('Exactly four consolidated test files verified');
