import test from 'node:test';
import assert from 'node:assert/strict';
import {CORE_OBJECTS_BOOTSTRAP_VERSION,coreObjectsChecksum} from '../src/app-seeders/core-objects.js';

// The server refuses to start when Core metadata (objects, fields, SMART_COMPONENTS...)
// changes under the same version. If this fails: bump CORE_OBJECTS_BOOTSTRAP_VERSION
// and put the new version and checksum here, in the same PR.
test('Core metadata change comes with a new bootstrap version',()=>{
 assert.deepEqual({version:CORE_OBJECTS_BOOTSTRAP_VERSION,checksum:coreObjectsChecksum()},
  {version:'core-objects-unified-v23',checksum:'c70a65f403beb6898fe02d0afc9dd37855549884a19dbdcdae269a8fd5da6df7'});
});
