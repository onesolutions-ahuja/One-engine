import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Auto Number fields can be search fields (server rule and Object Manager list agree)',()=>{
 assert.match(read('../src/system-files/object-manager-metadata.ts'),
  /SEARCHABLE_FIELD_TYPES:readonly string\[\]=\['text','email','phone','url','picklist','autonumber'\]/);
 assert.match(read('../../web/src/core/builders/ObjectManager/objectManagerView.tsx'),
  /\['text','email','phone','url','picklist','autonumber'\]\.includes\(field\.dataType\.toLocaleLowerCase\(\)\)/);
});

test('Objects with no search fields get their Auto Number fields, once per tenant',()=>{
 const seeder=read('../src/app-seeders/core-objects.ts');
 assert.match(seeder,/await seedAutoNumberSearch\(client,tenantId\);/);
 assert.match(seeder,/lower\(f\.data_type\)='autonumber'/);
 assert.match(seeder,/NOT EXISTS\(SELECT 1 FROM md_search_layout_fields s WHERE s\.tenant_id=f\.tenant_id AND s\.object_api=f\.object_api\)/,
  'an Object the tenant already configured is left alone');
 assert.match(seeder,/autonumber-search-defaults-v1:/,'runs once per tenant');
});
