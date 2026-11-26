
import type {GeneratedPageSource} from './generatePageSource.js';

/** The part of a pg client / pool client these functions use. */
export type SqlClient={query:(text:string,values?:unknown[])=>Promise<{rows:any[]}>};
export type PageCodeVersionInfo={version:number;pageRevision:number|null;appApi:string|null;createdAt:string;
 createdBy:string|null;issueCount:number;files:string[]};

/** Pure: the oldest versions beyond the newest `keep` (default 10), oldest first. */
export function versionsToDelete(existing:number[],keep=10):number[]{
 const sorted=[...new Set(existing)].sort((a,b)=>b-a);
 return sorted.slice(Math.max(1,Math.floor(keep))).sort((a,b)=>a-b);
}

/** Stores a new code version in the caller's transaction and keeps only the last 10. Returns its number. */
export async function recordPageCodeVersion(client:SqlClient,input:{
 tenantId:string;pageApi:string;variant:string;appApi:string;pageRevision:number|null;actorId:string|null;
 source:GeneratedPageSource;
}):Promise<number>{
 const key=[input.tenantId,input.pageApi,input.variant];
 // One writer at a time per page + layout, so two publishes never take the same number.
 // (PostgreSQL text can never hold a NUL character: the parts are joined with '|'.)
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['page-code|'+key.join('|')]);
 const found=await client.query(
  'SELECT version FROM md_page_code_versions WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3',key);
 const existing=found.rows.map(r=>Number(r.version));
 const version=(existing.length?Math.max(...existing):0)+1;
 await client.query(
  `INSERT INTO md_page_code_versions(tenant_id,page_api,layout_variant,version,page_revision,app_api,created_by,issue_count)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
  [...key,version,input.pageRevision,input.appApi,input.actorId,input.source.issues.length]);
 await client.query(
  `INSERT INTO md_page_code_version_files(tenant_id,page_api,layout_variant,version,path,content)
   SELECT $1,$2,$3,$4,t.path,t.content FROM unnest($5::text[],$6::text[]) AS t(path,content)`,
  [...key,version,input.source.files.map(f=>f.path),input.source.files.map(f=>f.content)]);
 const old=versionsToDelete([...existing,version]);
 if(old.length)await client.query(
  'DELETE FROM md_page_code_versions WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3 AND version=ANY($4::int[])',
  [...key,old]);
 return version;
}

/** Newest first. */
export async function listPageCodeVersions(client:SqlClient,tenantId:string,pageApi:string,variant:string):Promise<PageCodeVersionInfo[]>{
 const key=[tenantId,pageApi,variant];
 const versions=await client.query(
  `SELECT version,page_revision,app_api,created_at,created_by,issue_count FROM md_page_code_versions
   WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3 ORDER BY version DESC`,key);
 const files=await client.query(
  `SELECT version,path FROM md_page_code_version_files
   WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3 ORDER BY version,path`,key);
 const byVersion=new Map<number,string[]>();
 for(const row of files.rows){
  const v=Number(row.version);
  byVersion.set(v,[...(byVersion.get(v)??[]),String(row.path)]);
 }
 return versions.rows.map(r=>({
  version:Number(r.version),
  pageRevision:r.page_revision===null||r.page_revision===undefined?null:Number(r.page_revision),
  appApi:r.app_api??null,
  createdAt:r.created_at instanceof Date?r.created_at.toISOString():String(r.created_at),
  createdBy:r.created_by??null,
  issueCount:Number(r.issue_count),
  files:byVersion.get(Number(r.version))??[]
 }));
}

export async function readPageCodeFile(client:SqlClient,tenantId:string,pageApi:string,variant:string,
 version:number,path:string):Promise<string|null>{
 const found=await client.query(
  `SELECT content FROM md_page_code_version_files
   WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3 AND version=$4 AND path=$5`,
  [tenantId,pageApi,variant,version,path]);
 return found.rows.length?String(found.rows[0].content):null;
}

/** The newest code version of a page layout with all its files (what the app runs from). */
export async function latestPageCodeVersion(client:SqlClient,tenantId:string,pageApi:string,variant:string):
 Promise<{version:number;pageRevision:number|null;files:Record<string,string>}|null>{
 const head=await client.query(
  `SELECT version,page_revision FROM md_page_code_versions WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3
   ORDER BY version DESC LIMIT 1`,[tenantId,pageApi,variant]);
 if(!head.rows.length)return null;
 const version=Number(head.rows[0].version);
 const found=await client.query(
  `SELECT path,content FROM md_page_code_version_files
   WHERE tenant_id=$1 AND page_api=$2 AND layout_variant=$3 AND version=$4`,[tenantId,pageApi,variant,version]);
 const files:Record<string,string>={};
 for(const row of found.rows)files[String(row.path)]=String(row.content);
 const revision=head.rows[0].page_revision;
 return {version,pageRevision:revision===null||revision===undefined?null:Number(revision),files};
}
