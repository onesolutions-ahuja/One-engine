import type { PoolClient } from 'pg';

export const PRODUCT_IMAGE_FIELD={
  objectApi:'Product',apiName:'ImageUrl',label:'Image URL',
  dataType:'text',maxLength:2048
} as const;

/** Shared Product image mapping; preserve fields already configured by each tenant. */
export async function seedFreshProductImageField(client:PoolClient,tenantId:string) {
  await client.query(
    'INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,max_length,required) SELECT $1,$2,$3,$4,$5,$6,false WHERE EXISTS (SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING',
    [tenantId,PRODUCT_IMAGE_FIELD.objectApi,PRODUCT_IMAGE_FIELD.apiName,
      PRODUCT_IMAGE_FIELD.label,PRODUCT_IMAGE_FIELD.dataType,PRODUCT_IMAGE_FIELD.maxLength]);
}
