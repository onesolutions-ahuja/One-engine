import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('published plain Smart Image supplies the same authorised asset loader as compiled images',()=>{
 const source=readFileSync(new URL('../src/core/pages/PageRuntime/pageRuntimeViews.tsx',import.meta.url),'utf8');
 const start=source.indexOf('<PageCodeFormulas key={component.id}');
 assert.ok(start>=0,'Plain published RegisteredComponent branch not found');
 const section=source.slice(start,start+3000);
 assert.match(section,/loadAsset:\s*\(id:string\)\s*=>\s*requestPageMediaAsset/);
 assert.match(section,/apiRequest,id,getAccessToken\(\)\?\?''/);
});
