import test from 'node:test';
import assert from 'node:assert/strict';
import {CORE_OBJECTS_BOOTSTRAP_VERSION,coreObjectsChecksum} from '../src/app-seeders/core-objects.js';

// The server refuses to start when Core metadata (objects, fields, SMART_COMPONENTS...)
// changes under the same version. If this fails: bump CORE_OBJECTS_BOOTSTRAP_VERSION
// and put the new version and checksum here, in the same PR.
test('Core metadata change comes with a new bootstrap version',()=>{
 assert.deepEqual({version:CORE_OBJECTS_BOOTSTRAP_VERSION,checksum:coreObjectsChecksum()},
  {version:'core-objects-unified-v25',checksum:'dff9c5ba6e80949310d4592a8674f0bed9438a0940d0f647566e733e40e5e4a5'});
});
