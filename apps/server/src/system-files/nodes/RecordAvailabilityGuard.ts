import type {PoolClient} from 'pg';

type Mapping={object:string;staff:string;active:string;weekday?:string;start:string;end:string;resource?:string};
type Guard={startField:string;endField:string;staffFields:string[];resourceField?:string;
 statusField?:string;excludedStatuses?:string[];
 schedule?:Mapping;exception?:Mapping};
const api=/^[A-Za-z][A-Za-z0-9_]*$/;
const valid=(value:unknown):value is string=>typeof value==='string'&&api.test(value);
function validate(raw:unknown):Guard{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid availability guard');
 const g=raw as Record<string,unknown>;
 if(!valid(g.startField)||!valid(g.endField)||!Array.isArray(g.staffFields)
  ||!g.staffFields.length||g.staffFields.length>5||g.staffFields.some(x=>!valid(x))
  ||g.resourceField!==undefined&&!valid(g.resourceField)
  ||g.statusField!==undefined&&!valid(g.statusField)
  ||g.excludedStatuses!==undefined&&(!Array.isArray(g.excludedStatuses)
   ||g.excludedStatuses.length>20||g.excludedStatuses.some(x=>typeof x!=='string'||x.length>60)))
  throw Error('Invalid availability fields');
 for(const key of ['schedule','exception']){
  const m=g[key];
  if(m===undefined)continue;
  if(!m||typeof m!=='object'||Array.isArray(m))throw Error('Invalid availability mapping');
  const fields=m as Record<string,unknown>;
  for(const required of ['object','staff','active','start','end',...(key==='schedule'?['weekday']:['resource'])])
   if(!valid(fields[required]))throw Error('Invalid availability mapping field');
 }
 return g as Guard;
}
/** Tenant-local display time for recurring staff shifts. Actual interval comparisons use UTC. */
function localWindow(instant:string,zone:string){
 const options:Intl.DateTimeFormatOptions={timeZone:zone,weekday:'long',hour:'2-digit',
  minute:'2-digit',hourCycle:'h23'};
 const fmt=new Intl.DateTimeFormat('en-GB',options);
 const p=Object.fromEntries(fmt.formatToParts(new Date(instant)).map(x=>[x.type,x.value]));
 return {weekday:p.weekday,time:p.hour+':'+p.minute};
}
/** Configured via Flow metadata. Reads tenant-scoped records inside the booking transaction.
 * Absence of staff shifts falls back to the mandatory tenant business-calendar guard.
 * Once a staff member has defined shifts, uncovered times fail closed.
 */
export async function enforceRecordAvailability(client:PoolClient,tenantId:string,
 raw:unknown,record:Record<string,unknown>):Promise<void>{
 if(raw===null||raw===undefined)return;
 const g=validate(raw);
 if(g.statusField&&g.excludedStatuses?.includes(String(record[g.statusField]??'')))return;
 const start=record[g.startField],end=record[g.endField];
 if(typeof start!=='string'||typeof end!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(start)
  ||!/(Z|[+-]\d{2}:\d{2})$/.test(end)||!Number.isFinite(Date.parse(start))
  ||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start))
  throw Error('Availability requires an ordered timezone-qualified interval');
 const staff=g.staffFields.map(field=>record[field]).find(x=>typeof x==='string'&&x.trim());
 const resource=g.resourceField?record[g.resourceField]:undefined;
 if(typeof staff!=='string'||!staff.trim())throw Error('Availability requires assigned staff');
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(staff))throw Error('Booking requires a valid tenant staff user');
 const {rowCount:activeStaff}=await client.query(
  'SELECT 1 FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true',[tenantId,staff]);
 if(!activeStaff)throw Error('Assigned staff user is not enabled in this tenant');
 const {rows:settings}=await client.query<{properties:{timezone?:string}}>(
  "SELECT properties FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key='business-calendar'",
  [tenantId]);
 const zone=settings[0]?.properties?.timezone;
 if(typeof zone!=='string'||!zone.trim())throw Error('Tenant time zone must be configured');
 let from:{weekday:string;time:string},to:{weekday:string;time:string};
 try{from=localWindow(start,zone);to=localWindow(end,zone);}
 catch{throw Error('Invalid tenant time zone');}
 if(g.schedule){
  const m=g.schedule;
  const staffByOwner=m.staff==='OwnerId';
  const {rows}=await client.query<{configured:boolean;covered:boolean}>(`
   SELECT COUNT(*)>0 AS configured,
    COALESCE(BOOL_OR(weekday.value_text=$4 AND left(from_time.value_text,5)<=$5
      AND left(to_time.value_text,5)>=$6),false) AS covered
   FROM md_records r
   ${staffByOwner?'':`JOIN md_record_values person ON person.tenant_id=r.tenant_id AND person.record_id=r.id
    AND person.field_api=$7`}
   LEFT JOIN md_record_values enabled ON enabled.tenant_id=r.tenant_id
    AND enabled.record_id=r.id AND enabled.field_api=$8
   JOIN md_record_values weekday ON weekday.tenant_id=r.tenant_id AND weekday.record_id=r.id
    AND weekday.field_api=$9
   JOIN md_record_values from_time ON from_time.tenant_id=r.tenant_id
    AND from_time.record_id=r.id AND from_time.field_api=$10
   JOIN md_record_values to_time ON to_time.tenant_id=r.tenant_id
    AND to_time.record_id=r.id AND to_time.field_api=$11
   WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false
    AND ${staffByOwner?'r.owner_id::text':'COALESCE(person.reference_record_id::text,person.value_text)'}=$3
    AND COALESCE(enabled.value_boolean,true)=true`,
   [tenantId,m.object,staff,from.weekday,from.time,to.time,m.staff,m.active,m.weekday,m.start,m.end]);
  if(rows[0]?.configured&&!rows[0].covered)throw Error('Appointment is outside assigned staff availability');
 }
 if(g.exception){
  const m=g.exception;
  const staffByOwner=m.staff==='OwnerId';
  const keys=[...(staffByOwner?[]:[staff]),
   ...(typeof resource==='string'&&resource.trim()?[resource]:[])];
  const fields=[...(staffByOwner?[]:[m.staff]),...(m.resource?[m.resource]:[])];
  const {rowCount}=await client.query(`
   SELECT 1 FROM md_records r
   JOIN md_record_values begins ON begins.tenant_id=r.tenant_id
    AND begins.record_id=r.id AND begins.field_api=$4
   JOIN md_record_values ends ON ends.tenant_id=r.tenant_id
    AND ends.record_id=r.id AND ends.field_api=$5
   LEFT JOIN md_record_values enabled ON enabled.tenant_id=r.tenant_id
    AND enabled.record_id=r.id AND enabled.field_api=$6
   WHERE r.tenant_id=$1 AND r.object_api=$2 AND r.is_deleted=false
    AND begins.value_datetime<$8::timestamptz AND ends.value_datetime>$7::timestamptz
    AND COALESCE(enabled.value_boolean,true)=true
    AND (${staffByOwner?'r.owner_id::text=$10 OR ':''}EXISTS(
      SELECT 1 FROM md_record_values target
      WHERE target.tenant_id=r.tenant_id AND target.record_id=r.id
        AND target.field_api=ANY($3::text[])
        AND COALESCE(target.reference_record_id::text,target.value_text)=ANY($9::text[])))
   LIMIT 1`,[tenantId,m.object,fields,m.start,m.end,m.active,start,end,keys,staff]);
  if(rowCount)throw Error('Assigned staff or resource is unavailable at the selected time');
 }
}
