import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {videoList} from '../src/component-libraries/smart_video/videoList.mjs';

test('Smart Video plays one URL or a ; separated playlist, never script URLs',()=>{
 assert.deepEqual(videoList('https://cdn.example.com/a.mp4'),['https://cdn.example.com/a.mp4']);
 assert.deepEqual(videoList('https://x.io/a.mp4; /files/b.webm\nhttps://x.io/c.mp4'),
  ['https://x.io/a.mp4','/files/b.webm','https://x.io/c.mp4']);
 assert.deepEqual(videoList('javascript:alert(1); data:video/mp4,xx'),[]);
 assert.deepEqual(videoList(''),[]);
});

test('Smart Video is registered like every Smart component',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../src/component-libraries/manifest.json',import.meta.url),'utf8'));
 assert.ok(manifest.components.includes('smart_video/component.json'));
 assert.match(readFileSync(new URL('../../server/src/app-seeders/smart-components.ts',import.meta.url),'utf8'),/"smart_video"/);
 assert.match(readFileSync(new URL('../../server/src/system-support/system-migrations.ts',import.meta.url),'utf8'),/applySmartVideo\(client\)/);
});
