import type {FlowNodeContext,FlowActionResult} from './NodeContext.js';
import {resolveFlowLocalDateTime} from '../flow-wait-runtime.js';
import {enforceRecordAvailability} from './RecordAvailabilityGuard.js';
import {enforceRecordOverlap} from './RecordOverlapGuard.js';
import {enforceFlowBusinessCalendar} from '../../flow-engine/FlowBusinessCalendarGuard.js';
import type {SqlPersistence} from '../sql-persistence.js';

const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const day=/^\d{4}-\d{2}-\d{2}$/;
const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
const hhmm=(value:number)=>String(Math.floor(value/60)).padStart(2,'0')+
 ':'+String(value%60).padStart(2,'0');
const string=(value:unknown)=>typeof value==='string'?value.trim():'';

/** Generic, metadata-configured Flow action for scheduling.
 * Reuses the same SQL-backed overlap and staff-availability guards as Create Records.
 * A time is suggested only when both guards permit it. Booking rechecks in its own
 * transaction, closing the slot-discovery vs. appointment-save race.
 */
export async function executeAvailableSlotsNode(context:FlowNodeContext):Promise<FlowActionResult>{
 const {node,client,tenantId,userId,recordQuery,evaluate,set}=context;
 const config=node.config;
 const mode=String(config.mode??'list');
 if(!['list','validate'].includes(mode))throw Error('Invalid available slots mode');
 const date=string(evaluate(config.date));
 const staff=string(evaluate(config.staffId));
 const duration=Number(config.durationMinutes??30);
 const limit=Number(config.maximumSlots??12);
 const object=string(config.appointmentObject);
 const scheduleObject=string(config.scheduleObject);
 const overlap=config.overlapGuard && typeof config.overlapGuard==='object'
  &&!Array.isArray(config.overlapGuard)?config.overlapGuard as Record<string,unknown>:{};
 const availability=config.availabilityGuard && typeof config.availabilityGuard==='object'
  &&!Array.isArray(config.availabilityGuard)?config.availabilityGuard as Record<string,unknown>:{};
 const startField=string(config.startField||overlap.startField);
 const endField=string(config.endField||overlap.endField);
 const staffField=string(config.staffField||(Array.isArray(availability.staffFields)
  ?availability.staffFields[0]:undefined));
 const statusField=string(config.statusField||overlap.statusField);
 const bookingStatus=string(config.bookingStatus||'Scheduled');
 const schedule=availability.schedule && typeof availability.schedule==='object'
  &&!Array.isArray(availability.schedule)
  ?availability.schedule as Record<string,unknown>:{};
 const scheduleStaff=string(schedule.staff),scheduleWeekday=string(schedule.weekday);
 const scheduleStart=string(schedule.start),scheduleEnd=string(schedule.end);
 const scheduleActive=string(schedule.active);
 if(!identifier.test(object)||!identifier.test(scheduleObject)
  ||![startField,endField,staffField,scheduleStaff,scheduleWeekday,
    scheduleStart,scheduleEnd,scheduleActive].every(field=>identifier.test(field))
  ||statusField!==''&&!identifier.test(statusField)
  ||bookingStatus.length>60
  ||!Number.isSafeInteger(duration)||duration<5||duration>240
  ||!Number.isSafeInteger(limit)||limit<1||limit>30)
  throw Error('Invalid available slots configuration');
 const output=mode==='list'
  ?[config.outputVariable,config.allowedVariable,config.availableVariable]
  :[config.startVariable,config.endVariable,config.validVariable];
 if(output.some(x=>typeof x!=='string'||!identifier.test(x)))
  throw Error('Invalid available slots output variable');
 const assignEmpty=()=>{
  if(mode==='list'){
   set(config.outputVariable,'');
   set(config.allowedVariable,'');
   set(config.availableVariable,false);
  }else{
   set(config.startVariable,'');
   set(config.endVariable,'');
   set(config.validVariable,false);
  }
 };
 assignEmpty();
 if(!day.test(date)||!uuid.test(staff))return {handled:true};
 const dateObject=new Date(date+'T12:00:00Z');
 if(!Number.isFinite(dateObject.getTime())||dateObject.toISOString().slice(0,10)!==date)
  return {handled:true};
 const {rows:setting}=await client.query<{properties:{timezone?:string}}> (
  "SELECT properties FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key='business-calendar'",
  [tenantId]);
 const zone=setting[0]?.properties?.timezone;
 if(!zone) return {handled:true};
 const {rowCount:activeStaff}=await client.query(
  'SELECT 1 FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true',[tenantId,staff]);
 if(!activeStaff)return {handled:true};
 const isFree=async(value:string)=>{
  const hour=minutes(value);
  if(hour+duration>1440)return null;
  let begins:Date,ends:Date;
  try{
   begins=resolveFlowLocalDateTime(date,value,zone);
   ends=resolveFlowLocalDateTime(date,hhmm(hour+duration),zone);
  }catch{return null;}
  if(begins.getTime()<Date.now()||ends.getTime()<=begins.getTime())return null;
  const record:Record<string,unknown>={
   [startField]:begins.toISOString(),[endField]:ends.toISOString(),
   [staffField]:staff,...(statusField?{[statusField]:bookingStatus}:{})};
  // Availability/overlap checks are shared and enforced again at Create Records.
  try{
   await enforceFlowBusinessCalendar(client as unknown as SqlPersistence,tenantId,
    config.businessCalendarGuard,record);
   await enforceRecordAvailability(client,tenantId,config.availabilityGuard,record);
   await enforceRecordOverlap(client,tenantId,object,config.overlapGuard,record);
  }catch(error){
   // Only expected guard rejections mean "not free"; SQL/runtime errors fail closed.
   const msg=error instanceof Error?error.message:'';
   if(!/already booked|unavailable|outside assigned staff availability|business hours|calendar|tenant holiday|closed on/i.test(msg))
    throw error;
   return null;
  }
  return {start:begins.toISOString(),end:ends.toISOString()};
 };
 if(mode==='validate'){
  const selected=string(evaluate(config.selectedTime));
  const allowed=string(evaluate(config.allowedSlots)).split('|').filter(timeValue=>time.test(timeValue));
  // Customers may reply using either the displayed slot number or its time.
  const position=/^[1-9][0-9]?$/.test(selected)?Number(selected)-1:-1;
  const selectedTime=position>=0?allowed[position]:selected;
  if(!selectedTime||!time.test(selectedTime)||!allowed.includes(selectedTime))
   return {handled:true};
  const interval=await isFree(selectedTime);
  if(!interval)return {handled:true};
  set(config.startVariable,interval.start);
  set(config.endVariable,interval.end);
  set(config.validVariable,true);
  return {handled:true};
 }
 const weekday=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(dateObject);
 const rows=await recordQuery.find(tenantId,userId,scheduleObject,[],undefined,{limit:200},client);
 const shifts=rows.filter(row=>row[scheduleStaff]===staff&&row[scheduleWeekday]===weekday
  &&row[scheduleActive]!==false);
 const result:string[]=[];
 const seen=new Set<string>();
 // No configured staff shifts => no promised slots. Avoid invented office hours.
 for(const shift of shifts){
  const begins=string(shift[scheduleStart]).slice(0,5);
  const ends=string(shift[scheduleEnd]).slice(0,5);
  if(!time.test(begins)||!time.test(ends)||minutes(ends)<=minutes(begins))continue;
  for(let offset=minutes(begins);offset+duration<=minutes(ends)&&result.length<limit;
      offset+=duration){
   const offered=hhmm(offset);
   if(seen.has(offered))continue;
   seen.add(offered);
   if(await isFree(offered))result.push(offered);
  }
  if(result.length>=limit)break;
 }
 result.sort();
 set(config.outputVariable,result.map((timeValue,index)=>(index+1)+'. '+timeValue).join(', '));
 set(config.allowedVariable,result.length?'|'+result.join('|')+'|':'');
 set(config.availableVariable,result.length>0);
 return {handled:true};
}
