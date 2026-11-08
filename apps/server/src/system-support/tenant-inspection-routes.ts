import {randomBytes} from 'node:crypto';
import {resolveTxt} from 'node:dns/promises';
import {isIP} from 'node:net';
import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {PlatformTenantService} from '../system-files/platform-tenant-service.js';

type Actor={tenant_id:string;user_id:string};
type Req=Request<Record<string,string>>&{actor?:Actor};
type AuthenticatedUsageRequest=Request&{actor?:Actor};
const wrap=(fn:(req:Req,res:Response)=>Promise<void>)=>
  (req:Request,res:Response,next:NextFunction)=>{
    // These routes use named parameters only; Express wildcard parameters are not registered here.
    void fn(req as Req,res).catch(next);
  };
const slug=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hostname=/^(?=.{4,253}$)[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const metrics=['users','records','objects','flows'] as const;
type UsageMetric=typeof metrics[number]|'storage_bytes'|'api_requests_daily';
type Counts=Record<string,number>;
const validHost=(input:unknown):string=>{
  if(typeof input!=='string'||!hostname.test(input)||isIP(input)||
    /\.(?:internal|localhost|local|invalid|example|test)$/.test(input))
    throw new Error('Invalid tenant domain');
  return input;
};
const mustActor=(req:Req):Actor=>{
  if(!req.actor?.tenant_id||!req.actor.user_id)throw new Error('Authenticated tenant required');
  return req.actor;
};

/** Count completed authenticated API requests without recording URLs or payloads. */
export function countTenantApiRequests(db:SqlPersistence){
 return (req:AuthenticatedUsageRequest,res:Response,next:NextFunction)=>{
  const tenantId=req.actor?.tenant_id;
  if(!tenantId||req.method==='OPTIONS'){next();return;}
  res.once('finish',()=>{
   void db.query(`INSERT INTO md_tenant_api_usage_daily(tenant_id,usage_date,request_count)
    VALUES($1,CURRENT_DATE,1)
    ON CONFLICT(tenant_id,usage_date) DO UPDATE
     SET request_count=md_tenant_api_usage_daily.request_count+1`,[tenantId])
    .catch(error=>console.error('Unable to record tenant API usage',error));
  });
  next();
 };
}

/** Reusable tenant configuration endpoints: SQL counts, DNS proof, platform-only remote access. */
export function registerTenantInspectionRoutes(app:Express,db:SqlPersistence,
  rbac:RbacEngine,platform:PlatformTenantService){
  const target=async(req:Req,external:boolean,write:boolean)=>{
    const a=mustActor(req);
    if(!external){
      await rbac.require(a.tenant_id,a.user_id,'Tenant',write?'manage':'read');
      const {rows}=await db.query<{slug:string}>(
        'SELECT slug FROM md_tenants WHERE id=$1',[a.tenant_id]);
      if(!rows[0])throw new Error('Tenant not found');
      return {actor:a,tenantId:a.tenant_id,slug:rows[0].slug};
    }
    await platform.requirePlatform(a.tenant_id,a.user_id);
    const name=req.params.slug;
    if(!slug.test(name))throw new Error('Invalid tenant identifier');
    const {rows}=await db.query<{id:string}>(
      'SELECT id FROM md_tenants WHERE slug=$1',[name]);
    if(!rows[0])throw new Error('Tenant not found');
    return {actor:a,tenantId:rows[0].id,slug:name};
  };
  const audit=async(client:{query:(sql:string,params:unknown[])=>Promise<unknown>},
    actor:Actor,action:string,details:Record<string,unknown>)=>{
    await client.query(
      'INSERT INTO md_security_events(tenant_id,actor_user_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
      [actor.tenant_id,actor.user_id,action,JSON.stringify(details)]);
  };
  const usage=async(req:Req,external:boolean)=>{
    const {tenantId,slug:name}=await target(req,external,false);
    const {rows}=await db.query<Record<string,string>>(`
      SELECT t.status,
       (SELECT count(*)::text FROM md_users u WHERE u.tenant_id=t.id) AS users,
       (SELECT count(*)::text FROM md_users u WHERE u.tenant_id=t.id AND u.enabled) AS active_users,
       (SELECT count(*)::text FROM md_object_definitions o WHERE o.tenant_id=t.id) AS objects,
       (SELECT count(*)::text FROM md_object_definitions o WHERE o.tenant_id=t.id
          AND o.api_name LIKE '%\\_\\_c' ESCAPE '\\') AS custom_objects,
       (SELECT count(*)::text FROM md_field_definitions f WHERE f.tenant_id=t.id) AS fields,
       (SELECT count(*)::text FROM md_records r WHERE r.tenant_id=t.id) AS records,
       (SELECT count(DISTINCT f.api_name)::text FROM md_flow_definitions f WHERE f.tenant_id=t.id) AS flows,
       (SELECT count(DISTINCT f.api_name)::text FROM md_flow_definitions f
          WHERE f.tenant_id=t.id AND f.active=true) AS active_flows,
       (SELECT count(*)::text FROM md_page_definitions p
          WHERE p.tenant_id=t.id AND p.enabled=true) AS pages,
       (SELECT count(*)::text FROM md_app_installations i WHERE i.tenant_id=t.id) AS apps,
       (SELECT count(*)::text FROM md_system_definitions d WHERE d.tenant_id=t.id
          AND d.kind='reports' AND d.enabled=true) AS reports,
       (SELECT count(*)::text FROM md_system_definitions d WHERE d.tenant_id=t.id
          AND d.kind='dashboards' AND d.enabled=true) AS dashboards,
       (SELECT count(*)::text FROM md_named_credentials c WHERE c.tenant_id=t.id) AS named_credentials,
       (SELECT count(*)::text FROM md_approval_requests a WHERE a.tenant_id=t.id
          AND a.status='Pending') AS pending_approvals,
       (SELECT count(*)::text FROM md_tenant_domains d WHERE d.tenant_id=t.id) AS verified_domains
      FROM md_tenants t WHERE t.id=$1`,[tenantId]);
    const row=rows[0];if(!row)throw new Error('Tenant not found');
    const keys:Record<string,string>={users:'users',activeUsers:'active_users',
      objects:'objects',customObjects:'custom_objects',fields:'fields',records:'records',
      flows:'flows',activeFlows:'active_flows',pages:'pages',apps:'apps',reports:'reports',
      dashboards:'dashboards',namedCredentials:'named_credentials',
      pendingApprovals:'pending_approvals',verifiedDomains:'verified_domains'};
    const counts:Counts={};
    for(const [name,key] of Object.entries(keys))counts[name]=Number(row[key]??0);
    const [{rows:limits},{rows:storageRows},{rows:apiRows}]=await Promise.all([
      db.query<{metric:UsageMetric;target_value:string}>(
        'SELECT metric,target_value FROM md_tenant_usage_targets WHERE tenant_id=$1',[tenantId]),
      db.query<{storage_bytes:string}>(`SELECT
        COALESCE((SELECT sum(pg_column_size(r)) FROM md_records r WHERE r.tenant_id=$1),0)
        +COALESCE((SELECT sum(pg_column_size(v)) FROM md_record_values v WHERE v.tenant_id=$1),0)
        +COALESCE((SELECT sum(f.byte_size) FROM md_record_files f WHERE f.tenant_id=$1),0)
        AS storage_bytes`,[tenantId]),
      db.query<{request_count:string}>(`SELECT COALESCE(sum(request_count),0)::text AS request_count
        FROM md_tenant_api_usage_daily WHERE tenant_id=$1 AND usage_date=CURRENT_DATE`,[tenantId])
    ]);
    const usageTargets:Partial<Record<UsageMetric,number>>={};
    for(const limit of limits)usageTargets[limit.metric]=Number(limit.target_value);
    const storageBytes=Number(storageRows[0]?.storage_bytes??0);
    const apiRequestsToday=Number(apiRows[0]?.request_count??0);
    return {tenantId:name,status:row.status,sampledAt:new Date().toISOString(),counts,targets:usageTargets,
      usageTargets,storageBytes,apiRequestsToday,
      warnings:[
       ...metrics.filter(key=>usageTargets[key]!==undefined&&counts[key]>=usageTargets[key]!),
       ...(usageTargets.storage_bytes!==undefined&&storageBytes>=usageTargets.storage_bytes?['storage_bytes']:[]),
       ...(usageTargets.api_requests_daily!==undefined&&apiRequestsToday>=usageTargets.api_requests_daily?['api_requests_daily']:[])
      ],
      enforcement:'advisory_only' as const};
  };
  const getUsage=(external:boolean)=>wrap(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json({usage:await usage(req,external)});
  });
  app.get('/api/tenant/usage',getUsage(false));
  app.get('/api/platform/tenants/:slug/usage',getUsage(true));
  app.patch('/api/platform/tenants/:slug/usage-targets',wrap(async(req,res)=>{
    const {actor,tenantId,slug:name}=await target(req,true,true),body=req.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).some(key=>!['users','records','objects','flows','storage_bytes','api_requests_daily'].includes(key)))
      throw new Error('Invalid advisory usage targets');
    const values=body as Record<UsageMetric,unknown>;
    const allMetrics:UsageMetric[]=['users','records','objects','flows','storage_bytes','api_requests_daily'];
    for(const key of allMetrics){
      const n=values[key]??null;
      if(n!==null&&(!Number.isSafeInteger(n)||Number(n)<1||Number(n)>Number.MAX_SAFE_INTEGER))
        throw new Error('Invalid usage target: '+key);
    }
    await db.transaction(async client=>{
      for(const metric of allMetrics){
        const value=values[metric]??null;
        if(value===null)await client.query(
          'DELETE FROM md_tenant_usage_targets WHERE tenant_id=$1 AND metric=$2',
          [tenantId,metric]);
        else await client.query(`
          INSERT INTO md_tenant_usage_targets(tenant_id,metric,target_value)
          VALUES($1,$2,$3) ON CONFLICT(tenant_id,metric) DO UPDATE
          SET target_value=EXCLUDED.target_value,updated_at=now()`,
          [tenantId,metric,value]);
      }
      await audit(client,actor,'tenant_usage_targets_updated',{targetTenantId:tenantId,targets:values});
    });
    res.json({usage:await usage(req,true)});
  }));
  const listDomains=(external:boolean)=>wrap(async(req,res)=>{
    const {tenantId}=await target(req,external,false);
    const {rows}=await db.query<{domain:string;proof_token:string|null;created_at:Date;
      verified_at:Date|null}>(`
      SELECT domain,proof_token,created_at,verified_at FROM md_tenant_domain_claims
      WHERE tenant_id=$1
      UNION ALL
      SELECT d.domain,NULL::text,d.created_at,d.verified_at
      FROM md_tenant_domains d WHERE d.tenant_id=$1
        AND NOT EXISTS(SELECT 1 FROM md_tenant_domain_claims c WHERE c.domain=d.domain)
      ORDER BY domain`,[tenantId]);
    res.json({domains:rows.map(r=>({
      hostname:r.domain,status:r.verified_at?'VERIFIED':'PENDING',
      createdAt:r.created_at,verifiedAt:r.verified_at??undefined,
      verification:{type:'TXT',host:'_metadrive-challenge.'+r.domain,
        value:r.proof_token?'metadrive-verification='+r.proof_token:''},
      hosting:r.verified_at?'Configure TLS for this domain':'DNS verification pending'
    }))});
  });
  const addDomain=(external:boolean)=>wrap(async(req,res)=>{
    const {actor,tenantId}=await target(req,external,true);
    const domain=validHost(req.body?.hostname);
    const proof=randomBytes(24).toString('hex');
    await db.transaction(async client=>{
      const {rows}=await client.query<{n:string}>(`
        SELECT count(*)::text AS n FROM (
          SELECT domain FROM md_tenant_domain_claims WHERE tenant_id=$1
          UNION SELECT domain FROM md_tenant_domains WHERE tenant_id=$1
        ) d`,[tenantId]);
      if(Number(rows[0].n)>=5)throw new Error('Maximum five tenant domains allowed');
      const claimed=await client.query(
        'SELECT 1 FROM md_tenant_domains WHERE domain=$1',[domain]);
      if(claimed.rowCount)throw new Error('Domain already registered');
      await client.query(`INSERT INTO md_tenant_domain_claims(tenant_id,domain,proof_token)
        VALUES($1,$2,$3)`,[tenantId,domain,proof]);
      await audit(client,actor,'tenant_domain_claim_created',{targetTenantId:tenantId,domain});
    });
    res.status(201).json({hostname:domain,status:'PENDING',
      verification:{type:'TXT',host:'_metadrive-challenge.'+domain,
        value:'metadrive-verification='+proof}});
  });
  const verifyDomain=(external:boolean)=>wrap(async(req,res)=>{
    const {actor,tenantId}=await target(req,external,true);
    const domain=validHost(req.params.domain);
    const {rows}=await db.query<{proof_token:string;verified_at:Date|null}>(`
      SELECT proof_token,verified_at FROM md_tenant_domain_claims
      WHERE tenant_id=$1 AND domain=$2`,[tenantId,domain]);
    if(!rows[0])throw new Error('Domain claim not found');
    if(!rows[0].verified_at){
      let txt:string[][];
      try{txt=await resolveTxt('_metadrive-challenge.'+domain);}
      catch{throw new Error('Domain DNS TXT proof unavailable');}
      if(!txt.some(parts=>parts.join('')==='metadrive-verification='+rows[0].proof_token))
        throw new Error('Domain DNS ownership proof does not match');
      await db.transaction(async client=>{
        const current=await client.query<{proof_token:string;verified_at:Date|null}>(`
          SELECT proof_token,verified_at FROM md_tenant_domain_claims
          WHERE tenant_id=$1 AND domain=$2 FOR UPDATE`,[tenantId,domain]);
        if(!current.rows[0]||current.rows[0].proof_token!==rows[0].proof_token)
          throw new Error('Domain proof was changed');
        await client.query(`INSERT INTO md_tenant_domains(domain,tenant_id)
          VALUES($1,$2) ON CONFLICT(domain) DO NOTHING`,[domain,tenantId]);
        const mapped=await client.query<{tenant_id:string}>(`
          SELECT tenant_id FROM md_tenant_domains WHERE domain=$1`,[domain]);
        if(mapped.rows[0]?.tenant_id!==tenantId)throw new Error('Domain already owned by another tenant');
        await client.query(`UPDATE md_tenant_domain_claims SET verified_at=now()
          WHERE tenant_id=$1 AND domain=$2`,[tenantId,domain]);
        await audit(client,actor,'tenant_domain_verified',{targetTenantId:tenantId,domain});
      });
    }
    res.json({hostname:domain,status:'VERIFIED'});
  });
  const removeDomain=(external:boolean)=>wrap(async(req,res)=>{
    const {actor,tenantId,slug:name}=await target(req,external,true);
    const domain=validHost(req.params.domain);
    const base=process.env.METADRIVE_TENANT_BASE_DOMAIN?.toLowerCase();
    if(base&&domain===name+'.'+base)throw new Error('Cannot remove platform-owned login domain');
    await db.transaction(async client=>{
      const claim=await client.query('DELETE FROM md_tenant_domain_claims WHERE tenant_id=$1 AND domain=$2 RETURNING domain',
        [tenantId,domain]);
      const registered=await client.query('DELETE FROM md_tenant_domains WHERE tenant_id=$1 AND domain=$2 RETURNING domain',
        [tenantId,domain]);
      if(!claim.rowCount&&!registered.rowCount)throw new Error('Domain not found');
      await audit(client,actor,'tenant_domain_removed',{targetTenantId:tenantId,domain});
    });
    res.status(204).end();
  });
  app.get('/api/tenant/domains',listDomains(false));
  app.post('/api/tenant/domains',addDomain(false));
  app.post('/api/tenant/domains/:domain/verify',verifyDomain(false));
  app.delete('/api/tenant/domains/:domain',removeDomain(false));
  app.get('/api/platform/tenants/:slug/domains',listDomains(true));
  app.post('/api/platform/tenants/:slug/domains',addDomain(true));
  app.post('/api/platform/tenants/:slug/domains/:domain/verify',verifyDomain(true));
  app.delete('/api/platform/tenants/:slug/domains/:domain',removeDomain(true));
}
