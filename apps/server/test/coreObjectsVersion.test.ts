import test from 'node:test';
import assert from 'node:assert/strict';
import {CORE_OBJECTS_BOOTSTRAP_VERSION,coreObjectsChecksum} from '../src/app-seeders/core-objects.js';

// The server refuses to start when Core metadata (objects, fields, SMART_COMPONENTS...)
// changes under the same version. If this fails: bump CORE_OBJECTS_BOOTSTRAP_VERSION
// and put the new version and checksum here, in the same PR.
test('Core metadata change comes with a new bootstrap version',()=>{
 assert.deepEqual({version:CORE_OBJECTS_BOOTSTRAP_VERSION,checksum:coreObjectsChecksum()},
  {version:'core-objects-unified-v28',checksum:'36de169aacf80b50e20664be29617a7befb54c7bebc91ad2dd80d08a7627e8ec'});
});
