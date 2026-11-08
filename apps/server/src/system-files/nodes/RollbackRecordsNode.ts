import type {PoolClient} from 'pg';
/** Roll back this Flow's record work to its transaction savepoint and renew it. */
export async function executeRollbackRecordsNode(client:PoolClient,rollbackSavepoint:string):Promise<void>{
 await client.query('ROLLBACK TO SAVEPOINT '+rollbackSavepoint);
 await client.query('RELEASE SAVEPOINT '+rollbackSavepoint);
 await client.query('SAVEPOINT '+rollbackSavepoint);
}
