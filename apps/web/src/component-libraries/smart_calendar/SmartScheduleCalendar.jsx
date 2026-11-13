const n=(value,fallback,min,max)=>{
 const parsed=Number(value);
 return Number.isFinite(parsed)?Math.max(min,Math.min(max,Math.trunc(parsed))):fallback;
};
const two=value=>String(value).padStart(2,"0");
const iso=date=>[date.getFullYear(),two(date.getMonth()+1),two(date.getDate())].join("-");
const dayDate=(year,month,date)=>new Date(year,month,date,12);
const dateFrom=value=>{
 const source=String(value??"").trim();
 const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(source);
 if(match){
  const d=dayDate(Number(match[1]),Number(match[2])-1,Number(match[3]));
  if(iso(d)===match[0])return d;
 }
 return dayDate(new Date().getFullYear(),new Date().getMonth(),new Date().getDate());
};
const timeLabel=minute=>two(Math.floor(minute/60)%24)+":"+two(minute%60);
const weekdays=["sun","mon","tue","wed","thu","fri","sat"];
const parseEventTime=(source,timeZone)=>{
 const value=String(source??"").trim();
 const dateTime=/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(value);
 if(!dateTime)return null;
 const instant=new Date(value);
 const hasZone=/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(value);
 if(!hasZone){
  const minute=Number(dateTime[2])*60+Number(dateTime[3]);
  if(minute>=1440)return null;
  return {day:dateTime[1],minute,instant:Number.isFinite(instant.getTime())?instant:null};
 }
 if(!Number.isFinite(instant.getTime()))return null;
 try{
  const format=new Intl.DateTimeFormat("en-GB",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",
   hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const part=Object.fromEntries(format.formatToParts(instant).map(piece=>[piece.type,piece.value]));
  return {day:part.year+"-"+part.month+"-"+part.day,
   minute:Number(part.hour)*60+Number(part.minute),instant};
 }catch{return null;}
};
const asDateTime=(record,key,formula,resolve)=>{
 if(typeof formula==="string"&&formula.trim())return resolve(key,formula,record);
 for(const name of key==="calendarStartSource"
  ?["StartAt","StartDateTime","StartTime","startAt","start","startTime","AppointmentStart"]
  :["EndAt","EndDateTime","EndTime","endAt","end","endTime","AppointmentEnd"]){
  if(record[name]!==undefined&&record[name]!==null)return record[name];
 }
 return "";
};

/** Presentation-only calendar. Appointments come from the authorised Page Runtime rows. */
export default function SmartScheduleCalendar({p,fire,records,resolve}){
 const dateSource=p.selectedDate??p.defaultValue;
 const fromSource=typeof dateSource==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(dateSource)
  ?dateSource:resolve("selectedDate",dateSource??"",records?.[0]??{});
 const [selected,setSelected]=React.useState(()=>dateFrom(fromSource));
 React.useEffect(()=>{if(fromSource&&fromSource!=="today")setSelected(dateFrom(fromSource));},[fromSource]);
 const view=["month","week","day"].includes(p.calendarView)?p.calendarView:"month";
 const first=Math.max(0,weekdays.indexOf(String(p.firstDay??"mon").toLowerCase()));
 const allowed=Array.isArray(p.showDays)?p.showDays:weekdays;
 const showDays=new Set(allowed.map(value=>String(value).toLowerCase()));
 const selectedIso=iso(selected);
 const todayIso=iso(new Date());
 const timeZone=String(p.calendarTimeZone??Intl.DateTimeFormat().resolvedOptions().timeZone??"UTC");
 const startHour=n(p.calendarStartHour,8,0,23);
 const endHour=n(p.calendarEndHour,18,startHour+1,24);
 const slotMinutes=[15,30,60].includes(Number(p.calendarSlotMinutes))?Number(p.calendarSlotMinutes):30;
 const totalMinutes=(endHour-startHour)*60;
 const slots=Array.from({length:Math.ceil(totalMinutes/slotMinutes)},(_,i)=>startHour*60+i*slotMinutes);
 const setDate=date=>{
  setSelected(date);
  fire("change",iso(date));
 };
 const step=direction=>{
  const next=new Date(selected);
  if(view==="month")next.setMonth(next.getMonth()+direction);
  else next.setDate(next.getDate()+direction*(view==="week"?7:1));
  setDate(next);
 };
 const events=(Array.isArray(records)?records:[]).slice(0,500).flatMap((record,index)=>{
  if(!record||typeof record!=="object"||Array.isArray(record))return [];
  const start=parseEventTime(asDateTime(record,"calendarStartSource",p.calendarStartSource,resolve),timeZone);
  if(!start)return [];
  const finish=parseEventTime(asDateTime(record,"calendarEndSource",p.calendarEndSource,resolve),timeZone);
  const duration=finish&&start.instant&&finish.instant&&finish.instant>start.instant
    ?Math.round((finish.instant-start.instant)/60000)
    :finish&&finish.day===start.day&&finish.minute>start.minute
      ?finish.minute-start.minute:slotMinutes;
  const title=typeof p.calendarTitleSource==="string"&&p.calendarTitleSource.trim()
    ?resolve("calendarTitleSource",p.calendarTitleSource,record)
    :record.Name??record.Title??record.Subject??record.label??"Appointment";
  const status=typeof p.calendarStatusSource==="string"&&p.calendarStatusSource.trim()
    ?resolve("calendarStatusSource",p.calendarStatusSource,record)
    :record.Status??record.status??"";
  return [{day:start.day,minute:start.minute,duration:Math.max(slotMinutes,Math.min(1440,duration)),
   title:String(title??""),status:String(status??""),record,id:record.Id??record.id??index}];
 });
 const appointmentColor=p.calendarEventColor||"#2563eb";
 const blockedColor=p.calendarBlockedColor||"#64748b";
 const freeColor=p.calendarFreeColor||"#f8fbff";
 const focusedColor=p.defaultValueColor||"#2563eb";
 const appearance={borderRadius:n(p.radius,12,0,100),borderColor:p.borderColor||"#e2e8f0",
  background:p.backgroundColor||"#fff",color:p.labelColor||"#263b56",
  fontSize:n(p.textSize,14,9,36),
  boxShadow:p.calendarShadowColor?"0 4px 10px "+p.calendarShadowColor:
   p.shadow==="large"?"0 8px 20px #0003":p.shadow==="medium"?"0 3px 9px #0003":"none"};
 const headerAppearance={background:p.headerBodyColor||"transparent",
  color:p.headerTextColor||p.labelColor||"#172a45",
  fontSize:n(p.headerTextSize,16,10,40),
  borderColor:p.headerBorderColor||"transparent"};
 const monthStart=dayDate(selected.getFullYear(),selected.getMonth(),1);
 const offset=(monthStart.getDay()-first+7)%7;
 const daysInMonth=new Date(selected.getFullYear(),selected.getMonth()+1,0).getDate();
 const monthWeeks=Math.ceil((offset+daysInMonth)/7);
 const visibleMonthWeekdays=Array.from({length:7},(_,i)=>(first+i)%7)
  .filter(i=>showDays.has(weekdays[i]));
 const weekStart=new Date(selected);
 weekStart.setDate(weekStart.getDate()-(weekStart.getDay()-first+7)%7);
 const week=Array.from({length:7},(_,i)=>dayDate(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+i));
 const shownDays=view==="day"?[selected]:week.filter(day=>showDays.has(weekdays[day.getDay()]));
 const dateStrip=p.calendarShowDateStrip!==false&&view!=="month"
  ?week.filter(day=>showDays.has(weekdays[day.getDay()])):[];
 const currentPeriod=view==="month"
  ?selected.toLocaleString("en-GB",{month:"long",year:"numeric"})
  :view==="day"
   ?selected.toLocaleString("en-GB",{day:"numeric",month:"long",year:"numeric"})
   :week[0].toLocaleString("en-GB",{day:"numeric",month:"short"})+" – "+
    week[6].toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric"});
 return <div className={"smart-calendar smart-calendar-"+view} data-calendar-view={view} style={appearance}>
  {p.calendarShowHeader!==false&&<header className="smart-calendar-header" style={headerAppearance}>
   <button type="button" aria-label="Previous calendar period" onClick={()=>step(-1)}>‹</button>
   <strong data-md-bind={p.builderPreview?"selectedDate":undefined}>{currentPeriod}</strong>
   <button type="button" aria-label="Next calendar period" onClick={()=>step(1)}>›</button>
   <button type="button" className="smart-calendar-today" onClick={()=>setDate(new Date())}>Today</button>
  </header>}
  {dateStrip.length>0&&<nav className="smart-calendar-date-strip" aria-label="Choose calendar date">
   {dateStrip.map(date=><button type="button" key={iso(date)}
     aria-label={"Select "+iso(date)} aria-pressed={iso(date)===selectedIso}
     style={iso(date)===selectedIso?{background:focusedColor,color:"#fff"}:undefined}
     onClick={()=>setDate(date)}>
      <small>{date.toLocaleString("en-GB",{weekday:"short"})}</small>{date.getDate()}
    </button>)}
  </nav>}
  {view==="month"&&visibleMonthWeekdays.length===0?
    <p className="smart-calendar-no-days">No days enabled.</p>:
   view==="month"?<div className="smart-calendar-grid"
    style={{gridTemplateColumns:"repeat("+visibleMonthWeekdays.length+",minmax(0,1fr))"}}>
   {visibleMonthWeekdays.map(i=><b key={weekdays[i]}>{weekdays[i].slice(0,3).toUpperCase()}</b>)}
   {Array.from({length:monthWeeks},(_,weekIndex)=>visibleMonthWeekdays.map(dayIndex=>{
    const relative=(dayIndex-first+7)%7;
    const day=weekIndex*7+relative-offset+1;
    const cell=weekIndex+"-"+dayIndex;
    if(day<1||day>daysInMonth)return <span key={cell} className="smart-calendar-empty"/>;
    const date=dayDate(selected.getFullYear(),selected.getMonth(),day),key=iso(date);
    const count=events.filter(item=>item.day===key).length;
    const chosen=key===selectedIso;
    const isToday=key===todayIso;
    return <button type="button" key={cell} className={[chosen?"smart-calendar-selected-day":"",
      isToday?"smart-calendar-is-today":""].filter(Boolean).join(" ")||undefined}
     aria-current={isToday?"date":undefined}
     aria-label={"Select "+key+(count?" · "+count+" appointments":"")} aria-pressed={chosen}
     style={chosen?{background:focusedColor,color:"#fff",borderColor:focusedColor}:undefined}
     onClick={()=>setDate(date)}>
      <span>{day}</span>
      {p.calendarShowEvents!==false&&count>0&&<small className="smart-calendar-count">{count}</small>}
     </button>;
   }))}
  </div>:shownDays.length===0?<p className="smart-calendar-no-days">No days enabled.</p>:
  <div className="smart-calendar-schedule-scroll">
   <div className="smart-calendar-schedule"
     style={{gridTemplateColumns:"56px repeat("+shownDays.length+",minmax("+
      (view==="week"?"94px":"180px")+",1fr))"}}>
    <div className="smart-calendar-times">
     <div className="smart-calendar-day-heading">Time</div>
     {slots.map(minute=><div key={minute} className="smart-calendar-time-label">{timeLabel(minute)}</div>)}
    </div>
    {shownDays.map(day=>{
     const key=iso(day),dayEvents=events.filter(event=>event.day===key);
     return <div className="smart-calendar-day-column" key={key}>
      <div className="smart-calendar-day-heading">{day.toLocaleString("en-GB",{weekday:"short",day:"numeric"})}</div>
      <div className="smart-calendar-day-slots" style={{height:slots.length*34}}>
       {slots.map((minute,index)=>{
        const occupied=dayEvents.some(event=>
         event.minute<minute+slotMinutes&&event.minute+event.duration>minute);
        return <button type="button" key={minute} className="smart-calendar-slot"
         style={{top:index*34,height:34,background:freeColor}} disabled={occupied}
         aria-label={(occupied?"Booked":"Unbooked")+" "+key+" "+timeLabel(minute)}
         onClick={()=>{setDate(day);fire("click",{kind:"slot",date:key,time:timeLabel(minute),
          start:key+"T"+timeLabel(minute),minutes:slotMinutes});}}/>;
       })}
       {p.calendarShowEvents!==false&&dayEvents.map((event,index)=>{
        const begin=Math.max(startHour*60,event.minute);
        const finish=Math.min(endHour*60,event.minute+event.duration);
        if(finish<=begin)return null;
        const blocked=/^(blocked|break|closed|unavailable)$/i.test(event.status);
        return <button type="button" className="smart-calendar-event" key={event.id+"-"+index}
         style={{top:(begin-startHour*60)/slotMinutes*34+2,
          height:Math.max(28,(finish-begin)/slotMinutes*34-4),
          background:blocked?blockedColor:appointmentColor}}
         aria-label={timeLabel(event.minute)+" "+event.title}
         onClick={()=>fire("click",{kind:"appointment",record:event.record,recordId:event.id,
          date:event.day,time:timeLabel(event.minute)})}>
          <strong>{event.title}</strong>
          <small>{timeLabel(event.minute)}{event.status?" · "+event.status:""}</small>
        </button>;
       })}
      </div>
     </div>;
    })}
   </div>
  </div>}
 </div>;
}
