// Pure rules for Smart Ticket Board (shared by the component and its tests). No React, no DOM.

/** "@OrderLine.Order", "OrderLine.Order" or "Order" → "Order" (the row's own field). */
export function fieldName(value){
 return String(value??"").trim().replace(/^=/,"").replace(/^@/,"").split(".").pop()??"";
}

/** Rows → tickets: one ticket per value of the group field, in first-seen order.
 * Without a group field every row is its own ticket. */
export function groupTickets(rows,groupField){
 const field=fieldName(groupField);
 const tickets=new Map();
 for(const row of rows??[]){
  if(!row||typeof row!=="object")continue;
  const raw=field?row[field]:row.Id;
  const key=String(raw??"");
  if(!key)continue;
  let ticket=tickets.get(key);
  if(!ticket){ticket={key,rows:[]};tickets.set(key,ticket);}
  ticket.rows.push(row);
 }
 return [...tickets.values()];
}

/** Time value (Date, ISO text or epoch ms) → epoch ms, or null. */
export function timeOf(value){
 if(value instanceof Date)return Number.isFinite(value.getTime())?value.getTime():null;
 if(typeof value==="number")return Number.isFinite(value)?value:null;
 if(typeof value==="string"&&value.trim()){const ms=Date.parse(value);return Number.isFinite(ms)?ms:null;}
 return null;
}

/** Oldest first; tickets without a time keep their order, after the timed ones. */
export function sortTickets(tickets){
 return tickets.map((ticket,index)=>({ticket,index})).sort((a,b)=>{
  const ta=a.ticket.time,tb=b.ticket.time;
  if(ta==null&&tb==null)return a.index-b.index;
  if(ta==null)return 1;
  if(tb==null)return -1;
  return ta-tb||a.index-b.index;
 }).map(item=>item.ticket);
}

/** "4:05" under an hour, "1:02:05" over. */
export function formatAge(ms){
 const total=Math.max(0,Math.floor((Number(ms)||0)/1000));
 const h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;
 const two=n=>String(n).padStart(2,"0");
 return h?h+":"+two(m)+":"+two(s):m+":"+two(s);
}

const minutes=(value,fallback)=>{
 const n=Number(value);
 return value===""||value==null||!Number.isFinite(n)||n<0?fallback:n;
};
/** ok → warn → late by minutes since the ticket time (defaults 10 and 15). */
export function ageLevel(ms,warn,late){
 const m=(Number(ms)||0)/60000;
 const lateAt=minutes(late,15),warnAt=Math.min(minutes(warn,10),lateAt);
 return m>=lateAt?"late":m>=warnAt?"warn":"ok";
}

/** Line state text → one of done / void / short / held, or "" (to make). */
export function lineState(value){
 const text=String(value??"").trim().toLowerCase();
 if(["done","ready","served","complete","completed","true"].includes(text))return "done";
 if(["void","cancelled","canceled","86","unavailable","rejected"].includes(text))return "void";
 if(text==="short"||text.startsWith("short"))return "short";
 if(["held","hold","on hold","waiting"].includes(text))return "held";
 return "";
}

/** Height guess (px) used only to pack cards into columns; real height may differ a little. */
export function estimateHeight(ticket,maxHeight){
 const lines=ticket.lines??[];
 const body=lines.reduce((sum,line)=>sum+34+(line.note?18:0)+(line.tag?20:0)+(line.section?24:0),0);
 const cap=Number(maxHeight)>0?Number(maxHeight):Infinity;
 return Math.min(cap,64+body+(ticket.buttons?60:0)+(ticket.subtitle?0:-14));
}

/** Masonry: each ticket goes to the column that is shortest so far (left first on a tie),
 * so the oldest tickets stay at the top left. */
export function packColumns(tickets,columnCount,height){
 const count=Math.max(1,Math.floor(Number(columnCount)||1));
 const columns=Array.from({length:count},()=>({height:0,tickets:[]}));
 for(const ticket of tickets){
  let target=columns[0];
  for(const column of columns)if(column.height<target.height)target=column;
  target.tickets.push(ticket);
  target.height+=height(ticket)+12;
 }
 return columns.map(column=>column.tickets);
}

/** How many columns fit: at least one, each at least `min` px wide. */
export function columnCountFor(width,min,gap){
 const w=Number(width)||0,c=Math.max(120,Number(min)||300),g=Math.max(0,Number(gap)||0);
 return Math.max(1,Math.floor((w+g)/(c+g)));
}

/** "Show line when" result: false, "false", 0, "no" hide the line; anything else shows it. */
export function lineVisible(value){
 if(value===false||value===0)return false;
 const text=String(value??"").trim().toLowerCase();
 return !["false","0","no"].includes(text);
}
