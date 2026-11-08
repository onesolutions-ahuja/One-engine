// Build an isolated SQL fixture for authenticated UI browser tests.
// Never connect to a customer, production or shared tenant database.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url)throw new Error('Isolated UI audit SQL database is required.');
const parsed=new URL(url);
if(!['localhost','127.0.0.1'].includes(parsed.hostname) ||
   parsed.pathname!=='/metadrive_ui_audit')
  throw new Error('UI audit setup may only write to the local metadrive_ui_audit database.');

const built=new URL('../apps/server/dist-system/system-files/',import.meta.url);
const support=new URL('../apps/server/dist-system/system-support/',import.meta.url);
const [{SqlPersistence},{applySystemMigrations}]=await Promise.all([
  import(new URL('sql-persistence.js',built)),
  import(new URL('system-migrations.js',support))
]);
const db=new SqlPersistence(url);
try{
  const sql=readFileSync(fileURLToPath(new URL(
    '../apps/server/src/system-files/schema.sql',import.meta.url)),'utf8');
  await db.query(sql);
  await applySystemMigrations(db);
  await db.verifySchema();
  console.info('Isolated UI audit SQL schema and migrations are ready.');
}finally{
  await db.close();
}
