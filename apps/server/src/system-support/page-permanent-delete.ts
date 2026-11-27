import type {PoolClient} from 'pg';

/**
 * Permanently delete one page: every row that belongs to it (details, nodes, properties,
 * activation, layouts, versions, history...) and then the page itself. The tables are found
 * from the database's own foreign keys (anything that points at md_page_definitions, directly
 * or through another page table, by tenant and page id), so a new page table is covered
 * without changing this code. Rows are deleted in whatever order the keys allow.
 * Business records are never touched: they do not hold a page id.
 */
export async function deletePagePermanently(client:PoolClient,tenantId:string,pageId:string,apiName:string):Promise<void>{
 const {rows}=await client.query<{table_name:string}>(`
  WITH RECURSIVE page_tables(rel) AS (
   SELECT 'md_page_definitions'::regclass
   UNION
   SELECT c.conrelid::regclass FROM pg_constraint c JOIN page_tables t ON c.confrelid=t.rel
   WHERE c.contype='f'
  )
  SELECT DISTINCT rel::text AS table_name FROM page_tables p
  WHERE rel<>'md_page_definitions'::regclass
   AND EXISTS(SELECT 1 FROM information_schema.columns k
     WHERE k.table_schema=current_schema() AND k.table_name=p.rel::text AND k.column_name='page_id')
   AND EXISTS(SELECT 1 FROM information_schema.columns k
     WHERE k.table_schema=current_schema() AND k.table_name=p.rel::text AND k.column_name='tenant_id')`);
 let pending=rows.map(row=>row.table_name).filter(name=>/^[a-z_][a-z0-9_]*$/.test(name));
 // A table that another page table still points at fails until that one is emptied: retry.
 for(let pass=0;pending.length&&pass<=pending.length;pass++){
  const failed:string[]=[];
  for(const table of pending){
   await client.query('SAVEPOINT page_delete');
   try{
    await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND page_id=$2`,[tenantId,pageId]);
    await client.query('RELEASE SAVEPOINT page_delete');
   }catch(error){
    await client.query('ROLLBACK TO SAVEPOINT page_delete');
    if((error as {code?:string}).code!=='23503')throw error;
    failed.push(table);
   }
  }
  if(failed.length===pending.length)break;
  pending=failed;
 }
 // Generated page code is kept by page API name, not page id.
 await client.query('DELETE FROM md_page_code_version_files WHERE tenant_id=$1 AND page_api=$2',[tenantId,apiName]);
 await client.query('DELETE FROM md_page_code_versions WHERE tenant_id=$1 AND page_api=$2',[tenantId,apiName]);
 const removed=await client.query('DELETE FROM md_page_definitions WHERE tenant_id=$1 AND id=$2',[tenantId,pageId]);
 if(!removed.rowCount)throw new Error('Page not found');
}
