import type {SqlPersistence} from '../system-files/sql-persistence.js';
/** Generic Flow metadata guard for scheduling mutations. Business calendar comes
 * from the shared tenant settings store; any Flow can opt into this guard.
 * It runs server-side before a Flow can persist any business records.
 */
export async function enforceFlowBusinessCalendar(
 db:SqlPersistence,tenantId:string,guard:unknown,inputs:Record<string,unknown>):Promise<void>{
 if(!guard||typeof guard!=='object'||Array.isArray(guard))return;
 const {startInput,endInput}=guard as Record<string,unknown>;
 if(typeof startInput!=='string'||typeof endInput!=='string'
  ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(startInput)
  ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(endInput))
  throw new Error('Invalid Flow Business Calendar guard metadata');
 const collectionInput=(guard as Record<string,unknown>).collectionInput;
 let source:Record<string,unknown>=inputs;
 if(collectionInput!==undefined){
  if(typeof collectionInput!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(collectionInput))
   throw new Error('Invalid calendar guard collection input');
  const collection=inputs[collectionInput];
  if(!Array.isArray(collection)||collection.length!==1
   ||!collection[0]||typeof collection[0]!=='object'||Array.isArray(collection[0]))
   throw new Error('Booking requires exactly one appointment record');
  source=collection[0] as Record<string,unknown>;
 }
 const start=source[startInput],end=source[endInput];
 const {rows}=await db.query<{properties:unknown}>(`
  SELECT properties FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key='business-calendar'`,[tenantId]);
 const setting=rows[0]?.properties;
 if(!setting||typeof setting!=='object'||Array.isArray(setting))
  throw new Error('Tenant business calendar must be configured before booking');
 const calendar=setting as Record<string,unknown>;
 if(typeof calendar.timezone!=='string')throw new Error('Tenant business timezone unavailable');
 let formatter:Intl.DateTimeFormat;
 try{formatter=new Intl.DateTimeFormat('en-GB',{timeZone:calendar.timezone,
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}
 catch{throw new Error('Invalid tenant business timezone');}
 const local=(value:unknown):string=>{
  if(typeof value!=='string')throw new Error('Appointment date/time is required');
  if(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value))return value;
  if(!/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)||!Number.isFinite(Date.parse(value)))
   throw new Error('Invalid appointment date/time');
  const parts=Object.fromEntries(formatter.formatToParts(new Date(value)).map(x=>[x.type,x.value]));
  return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
 };
 const startLocal=local(start),endLocal=local(end);
 if(startLocal>=endLocal)throw new Error('Appointment end must be after start');
 const date=startLocal.slice(0,10);
 if(date!==endLocal.slice(0,10))throw new Error('Appointment must be within one business day');
 const parts=date.split('-').map(Number);
 const parsed=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)
  throw new Error('Invalid appointment calendar date');
 const holidays=Array.isArray(calendar.holidays)?calendar.holidays:[];
 if(holidays.some(x=>x&&typeof x==='object'&&(x as {date?:unknown}).date===date))
  throw new Error('Appointment date is a tenant holiday');
 const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
 const day=days[parsed.getUTCDay()];
 const weekly=calendar.weeklyHours;
 const hours=weekly&&typeof weekly==='object'&&!Array.isArray(weekly)
  ?(weekly as Record<string,unknown>)[day]:null;
 if(!hours||typeof hours!=='object'||Array.isArray(hours))
  throw new Error('Business hours not configured for '+day);
 const value=hours as Record<string,unknown>;
 if(value.closed===true)throw new Error('The tenant is closed on '+day);
 if(typeof value.open!=='string'||typeof value.close!=='string'
  ||startLocal.slice(11,16)<value.open||endLocal.slice(11,16)>value.close)
  throw new Error('Appointment is outside tenant business hours');
}
