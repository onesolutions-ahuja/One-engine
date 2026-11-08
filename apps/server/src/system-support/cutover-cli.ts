import { SqlPersistence } from '../system-files/sql-persistence.js';
import { inspectSqlCutover } from './cutover-preflight.js';
async function main() {
  const db=new SqlPersistence(process.env.DATABASE_URL??'');
  try {
    const report=await inspectSqlCutover(db);
    console.log(JSON.stringify(report,null,2));
    if(!report.safeToMigrate)process.exitCode=2;
  } finally {
    await db.close();
  }
}
main().catch((err:unknown)=>{
  console.error('SQL cutover preflight failed:',err instanceof Error?err.message:'Unknown error');
  process.exitCode=1;
});
