import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {PoolClient} from 'pg';
/** Central SQL transaction boundary; never run a second transaction engine. */
export function withRecordTransaction<T>(db:SqlPersistence,run:(client:PoolClient)=>Promise<T>):Promise<T>{
 return db.transaction(run);
}
