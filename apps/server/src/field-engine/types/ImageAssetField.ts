import type {PoolClient} from 'pg';
import type {RbacEngine} from '../../system-files/rbac-engine.js';
import type {SqlPersistence} from '../../system-files/sql-persistence.js';

/** Reference fields reuse the shared SQL tenant asset service and File RBAC. */
const asset=/^asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
async function validateAsset(
 client:PoolClient|SqlPersistence,rbac:RbacEngine,tenantId:string,userId:string,
 value:unknown,fieldApi:string,kind:'image'|'file'
):Promise<string>{
 if(typeof value!=='string'||!asset.test(value))
  throw new Error((kind==='image'?'Image':'File')+' field requires a tenant media asset: '+fieldApi);
 await rbac.require(tenantId,userId,'Files','read');
 const id=value.slice(6);
 const {rowCount}=await client.query(
  `SELECT 1 FROM md_tenant_media_assets WHERE tenant_id=$1 AND id=$2
   ${kind==='image'?"AND content_type IN ('image/png','image/jpeg','image/gif','image/webp')":
    "AND content_type IN ('image/png','image/jpeg','image/gif','image/webp','application/pdf')"}`,
  [tenantId,id]);
 if(!rowCount)throw new Error('Media asset is unavailable in this tenant: '+fieldApi);
 return 'asset:'+id.toLowerCase();
}
export async function validateImageAssetField(
 client:PoolClient|SqlPersistence,rbac:RbacEngine,tenantId:string,userId:string,value:unknown,fieldApi:string
):Promise<string>{
 return validateAsset(client,rbac,tenantId,userId,value,fieldApi,'image');
}
export async function validateFileAssetField(
 client:PoolClient|SqlPersistence,rbac:RbacEngine,tenantId:string,userId:string,value:unknown,fieldApi:string
):Promise<string>{
 return validateAsset(client,rbac,tenantId,userId,value,fieldApi,'file');
}
