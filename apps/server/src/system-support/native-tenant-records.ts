import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';

type Actor={tenant_id:string;user_id:string};
type TenantRow={id:string;name:string;slug:string};

/**
 * Tenant is backed by md_tenants, not md_records. Expose only the current
 * tenant through the same record-shaped contract used by reference pickers.
 * The platform tenant-management APIs remain responsible for administration.
 */
export class NativeTenantRecordReader {
  constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}

  private async current(actor:Actor){
    await this.rbac.require(actor.tenant_id,actor.user_id,'Tenant','read');
    const {rows}=await this.db.query<TenantRow>(
      'SELECT id,name,slug FROM md_tenants WHERE id=$1',[actor.tenant_id]);
    if(!rows[0])throw new Error('Record not found');
    const checks=['Name','Slug'].map(field=>({resource:'Tenant.'+field,action:'read'}));
    const allowed=await this.rbac.allowedMany(actor.tenant_id,actor.user_id,checks);
    const record:Record<string,string>={Id:rows[0].id};
    if(allowed[0])record.Name=rows[0].name;
    if(allowed[1])record.Slug=rows[0].slug;
    return record;
  }

  async list(actor:Actor,limit:number,offset:number,search:unknown){
    if(!Number.isInteger(limit)||limit<1||!Number.isInteger(offset)||offset<0)
      throw new Error('Invalid pagination');
    if(search!==undefined&&(typeof search!=='string'||search.length>256))
      throw new Error('Invalid record list query');
    const record=await this.current(actor);
    const term=(typeof search==='string'?search:'').trim().toLocaleLowerCase();
    const matched=!term||Object.entries(record).some(([field,value])=>
      field!=='Id'&&value.toLocaleLowerCase().includes(term));
    const total=matched?1:0;
    return {records:matched&&offset===0?[record]:[],total};
  }

  async get(actor:Actor,id:string){
    // Never turn a platform Tenant lookup into cross-tenant discovery.
    if(id!==actor.tenant_id)throw new Error('Record not found');
    return {record:await this.current(actor)};
  }
}
