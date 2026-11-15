import {SqlPersistence} from '../system-files/sql-persistence.js';
import {copyNativeObject} from '../system-files/native-object-copy.js';

// Deliberately separate from startup and production deployment. These copies
// are snapshots, not an activated storage backend or a substitute for backups.
const [mode,tenantId,...objects]=process.argv.slice(2);
if(mode!=='--copy-snapshot'||!tenantId||!objects.length)
  throw Error('Usage: native-object-copy-cli --copy-snapshot TENANT_UUID OBJECT [OBJECT ...]');
const db=new SqlPersistence(process.env.DATABASE_URL??'');
try {
  for(const object of objects)console.info(await copyNativeObject(db,tenantId,object));
} finally { await db.close(); }
