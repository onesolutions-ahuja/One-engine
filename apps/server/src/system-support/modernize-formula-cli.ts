/** One-time rewrite of saved page formulas to @ThisPage / @ThisTenant.
 *  --dry-run: list what would change, write nothing. Runs in one transaction. */
import {SqlPersistence} from '../system-files/sql-persistence.js';
import {modernizeFormulaReferences} from './modernize-formula-references.js';
async function main(){
 const url=process.env.DATABASE_URL;
 if(!url)throw new Error('Missing required environment setting: DATABASE_URL');
 const dryRun=process.argv.includes('--dry-run');
 const db=new SqlPersistence(url);
 try{
  const changes=await db.transaction(tx=>modernizeFormulaReferences(tx,{dryRun}));
  for(const change of changes)
   console.info(change.table,change.group,change.component,change.path+':',change.before,'=>',change.after);
  console.info((dryRun?'Would change ':'Changed ')+changes.length+' saved formula(s).'
   +(dryRun||!changes.length?'':' Republish pages so their page code is rebuilt.'));
 }finally{await db.close();}
}
main().catch((error:unknown)=>{
 console.error('Formula rewrite failed:',error instanceof Error?error.message:'Unknown error');
 process.exitCode=1;
});
