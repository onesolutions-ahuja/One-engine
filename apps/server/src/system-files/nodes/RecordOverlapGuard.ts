import type {PoolClient} from 'pg';

// TODO(native): record overlap checks are switched off until native record reads replace EAV.
export async function enforceRecordOverlap(
 _client:PoolClient,_tenantId:string,_objectApi:string,
 _raw:unknown,_record:Record<string,unknown>
):Promise<void>{
 return;
}

// TODO(native): input idempotency guard is switched off until native record reads replace EAV.
export async function enforceUniqueRecordInput(
 _client:PoolClient,_tenantId:string,_objectApi:string,
 _raw:unknown,_record:Record<string,unknown>
):Promise<void>{
 return;
}
