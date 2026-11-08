import {isIP} from 'node:net';
import {z} from 'zod';
import type {SqlExecutor,SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
export type LoginContext={ip?:string;path?:string;method?:string;oauthClientId?:string};
export function normalizedLoginIp(raw:string|undefined){
 const candidate=raw?.startsWith('::ffff:')&&isIP(raw.slice(7))===4?raw.slice(7):raw;
 return candidate&&isIP(candidate)?candidate:null;
}
const policy=z.object({access_minutes:z.number().int().min(5).max(1440).default(60),
 refresh_minutes:z.number().int().min(5).max(43200).default(43200),idle_minutes:z.number().int().min(5).max(1440).default(60),
 require_mfa:z.boolean().default(false),frame_policy:z.enum(['DENY','SAMEORIGIN']).default('DENY'),csp_enabled:z.boolean().default(true)}).strict();
const profile=z.string().uuid().nullable().default(null);
const range=z.object({profile_id:profile,kind:z.enum(['login','trusted']),network:z.string().max(64).refine(value=>{
 const [ip,prefix,...extra]=value.split('/');const family=isIP(ip);
 return !!family&&!extra.length&&(prefix===undefined||(/^\d{1,3}$/.test(prefix)&&Number(prefix)<=(family===4?32:128)));
})}).strict();
const hour=z.object({profile_id:profile,weekday:z.number().int().min(1).max(7),start_minute:z.number().int().min(0).max(1439),
 end_minute:z.number().int().min(1).max(1440),timezone:z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}})
}).strict().refine(v=>v.start_minute<v.end_minute);
const settings=z.object({policy,ranges:z.array(range).max(100),hours:z.array(hour).max(100)}).strict();
export async function readSessionPolicy(db:SqlExecutor,tenant:string){
 const {rows}=await db.query('SELECT access_minutes,refresh_minutes,idle_minutes,require_mfa,frame_policy,csp_enabled FROM md_session_policies WHERE tenant_id=$1',[tenant]);
 return policy.parse(rows[0]??{});
}
/** Restrictions are intersections: tenant and each assigned profile must independently allow access. */
export async function enforceLoginBoundary(db:SqlExecutor,tenant:string,user:string,context:LoginContext={}){
 const ip=normalizedLoginIp(context.ip);
 const {rows}=await db.query<{allowed:boolean;trusted:boolean}>(`SELECT md_login_boundary_allowed($1,$2,$3::inet) AS allowed,
 EXISTS(SELECT 1 FROM md_login_ip_ranges r WHERE r.tenant_id=$1 AND r.kind='trusted' AND $3::inet <<= r.network
  AND (r.profile_id IS NULL OR r.profile_id IN(SELECT profile_id FROM md_user_profiles WHERE tenant_id=$1 AND user_id=$2))) AS trusted`,[tenant,user,ip]);
 if(rows[0]?.allowed!==true)throw Error('Invalid credentials or login restrictions');
 return {trusted:rows[0]?.trusted===true};
}
export class SessionPolicyService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 async read(tenant:string,user:string){
  await this.rbac.require(tenant,user,'Security','read');
  const [p,r,h,profiles]=await Promise.all([readSessionPolicy(this.db,tenant),
   this.db.query('SELECT profile_id,kind,network::text FROM md_login_ip_ranges WHERE tenant_id=$1 ORDER BY id',[tenant]),
   this.db.query('SELECT profile_id,weekday,start_minute,end_minute,timezone FROM md_login_hours WHERE tenant_id=$1 ORDER BY id',[tenant]),
   this.db.query('SELECT id,label FROM md_profiles WHERE tenant_id=$1 ORDER BY label',[tenant])]);
  return {policy:p,ranges:r.rows,hours:h.rows,profiles:profiles.rows};
 }
 async save(tenant:string,user:string,input:unknown){
  await this.rbac.require(tenant,user,'Security','manage');
  const parsed=settings.safeParse(input);if(!parsed.success)throw Error('Invalid session or login policy');
  const {policy:p,ranges,hours}=parsed.data;
  await this.db.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenant+':session-policy']);
   for(const id of new Set([...ranges,...hours].map(r=>r.profile_id).filter(Boolean))){
    const found=await c.query('SELECT id FROM md_profiles WHERE tenant_id=$1 AND id=$2',[tenant,id]);
    if(!found.rows[0])throw Error('Invalid profile');
   }
   await c.query(`INSERT INTO md_session_policies(tenant_id,access_minutes,refresh_minutes,idle_minutes,require_mfa,frame_policy,csp_enabled)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id) DO UPDATE SET access_minutes=$2,refresh_minutes=$3,idle_minutes=$4,require_mfa=$5,frame_policy=$6,csp_enabled=$7`,
    [tenant,p.access_minutes,p.refresh_minutes,p.idle_minutes,p.require_mfa,p.frame_policy,p.csp_enabled]);
   await c.query('DELETE FROM md_login_ip_ranges WHERE tenant_id=$1',[tenant]);
   await c.query('DELETE FROM md_login_hours WHERE tenant_id=$1',[tenant]);
   for(const r of ranges)await c.query('INSERT INTO md_login_ip_ranges(tenant_id,profile_id,kind,network) VALUES($1,$2,$3,$4::inet::cidr)',[tenant,r.profile_id,r.kind,r.network]);
   for(const h of hours)await c.query('INSERT INTO md_login_hours(tenant_id,profile_id,weekday,start_minute,end_minute,timezone) VALUES($1,$2,$3,$4,$5,$6)',[tenant,h.profile_id,h.weekday,h.start_minute,h.end_minute,h.timezone]);
   await c.query("INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,'SessionPolicyUpdated')",[tenant,user]);
  });
  return this.read(tenant,user);
 }
}
export function browserSecurityHeaders(p:{frame_policy:string;csp_enabled:boolean}){
 return {'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':p.frame_policy,
  ...(p.csp_enabled?{'Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https:; frame-ancestors ${p.frame_policy==='DENY'?"'none'":"'self'"}`}:{})};
}
