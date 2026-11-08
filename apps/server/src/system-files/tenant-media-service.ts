import {createHash} from 'node:crypto';
import type {RbacEngine} from './rbac-engine.js';
import type {SqlPersistence} from './sql-persistence.js';
import {validateTenantImage} from './record-file-service.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const limit=512*1024*1024;
const pdfType='application/pdf';
/** Fail closed: safe base64, bounded bytes and a document signature. */
export function validateTenantDocument(contentType:string,contentBase64:string,maxBytes=5*1024*1024){
 if(contentType!==pdfType||!contentBase64||contentBase64.length>Math.ceil(maxBytes/3)*4)
  throw new Error('Invalid document format or size');
 const content=Buffer.from(contentBase64,'base64');
 if(content.length<12||content.length>maxBytes||content.toString('base64')!==contentBase64
    ||content.toString('ascii',0,5)!=='%PDF-'
    ||!content.subarray(Math.max(0,content.length-2048)).toString('ascii').includes('%%EOF'))
  throw new Error('Invalid PDF document content');
 return content;
}
const fileContent=(type:string,base64:string)=>type===pdfType
  ?validateTenantDocument(type,base64)
  :validateTenantImage(type,base64,5*1024*1024);
export class TenantMediaService {
  constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine) {}

  async list(tenantId:string,userId:string){
    await this.rbac.require(tenantId,userId,'Files','read');
    const {rows}=await this.db.query<{
      id:string;name:string;content_type:string;byte_size:number;created_at:Date
    }>('SELECT id,name,content_type,byte_size,created_at FROM md_tenant_media_assets WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500',[tenantId]);
    return rows.map(row=>({id:row.id,name:row.name,contentType:row.content_type,
      size:row.byte_size,assetRef:'asset:'+row.id,createdAt:row.created_at}));
  }

  async upload(tenantId:string,userId:string,input:Record<string,unknown>){
    await this.rbac.require(tenantId,userId,'Files','create');
    if(typeof input.name!=='string'||typeof input.contentType!=='string'
      ||typeof input.contentBase64!=='string')
      throw new Error('Invalid media asset upload');
    const name=input.name.replace(/[\\/\u0000-\u001f\u007f]/g,'_').trim().slice(0,255);
    if(!name)throw new Error('Invalid media asset name');
    const content=fileContent(input.contentType,input.contentBase64);
    const checksum=createHash('sha256').update(content).digest('hex');
    const result=await this.db.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        ['tenant-media:'+tenantId]);
      const used=await client.query<{used_bytes:string}>(
        'SELECT COALESCE(sum(byte_size),0)::text AS used_bytes FROM md_tenant_media_assets WHERE tenant_id=$1',
        [tenantId]);
      if(Number(used.rows[0]?.used_bytes??0)+content.length>limit)
        throw new Error('File storage quota exceeded');
      return client.query<{id:string}>(`INSERT INTO md_tenant_media_assets
        (tenant_id,name,content_type,byte_size,checksum,content,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [tenantId,name,input.contentType,content.length,checksum,content,userId]);
    });
    const id=result.rows[0]?.id;
    if(!id)throw new Error('Unable to save media asset');
    return {id,name,contentType:input.contentType,size:content.length,assetRef:'asset:'+id};
  }

  async read(tenantId:string,userId:string,id:string){
    await this.rbac.require(tenantId,userId,'Files','read');
    if(!uuid.test(id))throw new Error('Invalid media asset ID');
    const {rows}=await this.db.query<{
      name:string;content_type:string;byte_size:number;checksum:string;content:Buffer
    }>('SELECT name,content_type,byte_size,checksum,content FROM md_tenant_media_assets WHERE tenant_id=$1 AND id=$2',
      [tenantId,id]);
    const asset=rows[0];
    if(!asset)throw new Error('Media asset not found');
    if(!Buffer.isBuffer(asset.content)||asset.content.length!==asset.byte_size
      ||createHash('sha256').update(asset.content).digest('hex')!==asset.checksum)
      throw new Error('Media asset integrity check failed');
    // Reuse the same signature, dimensional and size checks as inline Record images.
    fileContent(asset.content_type,asset.content.toString('base64'));
    return {id,name:asset.name,contentType:asset.content_type,
      contentBase64:asset.content.toString('base64')};
  }

  async remove(tenantId:string,userId:string,id:string){
    await this.rbac.require(tenantId,userId,'Files','delete');
    if(!uuid.test(id))throw new Error('Invalid media asset ID');
    // Published metadata can reference the stable asset ID; fail closed instead of
    // silently rewriting existing pages, flows, records or customer customisations.
    const assetRef='asset:'+id;
    const references=await this.db.query(
      `WITH asset_refs AS (
        SELECT value_text FROM md_page_component_properties WHERE tenant_id=$1
        UNION ALL SELECT value_text FROM md_component_properties WHERE tenant_id=$1
        UNION ALL SELECT value_text FROM md_page_properties WHERE tenant_id=$1
        UNION ALL SELECT value_text FROM md_flow_editor_values WHERE tenant_id=$1
        UNION ALL SELECT value_text FROM md_record_values WHERE tenant_id=$1
       ) SELECT 1 FROM asset_refs WHERE position($2 IN value_text)>0 LIMIT 1`,
      [tenantId,assetRef]);
    if(references.rows.length)throw new Error('Media asset is referenced by a page component');
    const deleted=await this.db.query(
      'DELETE FROM md_tenant_media_assets WHERE tenant_id=$1 AND id=$2 RETURNING id',[tenantId,id]);
    if(!deleted.rowCount)throw new Error('Media asset not found');
  }
}
