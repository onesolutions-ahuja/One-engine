// Startup/performance contract from Vite's real production build, not mock imports.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
const root=new URL('../apps/web/dist/',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const assets=new URL('assets/',root);
const names=readdirSync(assets.href.replace(/^file:\/\//,'')).filter(n=>n.endsWith('.js'));
const optional=['pageBuilderView-','FlowBuilder-','DashboardBuilder-',
 'reportBuilderView-','objectManagerView-','MailWebmail-'];
for(const name of optional)
 assert.ok(names.some(file=>file.startsWith(name)),`Optional entry chunk missing: ${name}`);
const eager=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+\.js)"[^>]*>/g)]
 .map(match=>match[1].split('/').at(-1));
assert.ok(eager.length>0,'Production app shell has no module entry');
for(const name of optional)
 assert.ok(!eager.some(file=>file.startsWith(name)),
  `Optional application or builder eagerly loaded at startup: ${name}`);
const bytes=eager.reduce((sum,file)=>sum+statSync(new URL('assets/'+file,root)).size,0);
const gzip=eager.reduce((sum,file)=>sum+gzipSync(readFileSync(new URL('assets/'+file,root))).length,0);
assert.ok(bytes<=800_000,`Production initial JS exceeded 800KB raw: ${bytes}`);
assert.ok(gzip<=260_000,`Production initial JS exceeded 260KB gzip: ${gzip}`);
console.log(JSON.stringify({eager,eagerRawBytes:bytes,eagerGzipBytes:gzip,
 lazyApplicationChunks:optional.length},null,2));
