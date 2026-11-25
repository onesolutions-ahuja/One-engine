import {runComponentFormula} from "../shared/formulaCodeLookup.js";
import {disabledWhen,hiddenByShowWhen} from "../shared/showWhen.js";
import {smartCustomButtonAppearance} from "../smart/shared/SmartCustomButtonAppearance.js";
import {groupTickets,timeOf,sortTickets,formatAge,ageLevel,lineState,lineVisible,estimateHeight,packColumns,columnCountFor}
 from "./ticketBoardModel.js";

/**
 * Smart Ticket Board: records grouped into tickets (cards that grow with their lines), packed into
 * columns oldest first. Generic: any Object with a lookup to group by (order lines by Order,
 * pick lines by Shipment, tasks by Job...). One data source: the line records. Ticket values are
 * formulas on the ticket's first line and may read through the lookup (=@OrderLine.Order.Name).
 *
 * Lines (shared properties): Text Source = line text, Column 2 = qty, Row supporting source = second
 * line (options / notes), Column 3 = line state (Done / Void / Short / Held), Column 4 = small tag.
 * Ticket: Ticket title, Card description (subtitle), Badge text, Ticket time (age timer).
 * Show line when: only matching lines (e.g. one kitchen section); empty tickets are hidden.
 * Card height (fixed, equal cards in a grid) · Lines on card (+N more) · Hide done lines (cards list
 * only what is left; "All done" when nothing is) · Tap lines (off: a tap anywhere selects the ticket)
 * · Selected ticket (formula, e.g. =@ThisPage.sel.Value) is outlined.
 * change = a ticket was tapped (@event.recordId = the ticket key).
 * Events: click = line tapped, longPress = line held, customButton1/2 = ticket buttons
 * (Button 1 is the main action, drawn on the right; Button 2 on its left)
 * (@event.recordId = the ticket key, e.g. the Order Id; @event.recordIds = its line Ids).
 */
const SAMPLE=[
 {key:"s1",title:"Table 10",subtitle:"Dine-in · 4 covers",badge:"#1038",age:18*60000,
  lines:[{id:"a",qty:"2",text:"Classic Cheeseburger",note:"No onion",state:"done",section:"Course 1"},
   {id:"b",qty:"1",text:"Chicken Burger",note:"Allergy: sesame",state:"",section:"Course 1"},{id:"c",qty:"3",text:"Large Fries",state:""}]},
 {key:"s2",title:"Online · Collection",subtitle:"Pickup 19:30",badge:"#1041",age:12*60000,
  lines:[{id:"d",qty:"2",text:"Bacon Double",note:"Medium",state:""},{id:"e",qty:"1",text:"Nuggets",state:"short",tag:"1 of 2"}]},
 {key:"s3",title:"T2",subtitle:"Dine-in",badge:"#1044",age:60000,lines:[{id:"f",qty:"1",text:"Jalapeño Burger",state:""}]}
];
const num=(value,fallback,min,max)=>{
 const n=Number(value);
 return value===""||value==null||!Number.isFinite(n)?fallback:Math.max(min,Math.min(max,n));
};
const shadowOf=value=>value==="large"?"0 8px 20px #0003":value==="medium"?"0 3px 9px #0003":value==="small"?"0 1px 4px #0002":
 value==="none"?"none":undefined;
const textOf=value=>value==null?"":String(value);

export default function SmartComponent(p){
 const rows=Array.isArray(p.records)?p.records:Array.isArray(p.items)?p.items:[];
 const builder=p.builderPreview===true;
 const live=!builder&&!p.previewOnly;
 const read=(key,row)=>textOf(runComponentFormula(p,p[key],row).value);
 const [now,setNow]=React.useState(()=>Date.now());
 const [width,setWidth]=React.useState(0);
 const [pressed,setPressed]=React.useState("");
 const boardRef=React.useRef(null),holdRef=React.useRef(null);
 const timed=Boolean(String(p.ticketTime??"").trim())||builder;
 React.useEffect(()=>{
  if(!timed)return undefined;
  const id=setInterval(()=>setNow(Date.now()),15000);
  return ()=>clearInterval(id);
 },[timed]);
 React.useEffect(()=>{
  const el=boardRef.current;
  if(!el||typeof ResizeObserver==="undefined")return undefined;
  const observer=new ResizeObserver(()=>setWidth(el.clientWidth));
  observer.observe(el);setWidth(el.clientWidth);
  return ()=>{observer.disconnect();clearTimeout(holdRef.current?.timer);};
 },[]);
 if(hiddenByShowWhen(p))return <span data-smart-hidden="true" hidden/>;
 const disabled=Boolean(p.disabled||disabledWhen(p));
 const buttons=["customButton1","customButton2"].filter(key=>p[key+"Visible"]!==false&&
  (builder||Boolean(p.actionFlows?.[key])||String(p[key+"Label"]??"").trim()!==""));

 // Show line when (e.g. this section's lines only): blank shows every line; a ticket with
 // no line left is not shown. Ticket values still read the ticket's first line.
 const lineFilter=String(p.ticketLineVisible??"").trim();
 const shows=row=>!lineFilter||lineVisible(runComponentFormula(p,lineFilter,row).value);
 const tickets=rows.length||!builder?sortTickets(groupTickets(rows,p.ticketGroupField).map(group=>{
  const first=group.rows[0];
  const lines=group.rows.filter(shows).map(row=>({id:String(row.Id??""),row,text:read("textSource",row),qty:read("column2Source",row),
   note:read("rowSupportingSource",row),state:lineState(read("column3Source",row)),tag:read("column4Source",row),
   section:read("ticketSection",row)}));
  return {key:group.key,first,rows:group.rows,lines,title:read("ticketTitle",first)||read("textSource",first),
   subtitle:read("cardDescription",first),badge:p.badgeVisible===false?"":read("badgeText",first),accent:read("ticketAccent",first),
   time:timeOf(runComponentFormula(p,p.ticketTime,first).value),
   labels:Object.fromEntries(buttons.map(key=>[key,read(key+"Label",first)]))};
 }).filter(ticket=>ticket.lines.length>0)):SAMPLE.map(sample=>({...sample,rows:[],first:{},time:now-sample.age,
  lines:sample.lines.map(line=>({...line,state:lineState(line.state),row:{Id:line.id}})),
  labels:Object.fromEntries(buttons.map((key,i)=>[key,String(p[key+"Label"]??"")||(i?"Print":"Complete")]))}));

 const fixedHeight=num(p.ticketCardHeight,0,0,2000);
 const linesOnCard=num(p.ticketLinesOnCard,0,0,50);
 const hideDone=p.ticketHideDone===true||p.ticketHideDone==="true";
 const lineTaps=!(p.ticketLineTaps===false||p.ticketLineTaps==="false");
 const selectedKey=String(p.ticketSelected??"").trim()?read("ticketSelected",rows[0]??{}):"";
 const fire=(event,value)=>{if(live&&!disabled)void Promise.resolve(p.onAction?.({event,value})).catch(()=>{});};
 const lineValue=(ticket,line)=>({record:line.row,recordId:line.id,ticketId:ticket.key,ticket:ticket.first});
 const ticketValue=ticket=>({record:ticket.first,recordId:ticket.key,recordIds:ticket.lines.map(line=>line.id)});
 // Tap = click; hold 550 ms (or right-click) = longPress. Scrolling a long ticket is not a tap.
 const selectTicket=(e,ticket)=>{
  if(e.target.closest&&e.target.closest("button"))return;
  if(lineTaps&&e.target.closest&&e.target.closest(".tb-line"))return;
  fire("change",{record:ticket.first,recordId:ticket.key,recordIds:ticket.lines.map(line=>line.id)});
 };
 const down=(e,ticket,line)=>{
  if(!lineTaps)return;
  if(e.button!==undefined&&e.button!==0)return;
  clearTimeout(holdRef.current?.timer);
  const hold={id:line.id,x:e.clientX,y:e.clientY,held:false};
  hold.timer=setTimeout(()=>{hold.held=true;setPressed("");fire("longPress",lineValue(ticket,line));},550);
  holdRef.current=hold;setPressed(line.id);
 };
 const moveLine=e=>{
  const hold=holdRef.current;
  if(hold&&Math.abs(e.clientX-hold.x)+Math.abs(e.clientY-hold.y)>8){clearTimeout(hold.timer);holdRef.current=null;setPressed("");}
 };
 const up=(ticket,line)=>{
  if(!lineTaps)return;
  const hold=holdRef.current;holdRef.current=null;setPressed("");
  if(!hold||hold.id!==line.id)return;
  clearTimeout(hold.timer);
  if(!hold.held)fire("click",lineValue(ticket,line));
 };

 const gap=num(p.gap,14,0,80);
 const columnWidth=num(p.ticketColumnWidth,280,160,900);
 const maxHeight=num(p.ticketMaxHeight,560,160,4000);
 const newMs=num(p.ticketNewSeconds,60,0,3600)*1000;
 const pad=num(p.cardPadding,12,0,60);
 const columns=packColumns(tickets,columnCountFor(width||columnWidth,columnWidth,gap),
  ticket=>estimateHeight({...ticket,buttons:buttons.length},maxHeight));
 const cardStyle={background:p.backgroundColor||undefined,borderColor:p.borderColor||undefined,
  borderRadius:num(p.radius,16,0,60),boxShadow:shadowOf(p.shadow)};
 const titleStyle={color:p.headerTextColor||undefined,fontSize:p.headerTextSize?num(p.headerTextSize,17,8,96):undefined,
  fontWeight:p.headerBold===false?500:undefined};
 const subStyle={color:p.supportingTextColor||undefined,fontSize:p.supportingTextSize?num(p.supportingTextSize,13,8,96):undefined};
 const lineStyle={color:p.rowLabelColor||undefined,fontSize:p.rowTextSize?num(p.rowTextSize,15,8,96):undefined,
  fontWeight:p.rowBold===false?500:undefined,borderColor:p.rowBorderColor||undefined};
 const noteStyle={color:p.rowSupportingTextColor||undefined,
  fontSize:p.rowSupportingTextSize?num(p.rowSupportingTextSize,13,8,96):undefined};
 const badgeStyle={background:p.badgeBodyColor||undefined,color:p.badgeTextColor||undefined,
  borderRadius:p.badgeRadius!==undefined&&p.badgeRadius!==""?num(p.badgeRadius,999,0,600):undefined,
  fontSize:p.badgeTextSize?num(p.badgeTextSize,13,8,96):undefined};

 const card=ticket=>{
  const age=ticket.time==null?null:Math.max(0,now-ticket.time);
  const level=age==null?"none":ageLevel(age,p.ticketWarnMinutes,p.ticketLateMinutes);
  const fresh=age!=null&&newMs>0&&age<newMs;
  const done=ticket.lines.filter(line=>line.state==="done").length;
  const open=ticket.lines.filter(line=>line.state!=="void").length;
  const left=ticket.lines.filter(line=>line.state!=="done"&&line.state!=="void");
  const listed=hideDone?left:ticket.lines;
  const shown=linesOnCard>0?listed.slice(0,linesOnCard):listed;
  const more=listed.length-shown.length;
  const allDone=hideDone&&left.length===0;
  const selected=selectedKey!==""&&selectedKey===ticket.key;
  let section="";
  return <article key={ticket.key} className={"tb-card age-"+level+(fresh?" is-new":"")+(selected?" is-selected":"")
   +(allDone?" is-all-done":"")+(fixedHeight?" is-fixed":"")} style={{...cardStyle,...(fixedHeight?{height:fixedHeight}:{})}}
   aria-label={ticket.title||"Ticket"} aria-current={selected||undefined} onClick={e=>selectTicket(e,ticket)}>
   <div className="tb-bar" style={ticket.accent&&level==="none"?{background:ticket.accent}:undefined}/>
   <header className="tb-head" style={{padding:pad+"px "+pad+"px "+Math.max(6,pad-4)+"px"}}>
    <div className="tb-title"><strong style={titleStyle}>{ticket.title}</strong>
     {ticket.subtitle&&<small style={subStyle}>{ticket.subtitle}</small>}</div>
    <div className="tb-meta">{ticket.badge&&<span className="tb-badge" style={badgeStyle}>{ticket.badge}</span>}
     {age!=null&&<span className="tb-age">{fresh?"New":formatAge(age)}</span>}</div>
   </header>
   <ul className="tb-lines" style={fixedHeight?undefined:{maxHeight:maxHeight-(buttons.length?118:64)}} role="list">
    {allDone&&<li className="tb-all-done"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>All done</li>}
    {shown.map(line=>{
     const heading=line.section&&line.section!==section?line.section:"";
     if(line.section)section=line.section;
     return <React.Fragment key={line.id||line.text}>
      {heading&&<li className="tb-section" aria-hidden="true">{heading}</li>}
      <li className={"tb-line"+(line.state?" is-"+line.state:"")+(pressed===line.id?" is-pressed":"")}
       style={{...lineStyle,paddingLeft:pad,paddingRight:pad,
        background:pressed===line.id&&p.selectedRowColor?p.selectedRowColor:undefined}}
       role={lineTaps?"button":undefined} tabIndex={lineTaps&&live&&!disabled?0:-1} aria-label={(line.qty?line.qty+" × ":"")+line.text+(line.state?", "+line.state:"")}
       onPointerDown={e=>down(e,ticket,line)} onPointerMove={moveLine} onPointerUp={()=>up(ticket,line)}
       onPointerCancel={()=>{clearTimeout(holdRef.current?.timer);holdRef.current=null;setPressed("");}}
       onContextMenu={e=>{if(!lineTaps)return;e.preventDefault();clearTimeout(holdRef.current?.timer);holdRef.current=null;setPressed("");fire("longPress",lineValue(ticket,line));}}
       onKeyDown={e=>{if(lineTaps&&(e.key==="Enter"||e.key===" ")){e.preventDefault();fire("click",lineValue(ticket,line));}}}>
       {line.qty!==""&&<span className="tb-qty">{line.qty}</span>}
       <span className="tb-text"><span className="tb-name">{line.text}</span>
        {line.note&&<small className="tb-note" style={noteStyle}>{line.note}</small>}
        {(line.tag||line.state==="short"||line.state==="void")&&<em className="tb-tag">
         {line.tag||(line.state==="void"?"Unavailable":"Short")}</em>}</span>
       {line.state==="done"&&<svg className="tb-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>}
      </li>
     </React.Fragment>;
    })}
    {more>0&&<li className="tb-more">+{more} more</li>}
   </ul>
   {(buttons.length>0||open>0)&&<footer className="tb-foot" style={{padding:(pad-2)+"px "+pad+"px "+pad+"px"}}>
    <span className="tb-progress">{hideDone?(allDone?"Ready to complete":left.length+" to make · "+done+" done"):done+" of "+open+" done"}</span>
    {[...buttons].reverse().map(key=>{
     const label=ticket.labels[key];
     if(!label&&!builder)return null;
     return <button type="button" key={key} className={"tb-button tb-"+key} disabled={disabled}
      style={smartCustomButtonAppearance(p,key)} onClick={()=>fire(key,ticketValue(ticket))}>{label||"Button"}</button>;
    })}
   </footer>}
  </article>;
 };
 return <section ref={boardRef} className={"smart-ticket-board"+(fixedHeight?" is-grid":"")} aria-disabled={disabled||undefined}
  style={{fontFamily:p.fontFamily||undefined,gap,
   ...(fixedHeight?{gridTemplateColumns:"repeat(auto-fill,minmax(min(100%,"+columnWidth+"px),1fr))",gridAutoRows:fixedHeight}:{})}}
  data-builder-preview={builder?"true":undefined}>
  {tickets.length===0?<p className="tb-empty">{String(p.emptyText??"")||"No open tickets"}</p>
   :fixedHeight?tickets.map(card)
   :columns.map((column,index)=><div key={index} className="tb-column" style={{gap}}>{column.map(card)}</div>)}
 </section>;
}
