import type {PoolClient} from 'pg';

// TODO(native): availability checks are switched off until native record reads replace EAV.
export async function enforceRecordAvailability(
 _client:PoolClient,_tenantId:string,_raw:unknown,_record:Record<string,unknown>
):Promise<void>{
 return;
}
