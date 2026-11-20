import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('a selected tab on iOS blue uses white text; light fills keep dark text; explicit colour wins',async()=>{
 const src=readFileSync(new URL('../src/component-libraries/smart/shared/SmartRuntime.jsx',import.meta.url),'utf8');
 const pick=src.slice(src.indexOf('const hexRgb='),src.indexOf('export function readableText'));
 const fn=new Function(pick.replace('export function selectedTabText','function selectedTabText')+';return selectedTabText;')();
 assert.equal(fn('#007AFF'),'#fff');
 assert.equal(fn('#2453D6'),'#fff');
 assert.equal(fn('#EAF0FD'),'#1d1d1f');
 assert.equal(fn('#007AFF','#000000'),'#000000');
});
