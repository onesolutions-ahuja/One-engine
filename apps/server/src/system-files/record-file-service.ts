import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {RbacEngine} from './rbac-engine.js';
import type {SqlPersistence} from './sql-persistence.js';

const apiName=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageUrlPattern=/\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/content/gi;
const maxFileBytes=1024*1024;
const maxTenantBytes=100*1024*1024;
const maxImagesPerField=20;
const signatures:Record<string,(data:Buffer)=>boolean>={
  'image/jpeg':data=>data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff,
  'image/png':data=>data.length>=8&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
  'image/gif':data=>data.length>=6&&['GIF87a','GIF89a'].includes(data.toString('ascii',0,6)),
  'image/webp':data=>data.length>=12&&data.toString('ascii',0,4)==='RIFF'
    &&data.toString('ascii',8,12)==='WEBP'
};
function imageDimensions(type:string,data:Buffer):[number,number]|null {
  if(type==='image/png'&&data.length>=24)
    return [data.readUInt32BE(16),data.readUInt32BE(20)];
  if(type==='image/gif'&&data.length>=10)
    return [data.readUInt16LE(6),data.readUInt16LE(8)];
  if(type==='image/webp'&&data.length>=30){
    const chunk=data.toString('ascii',12,16);
    if(chunk==='VP8X')return [1+data.readUIntLE(24,3),1+data.readUIntLE(27,3)];
    if(chunk==='VP8L'&&data[20]===0x2f){
      const bits=data.readUInt32LE(21);
      return [1+(bits&0x3fff),1+((bits>>>14)&0x3fff)];
    }
    if(chunk==='VP8 '&&data[23]===0x9d&&data[24]===0x01&&data[25]===0x2a)
      return [data.readUInt16LE(26)&0x3fff,data.readUInt16LE(28)&0x3fff];
  }
  if(type==='image/jpeg'){
    let offset=2;
    while(offset+4<=data.length){
      if(data[offset]!==0xff)return null;
      while(data[offset]===0xff)offset++;
      const marker=data[offset++];
      if(marker===0xd9||marker===0xda)return null;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(offset+2>data.length)return null;
      const length=data.readUInt16BE(offset);
      if(length<2||offset+length>data.length)return null;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))
        return length>=7?[data.readUInt16BE(offset+5),data.readUInt16BE(offset+3)]:null;
      offset+=length;
    }
  }
  return null;
}
function validateImageDimensions(type:string,data:Buffer) {
  const dimensions=imageDimensions(type,data);
  if(!dimensions||dimensions.some(value=>value<1||value>8192)
    ||dimensions[0]*dimensions[1]>40_000_000)
    throw new Error('Invalid inline image dimensions');
}
/** Shared validated image contract for tenant assets and record-inline images. */
export function validateTenantImage(contentType:string,contentBase64:string,maxBytes=maxFileBytes) {
  const signature=signatures[contentType];
  if(!signature||contentBase64.length===0
    ||contentBase64.length>Math.ceil(maxBytes/3)*4)
    throw new Error('Invalid image format or size');
  const content=Buffer.from(contentBase64,'base64');
  if(content.length===0||content.length>maxBytes
    ||content.toString('base64')!==contentBase64||!signature(content))
    throw new Error('Invalid image content for its declared format');
  validateImageDimensions(contentType,content);
  return content;
}
type FileRow={
  id:string;object_api:string;record_id:string;field_api:string;content_type:string;
  content:Buffer;name:string;byte_size:number;checksum:string
};

export class RecordFileService {
  constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine) {}

  async pruneUnreferenced(client:PoolClient,tenantId:string,objectApi:string,recordId:string,
    fieldApi:string,html:string|null) {
    const fileIds=[...String(html??'').matchAll(imageUrlPattern)]
      .map(match=>match[1]).filter((id):id is string=>Boolean(id));
    await client.query(`DELETE FROM md_record_files
      WHERE tenant_id=$1 AND object_api=$2 AND record_id=$3 AND field_api=$4
        AND NOT(id=ANY($5::uuid[]))`,
    [tenantId,objectApi,recordId,fieldApi,fileIds]);
  }

  private async requireRichTextRecord(tenantId:string,userId:string,objectApi:string,
    recordId:string,fieldApi:string,action:'read'|'edit',
    fileAction:'read'|'create'|'edit'|'delete'=action) {
    if(!apiName.test(objectApi)||!apiName.test(fieldApi)||!uuid.test(recordId))
      throw new Error('Invalid file record reference');
    await this.rbac.require(tenantId,userId,'Files',fileAction);
    await this.rbac.require(tenantId,userId,objectApi,action);
    await this.rbac.require(tenantId,userId,`${objectApi}.${fieldApi}`,action);
    await this.rbac.requireRecord(tenantId,userId,objectApi,recordId,action);
    const field=await this.db.query<{data_type:string}>(
      `SELECT data_type FROM md_field_definitions
       WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND deleted_at IS NULL`,
      [tenantId,objectApi,fieldApi]);
    if(field.rows[0]?.data_type!=='richtext')
      throw new Error('Inline images require an active Rich Text Area field');
  }

  async upload(tenantId:string,userId:string,input:{
    objectApi:unknown;recordId:unknown;fieldApi:unknown;name:unknown;contentType:unknown;contentBase64:unknown
  }) {
    if(typeof input.objectApi!=='string'||typeof input.recordId!=='string'
      ||typeof input.fieldApi!=='string'||typeof input.name!=='string'
      ||typeof input.contentType!=='string'||typeof input.contentBase64!=='string')
      throw new Error('Invalid inline image upload');
    await this.requireRichTextRecord(tenantId,userId,input.objectApi,input.recordId,
      input.fieldApi,'edit','create');
    const signature=signatures[input.contentType];
    if(!signature||input.contentBase64.length===0
      ||input.contentBase64.length>Math.ceil(maxFileBytes/3)*4)
      throw new Error('Invalid inline image format or size');
    const content=Buffer.from(input.contentBase64,'base64');
    if(content.length===0||content.length>maxFileBytes
      ||content.toString('base64')!==input.contentBase64||!signature(content))
      throw new Error('Invalid inline image content for its declared format');
    validateImageDimensions(input.contentType,content);
    const name=input.name.replace(/[\\/\u0000-\u001f\u007f]/g,'_').trim().slice(0,255)||'inline-image';
    const checksum=createHash('sha256').update(content).digest('hex');
    const result=await this.db.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`file-storage:${tenantId}`]);
      const usage=await client.query<{used_bytes:string;field_count:string}>(`
        SELECT COALESCE(sum(byte_size),0)::text AS used_bytes,
          count(*) FILTER(WHERE object_api=$2 AND record_id=$3 AND field_api=$4)::text AS field_count
        FROM md_record_files WHERE tenant_id=$1`,
      [tenantId,input.objectApi,input.recordId,input.fieldApi]);
      if(Number(usage.rows[0]?.used_bytes??0)+content.length>maxTenantBytes)
        throw new Error('File storage quota exceeded');
      if(Number(usage.rows[0]?.field_count??0)>=maxImagesPerField)
        throw new Error('Too many inline images for this field');
      return client.query<{id:string}>(`
        INSERT INTO md_record_files
          (tenant_id,object_api,record_id,field_api,name,content_type,byte_size,checksum,content,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tenantId,input.objectApi,input.recordId,input.fieldApi,name,input.contentType,
        content.length,checksum,content,userId]);
    });
    const id=result.rows[0]?.id;
    if(!id)throw new Error('Unable to save inline image');
    return {id,name,contentType:input.contentType,size:content.length,
      url:`/api/files/${id}/content`};
  }

  async read(tenantId:string,userId:string,id:string):Promise<FileRow> {
    if(!uuid.test(id))throw new Error('Invalid file ID');
    await this.rbac.require(tenantId,userId,'Files','read');
    const result=await this.db.query<FileRow>(`
      SELECT id,object_api,record_id,field_api,content_type,content,name,byte_size,checksum
      FROM md_record_files WHERE tenant_id=$1 AND id=$2`,
    [tenantId,id]);
    const file=result.rows[0];
    if(!file)throw new Error('File not found');
    await this.requireRichTextRecord(tenantId,userId,file.object_api,file.record_id,file.field_api,'read');
    const signature=signatures[file.content_type];
    if(!Buffer.isBuffer(file.content)||file.content.length!==file.byte_size
      ||!signature||!signature(file.content)
      ||createHash('sha256').update(file.content).digest('hex')!==file.checksum)
      throw new Error('Stored inline image failed integrity validation');
    validateImageDimensions(file.content_type,file.content);
    return file;
  }

  async remove(tenantId:string,userId:string,id:string) {
    if(!uuid.test(id))throw new Error('Invalid file ID');
    await this.rbac.require(tenantId,userId,'Files','delete');
    const result=await this.db.query<FileRow>(`
      SELECT id,object_api,record_id,field_api,content_type,content,name,byte_size,checksum
      FROM md_record_files WHERE tenant_id=$1 AND id=$2`,
    [tenantId,id]);
    const file=result.rows[0];
    if(!file)throw new Error('File not found');
    await this.requireRichTextRecord(tenantId,userId,file.object_api,file.record_id,
      file.field_api,'edit','delete');
    await this.db.query('DELETE FROM md_record_files WHERE tenant_id=$1 AND id=$2',[tenantId,id]);
  }
}
