import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const files=new URL('../dist-system/system-files/',import.meta.url);
const support=new URL('../dist-system/system-support/',import.meta.url);
const {SqlPersistence}=await import(new URL('sql-persistence.js',files).href);
const {applySystemMigrations}=await import(new URL('system-migrations.js',support).href);
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url)throw new Error('METADRIVE_SQL_TEST_DATABASE_URL required');
const db=new SqlPersistence(url);
try{
 const schema=readFileSync(new URL('../src/system-files/schema.sql',import.meta.url),'utf8');
 await db.query(schema);
 // Simulate the live older SQL layout, not only a fresh install.
 await db.query('ALTER TABLE md_field_definitions DROP COLUMN IF EXISTS deleted_at CASCADE');
 const before=await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='md_field_definitions' AND column_name='deleted_at'");
 assert.equal(before.rows.length,0);
 await applySystemMigrations(db);
 const after=await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='md_field_definitions' AND column_name='deleted_at'");
 assert.equal(after.rows.length,1);
 const index=await db.query("SELECT 1 FROM pg_indexes WHERE tablename='md_field_definitions' AND indexname='md_field_rollup_child'");
 assert.equal(index.rows.length,1);
 await applySystemMigrations(db);
 console.info('Existing-schema rollup and recycle-bin migration order: PASS');
}finally{await db.close();}
