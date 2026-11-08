import './NotificationBellMobile.css';
import * as React from 'react';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import {Bell} from 'lucide-react';

type Notification={id:string;title:string;body:string;createdAt:string;readAt:string|null};
/** Existing tenant-scoped notification inbox, created by authorised metadata Flows. */
export default function NotificationBell(){
 const [items,setItems]=useState<Notification[]>([]);
 const [unread,setUnread]=useState(0);
 const [open,setOpen]=useState(false);
 const [error,setError]=useState('');
 const [latest,setLatest]=useState<Notification|null>(null);
 const seen=useRef<Set<string>|null>(null);
 const swipe=useRef<{id:string;x:number;y:number}|null>(null);
 const panelRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{
   if(event.target instanceof Node&&!panelRef.current?.contains(event.target))setOpen(false);
  };
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape);};
 },[open]);
 useEffect(()=>{
  let live=true;
  const load=async()=>{
   try{
    const result=await apiRequest<{notifications:Notification[];unreadCount:number}>('/notifications');
    if(!live)return;
    const next=(result.notifications??[]).filter(x=>x&&typeof x.id==='string');
    if(seen.current){
     const fresh=next.find(n=>!n.readAt&&!seen.current?.has(n.id));
     if(fresh)setLatest(fresh);
    }
    seen.current=new Set(next.map(n=>n.id));
    setItems(next);setUnread(result.unreadCount??0);setError('');
   }catch(e){if(live)setError(e instanceof Error?e.message:'Notifications unavailable');}
  };
  void load();
  const timer=setInterval(()=>void load(),30000);
  return()=>{live=false;clearInterval(timer);};
 },[]);
 const markRead=async(n:Notification)=>{
  try{
   await apiRequest('/notifications/'+encodeURIComponent(n.id)+'/read',{method:'POST'});
   setItems(old=>old.map(item=>item.id===n.id?{...item,readAt:new Date().toISOString()}:item));
   if(!n.readAt)setUnread(x=>Math.max(0,x-1));
   setLatest(x=>x?.id===n.id?null:x);
  }catch(e){setError(e instanceof Error?e.message:'Unable to mark notification read');}
 };
 return <div className="assist-notifications" ref={panelRef}>
  <button type="button" aria-label={'Notifications, '+unread+' unread'} aria-expanded={open}
   onClick={()=>{setOpen(x=>!x);setLatest(null);}} className="assist-bell">
   <Bell size={20} aria-hidden="true"/>{unread>0&&<b>{unread}</b>}
  </button>
  {latest&&!open&&<div className="assist-notice-toast" role="status">
   <strong>{latest.title}</strong><p>{latest.body}</p>
   <button type="button" onClick={()=>void markRead(latest)}>Mark read</button>
   <button type="button" aria-label="Dismiss" onClick={()=>setLatest(null)}>×</button>
  </div>}
  {open&&<section className="assist-notice-panel" aria-label="Notifications" role="dialog" aria-modal="false">
   <header className="assist-notice-header"><h2>Notifications</h2>
     <button type="button" onClick={()=>setOpen(false)} aria-label="Close notifications">Done</button></header>
   {error&&<p role="alert">{error}</p>}
   {!items.length&&<p>No notifications</p>}
   {(['Today','Earlier'] as const).map(section=>{
     const today=new Date().toDateString();
     const subset=items.filter(n=>section==='Today'
       ?new Date(n.createdAt).toDateString()===today:new Date(n.createdAt).toDateString()!==today);
     return subset.length>0?<div key={section} className="assist-notice-group">
      <h3>{section}</h3>
      {subset.map(n=><div className={n.readAt?'assist-note':'assist-note assist-note-unread'} key={n.id}
       onTouchStart={e=>{const t=e.touches[0];if(t)swipe.current={id:n.id,x:t.clientX,y:t.clientY};}}
       onTouchEnd={e=>{const t=e.changedTouches[0],start=swipe.current;swipe.current=null;
         if(!n.readAt&&start?.id===n.id&&t&&start.x-t.clientX>75&&Math.abs(t.clientY-start.y)<40)
           void markRead(n);
       }}>
       <strong>{n.title}</strong><p>{n.body}</p>
       {!n.readAt&&<button type="button" onClick={()=>void markRead(n)}>Mark read</button>}
      </div>)}
     </div>:null;
   })}
  </section>}
 </div>;
}
