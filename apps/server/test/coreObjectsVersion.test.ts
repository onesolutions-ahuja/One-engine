import test from 'node:test';
import assert from 'node:assert/strict';
import {CORE_OBJECTS_BOOTSTRAP_VERSION,coreObjectsChecksum} from '../src/app-seeders/core-objects.js';

// The server refuses to start when Core metadata (objects, fields, SMART_COMPONENTS...)
// changes under the same version. If this fails: bump CORE_OBJECTS_BOOTSTRAP_VERSION
// and put the new version and checksum here, in the same PR.
test('Core metadata change comes with a new bootstrap version',()=>{
 assert.deepEqual({version:CORE_OBJECTS_BOOTSTRAP_VERSION,checksum:coreObjectsChecksum()},
  {version:'core-objects-unified-v22',checksum:'e48623670a0061da618ab24a6a2bd23c048dac9aa4e0d4295c18fcf411dfe1cd'});
});
