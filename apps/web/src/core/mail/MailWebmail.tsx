import React,{useCallback,useMemo,useRef,useState} from 'react';
import {
 AlertCircle,ChevronLeft,FilePenLine,Folder,Forward,Inbox,LogOut,Mail,
 Menu,Paperclip,Plus,RefreshCw,Search,Send,Settings,X,CornerUpLeft
} from 'lucide-react';
import {apiBase} from '../authentication/Client/authClient';
import './MailWebmail.css';

type FolderItem={id:string;name:string};
type Message={id:string;from:string;to:string;subject:string;date:string;seen:boolean};
type Attachment={name:string;type:string;data:string};
type FullMessage=Message&{body:string;attachments:Attachment[]};

const maxAttachmentBytes=20*1024*1024;
function b64(value:string){
 const encoded=new TextEncoder().encode(value);
 let raw='';
 for(let i=0;i<encoded.length;i++)raw+=String.fromCharCode(encoded[i]);
 return btoa(raw);
}
async function encodeFile(file:File):Promise<Attachment>{
 if(file.size>maxAttachmentBytes)throw new Error('Attachment exceeds 20 MB');
 const bytes=new Uint8Array(await file.arrayBuffer());
 let text='';
 for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return {name:file.name,type:file.type||'application/octet-stream',data:btoa(text)};
}
// Tolerate the previous server parser's malformed /" INBOX response during
// a rolling backend/frontend deployment. Do not alter normal nested paths.
function normalizeLegacyFolder(value:string){
 const legacy=/^\/"\s+(.+)$/.exec(value);
 return legacy?legacy[1]:value;
}
function folderKind(name:string){
 const value=name.toLowerCase().split(/[/.]/).pop()??'';
 if(value==='inbox')return 'inbox';
 if(value==='sent'||value==='sent items'||value==='sent messages'||value==='sent mail')return 'sent';
 if(value==='drafts')return 'drafts';
 return 'folder';
}
function folderTitle(name:string){
 const value=name.split(/[/.]/).pop()||name;
 const kind=folderKind(value);
 return kind==='inbox'?'Inbox':kind==='sent'?'Sent':kind==='drafts'?'Drafts':value;
}
function senderName(value:string){
 const name=value.split('<')[0].trim().replace(/^"|"$/g,'');
 return name||value.trim()||'Unknown sender';
}
function dateLabel(value:string){
 const parsed=new Date(value);
 if(Number.isNaN(parsed.getTime()))return value;
 const today=new Date();
 return parsed.toDateString()===today.toDateString()
  ?parsed.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})
  :parsed.toLocaleDateString(undefined,{month:'short',day:'numeric',year:parsed.getFullYear()===today.getFullYear()?undefined:'numeric'});
}
function messageDateGroup(value:string):string {
 const parsed=new Date(value);
 if(Number.isNaN(parsed.getTime()))return 'Unknown date';
 const today=new Date();const midnight=new Date(today.getFullYear(),today.getMonth(),today.getDate());
 const yesterday=new Date(midnight);yesterday.setDate(yesterday.getDate()-1);
 if(parsed>=midnight)return 'Today';
 if(parsed>=yesterday)return 'Yesterday';
 return parsed.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short',year:'numeric'});
}
function iconForFolder(name:string){
 const kind=folderKind(name);
 return kind==='inbox'?<Inbox size={18}/>:kind==='sent'?<Send size={18}/>:kind==='drafts'?<FilePenLine size={18}/>:<Folder size={18}/>;
}

export default function MailWebmail(){
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [passwordVisible,setPasswordVisible]=useState(false);
 const [loggedIn,setLoggedIn]=useState(false);
 const [adminToken,setAdminToken]=useState('');
 const [adminLoading,setAdminLoading]=useState(()=>typeof window!=='undefined'&&window.location.hash.startsWith('#admin='));
 const [folders,setFolders]=useState<FolderItem[]>([]);
 const [folder,setFolder]=useState('INBOX');
 const [messages,setMessages]=useState<Message[]>([]);
 const [selected,setSelected]=useState<FullMessage|null>(null);
 const [composing,setComposing]=useState(false);
 const [to,setTo]=useState('');
 const [subject,setSubject]=useState('');
 const [body,setBody]=useState('');
 const [files,setFiles]=useState<File[]>([]);
 const [search,setSearch]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [sidebarOpen,setSidebarOpen]=useState(()=>typeof window==='undefined'||window.innerWidth>820);
 const requestId=useRef(0);
 const endpoint=useMemo(()=>new URL('mail-client/',new URL(apiBase.replace(/\/$/,'')+'/',window.location.origin)).href,[]);
 const invoke=useCallback(async(data:Record<string,unknown>)=>{
  const response=await fetch(endpoint,{
   method:'POST',
   headers:{'Content-Type':'application/json',Authorization:adminToken?'Bearer '+adminToken:'Basic '+b64(email.trim()+':'+password)},
   body:JSON.stringify(data),redirect:'error'
  });
  const value=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'Mail request failed ('+response.status+')');
  return value;
 },[email,password,endpoint,adminToken]);

 const load=useCallback(async(name:string)=>{
  const id=++requestId.current;
  setBusy(true);setError('');setNotice('');
  try{
   const data=await invoke({action:'messages',folder:name});
   if(id!==requestId.current)return;
   setMessages(Array.isArray(data.messages)?data.messages as Message[]:[]);
   setFolder(name);setSelected(null);
  }catch(e){
   if(id===requestId.current)setError(e instanceof Error?e.message:'Unable to load messages');
  }finally{
   if(id===requestId.current)setBusy(false);
  }
 },[invoke]);


 // The fragment ticket is single-use and cleared before contacting the API.
 React.useEffect(()=>{
  const match=/^#admin=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
  if(!match){
   if(window.location.hash.startsWith('#admin=')){window.history.replaceState(null,'',window.location.pathname+window.location.search);setAdminLoading(false);setError('Invalid admin mailbox link');}
   return;
  }
  window.history.replaceState(null,'',window.location.pathname+window.location.search);
  let cancelled=false;
  void (async()=>{
   try{
    const response=await fetch(endpoint+'admin/redeem',{method:'POST',redirect:'error',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:match[1]})});
    const value=await response.json() as {token?:string;email?:string;error?:string};
    if(!response.ok||!value.token||!value.email)throw new Error(value.error||'Unable to start admin session');
    if(cancelled)return;
    setEmail(value.email);setAdminToken(value.token);
   }catch(e){
    if(!cancelled){setError(e instanceof Error?e.message:'Admin session failed');setAdminLoading(false);}
   }
  })();
  return()=>{cancelled=true;};
 },[endpoint]);
 React.useEffect(()=>{
  if(!adminToken)return;
  let cancelled=false;
  void (async()=>{
   try{
    const data=await invoke({action:'folders'});
    if(cancelled)return;
    const list=(Array.isArray(data.folders)?data.folders as FolderItem[]:[])
     .map(item=>({id:normalizeLegacyFolder(item.id),name:normalizeLegacyFolder(item.name)}));
    const available=list.length?list:[{id:'INBOX',name:'Inbox'}];
    setFolders(available);setLoggedIn(true);
    await load(available.find(x=>folderKind(x.name)==='inbox')?.id??available[0].id);
   }catch(e){
    if(!cancelled){setAdminToken('');setError(e instanceof Error?e.message:'Admin access failed');}
   }finally{if(!cancelled)setAdminLoading(false);}
  })();
  return()=>{cancelled=true;};
 },[adminToken,invoke,load]);

 const signIn=async(e:React.FormEvent)=>{
  e.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   await invoke({action:'login'});
   const data=await invoke({action:'folders'});
   const list=(Array.isArray(data.folders)?data.folders as FolderItem[]:[])
    .map(item=>({id:normalizeLegacyFolder(item.id),name:normalizeLegacyFolder(item.name)}));
   const available=list.length?list:[{id:'INBOX',name:'Inbox'}];
   setFolders(available);setLoggedIn(true);
   await load(available.find(x=>folderKind(x.name)==='inbox')?.id??available[0].id);
  }catch(e){
   setError(e instanceof Error?e.message:'Unable to sign in');
  }finally{
   setBusy(false);
  }
 };

 const openMessage=async(item:Message)=>{
  const id=++requestId.current;
  setBusy(true);setError('');setNotice('');
  try{
   const data=await invoke({action:'message',folder,uid:item.id});
   if(id!==requestId.current)return;
   setSelected({...item,...data} as FullMessage);
   if(!adminToken&&!item.seen){
    try{
     await invoke({action:'mark_read',folder,uid:item.id});
     if(id===requestId.current)setMessages(current=>current.map(m=>m.id===item.id?{...m,seen:true}:m));
    }catch{
     if(id===requestId.current)setError('Message opened, but could not be marked as read.');
    }
   }
  }catch(e){
   if(id===requestId.current)setError(e instanceof Error?e.message:'Unable to read message');
  }finally{
   if(id===requestId.current)setBusy(false);
  }
 };
 const saveMessage=async(mode:'send'|'draft')=>{
  setBusy(true);setError('');setNotice('');
  try{
   if(files.reduce((n,f)=>n+f.size,0)>maxAttachmentBytes)throw new Error('Attachments exceed 20 MB');
   const attachments=await Promise.all(files.map(encodeFile));
   await invoke({action:mode,to,subject,body,attachments});
   setComposing(false);setFiles([]);setTo('');setSubject('');setBody('');
   await load(folder);
   setNotice(mode==='send'?'Message sent successfully.':'Draft saved.');
  }catch(e){
   setError(e instanceof Error?e.message:'Mail operation failed');
  }finally{
   setBusy(false);
  }
 };
 const signOut=()=>{
  if(adminToken)void fetch(endpoint+'admin/revoke',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+adminToken,'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
  setAdminToken('');setAdminLoading(false);
  ++requestId.current;
  setLoggedIn(false);setEmail('');setPassword('');setSelected(null);
  setMessages([]);setFolders([]);setComposing(false);setTo('');
  setSubject('');setBody('');setFiles([]);setSearch('');
  setError('');setNotice('');setBusy(false);
 };
 const download=(attachment:Attachment)=>{
  const raw=atob(attachment.data),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  const url=URL.createObjectURL(new Blob([bytes],{type:attachment.type}));
  const link=document.createElement('a');
  link.href=url;link.download=attachment.name.replace(/[\\/]/g,'_');
  document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const chooseFolder=(id:string)=>{
  if(busy)return;
  setSearch('');void load(id);
  if(window.matchMedia('(max-width: 820px)').matches)setSidebarOpen(false);
 };
 const startReply=(mode:'reply'|'forward')=>{
  if(!selected)return;
  setTo(mode==='reply'?(selected.from.match(/<([^>]+)>/)?.[1]??selected.from):'');
  setSubject((mode==='reply'?'Re: ':'Fwd: ')+selected.subject.replace(/^(Re:|Fwd:)\s*/i,''));
  setBody('\n\n----- '+(mode==='reply'?'Original message':'Forwarded message')+' -----\n'+selected.body);
  setFiles([]);setComposing(true);
 };
 const filtered=useMemo(()=>messages.filter(m=>
  (m.subject+' '+m.from+' '+m.to).toLowerCase().includes(search.trim().toLowerCase())
 ),[messages,search]);
 const orderedFolders=useMemo(()=>[...folders].sort((a,b)=>{
  const rank=(name:string)=>({inbox:0,sent:1,drafts:2,folder:3})[folderKind(name)];
  return rank(a.name)-rank(b.name)||a.name.localeCompare(b.name);
 }),[folders]);
 const currentName=folderTitle(folders.find(f=>f.id===folder)?.name??folder);
 const unread=messages.filter(m=>!m.seen).length;

 if(adminLoading)return <main className="md-mail md-mail-login"><div className="md-mail-login-card" role="status">Opening administrator mailbox…</div></main>;
 if(!loggedIn)return <main className="md-mail md-mail-login">
  <form className="md-mail-login-card" onSubmit={signIn}>
   <div className="md-mail-login-icon"><Mail size={30}/></div>
   <p className="md-mail-kicker">UNE SOLUTIONS</p>
   <h1>MetaDrive Mail</h1>
   <p className="md-mail-muted">Sign in with your mailbox credentials</p>
   {error&&<p className="md-mail-error" role="alert"><AlertCircle size={16}/>{error}</p>}
   <label className="md-mail-field">Email address
    <input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/>
   </label>
   <label className="md-mail-field">Password
    <input id="mail-login-password" type={passwordVisible?'text':'password'} required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/>
   </label>
   <div className="md-mail-login-help">
    <button type="button" className="md-mail-password-toggle" aria-controls="mail-login-password"
     onClick={()=>setPasswordVisible(value=>!value)}>{passwordVisible?'Hide password':'Show password'}</button>
    <span>Forgot your password? Contact your administrator to reset it.</span>
   </div>
   <button className="md-mail-primary md-mail-login-submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
   <a className="md-mail-login-admin" href="/mail-admin">Mail administration</a>
  </form>
 </main>;

 return <main className="md-mail">
  <header className="md-mail-header">
   <div className="md-mail-brand">
    <button type="button" className="md-mail-icon-button" aria-label={sidebarOpen?'Hide folders':'Show folders'} aria-expanded={sidebarOpen} onClick={()=>setSidebarOpen(open=>!open)}><Menu size={22}/></button>
    <Mail className="md-mail-brand-mark" size={26}/>
    <span>MetaDrive <strong>Mail</strong></span>
   </div>
   <div className="md-mail-search">
    <Search size={20} aria-hidden="true"/>
    <input type="search" aria-label="Search messages in this folder" placeholder={'Search in '+currentName} title="Filters the most recent 50 messages in this folder" value={search} onChange={e=>{setSearch(e.target.value);setSelected(null);}}/>
    {search&&<button type="button" className="md-mail-icon-button" aria-label="Clear search" onClick={()=>setSearch('')}><X size={17}/></button>}
   </div>
   <div className="md-mail-header-actions">
    <button type="button" className="md-mail-icon-button" title="Refresh messages" aria-label="Refresh messages" disabled={busy} onClick={()=>void load(folder)}><RefreshCw size={20}/></button>
    <a className="md-mail-icon-button" href="/mail-admin" title="Mail administration" aria-label="Mail administration"><Settings size={20}/></a>
    <span className="md-mail-account" title={email}>{email}</span>
    <button type="button" className="md-mail-icon-button" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={20}/></button>
   </div>
  </header>

  {adminToken&&<div role="status" style={{background:'#fff5d8',color:'#5f4106',padding:'10px 20px',fontWeight:650,borderBottom:'1px solid #e6c980'}}>Admin read-only access · {email} · expires after 15 minutes. Sending, composing and changing message status are disabled.</div>}
  {sidebarOpen&&<button type="button" className="md-mail-overlay" aria-label="Close folders" onClick={()=>setSidebarOpen(false)}/>}
  <div className={'md-mail-layout'+(sidebarOpen?'':' is-compact')}>
   <aside className={'md-mail-sidebar'+(sidebarOpen?' is-visible':'')} aria-label="Mail folders">
    {!adminToken&&<button type="button" className="md-mail-compose-button" onClick={()=>{setComposing(true);setError('');}}><Plus size={24}/>Compose</button>}
    <p className="md-mail-sidebar-caption">Folders</p>
    <nav aria-label="Mailbox folders">
     {orderedFolders.map(f=><button key={f.id} type="button" className={'md-mail-folder'+(f.id===folder?' is-active':'')} aria-current={f.id===folder?'page':undefined} disabled={busy} onClick={()=>chooseFolder(f.id)}>
      {iconForFolder(f.name)}<span>{folderTitle(f.name)}</span>
      {f.id===folder&&unread>0&&<b aria-label={unread+' unread'}>{unread}</b>}
     </button>)}
    </nav>
   </aside>

   <section className="md-mail-main" aria-label="Mail messages" aria-busy={busy}>
    <div className="md-mail-list-toolbar">
     <div className="md-mail-list-heading">
      {selected&&<button type="button" className="md-mail-icon-button" aria-label="Back to messages" onClick={()=>setSelected(null)}><ChevronLeft size={22}/></button>}
      <h1>{selected?'Message':currentName}</h1>
      {!selected&&unread>0&&<span className="md-mail-unread-label">{unread} unread</span>}
     </div>
     {!selected&&<span className="md-mail-count">{error?'Unable to load':filtered.length+' '+(filtered.length===1?'message':'messages')}</span>}
    </div>
    {error&&<p className="md-mail-error md-mail-feedback" role="alert"><AlertCircle size={18}/>{error}<button type="button" aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></p>}
    {notice&&<p className="md-mail-notice md-mail-feedback" role="status">{notice}<button type="button" aria-label="Dismiss notice" onClick={()=>setNotice('')}><X size={16}/></button></p>}
    {busy&&<div className="md-mail-progress" role="status">Loading…</div>}

    {selected?<article className="md-mail-reading">
     <h2>{selected.subject||'(no subject)'}</h2>
     {!adminToken&&<div className="md-mail-reading-actions">
      <button type="button" className="md-mail-secondary" onClick={()=>startReply('reply')}><CornerUpLeft size={17}/>Reply</button>
      <button type="button" className="md-mail-secondary" onClick={()=>startReply('forward')}><Forward size={17}/>Forward</button>
     </div>}
     <div className="md-mail-message-meta">
      <span className="md-mail-avatar">{senderName(selected.from).slice(0,1).toUpperCase()}</span>
      <div><strong>{senderName(selected.from)}</strong><span>From: {selected.from}</span><span>To: {selected.to}</span></div>
      <time>{dateLabel(selected.date)}</time>
     </div>
     <div className="md-mail-reading-body">{selected.body||'No plain-text body available.'}</div>
     {selected.attachments?.length>0&&<div className="md-mail-attachments">
      <h3>Attachments ({selected.attachments.length})</h3>
      {selected.attachments.map((a,i)=><button type="button" className="md-mail-attachment" key={a.name+i} onClick={()=>download(a)}><Paperclip size={16}/>{a.name}</button>)}
     </div>}
    </article>:
    filtered.length===0&&!busy&&!error?<div className="md-mail-empty">
     <div className="md-mail-empty-icon"><Inbox size={34}/></div>
     <h2>{search?'No matching messages':currentName.toLowerCase()==='trash'?'Trash is empty':'Nothing in '+currentName}</h2>
     <p>{search?'Try another search. Only the 50 most recent messages in this folder are loaded.':currentName.toLowerCase()==='trash'?'Deleted messages will appear here.':'New messages will appear here when they arrive.'}</p>
    </div>:
    <div className="md-mail-message-list" role="list">
     {filtered.map((m,index)=><React.Fragment key={m.id}>
      {(index===0||messageDateGroup(filtered[index-1].date)!==messageDateGroup(m.date))&&
       <div className="md-mail-day-separator" role="separator" aria-label={messageDateGroup(m.date)}>{messageDateGroup(m.date)}</div>}
      <button type="button" role="listitem" className={'md-mail-message-row'+(m.seen?'':' is-unread')} onClick={()=>void openMessage(m)} disabled={busy} aria-label={'Open '+(m.subject||'no subject')+' from '+m.from}>
      <span className="md-mail-row-avatar">{senderName(m.from).slice(0,1).toUpperCase()}</span>
      <span className="md-mail-row-sender">{folderKind(currentName)==='sent'?'To: '+senderName(m.to):senderName(m.from)}</span>
      <span className="md-mail-row-content"><strong>{m.subject||'(no subject)'}</strong></span>
      <time className="md-mail-row-date">{dateLabel(m.date)}</time>
     </button></React.Fragment>)}
    </div>}
   </section>
  </div>

  {composing&&!adminToken&&<section className="md-mail-compose-window" role="dialog" aria-label="New message">
   <div className="md-mail-compose-header"><h2>New Message</h2><button type="button" className="md-mail-icon-button" title="Close composer (keep text in this session)" aria-label="Close composer" onClick={()=>setComposing(false)}><X size={19}/></button></div>
   <form className="md-mail-compose-form" onSubmit={e=>{e.preventDefault();void saveMessage('send');}}>
    <label className="md-mail-compose-line"><span>To</span><input type="email" value={to} onChange={e=>setTo(e.target.value)} required autoFocus placeholder="Recipient"/></label>
    <label className="md-mail-compose-line"><span>Subject</span><input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={500} placeholder="Subject"/></label>
    <textarea className="md-mail-compose-body" aria-label="Message body" value={body} onChange={e=>setBody(e.target.value)} required placeholder="Write your message…"/>
    {error&&<p role="alert" className="md-mail-error md-mail-compose-error"><AlertCircle size={16}/>{error}</p>}
    {files.length>0&&<div className="md-mail-compose-files">{files.map((file,i)=><span key={file.name+i}><Paperclip size={13}/>{file.name}<button type="button" aria-label={'Remove '+file.name} onClick={()=>setFiles(current=>current.filter((_,index)=>index!==i))}><X size={14}/></button></span>)}</div>}
    <div className="md-mail-compose-footer">
     <button type="submit" className="md-mail-primary" disabled={busy}><Send size={16}/>{busy?'Sending…':'Send'}</button>
     <label className="md-mail-attach-button" title="Attach files"><Paperclip size={19}/><span>Attach</span><input type="file" multiple aria-label="Attach files" onChange={e=>{setFiles(current=>[...current,...Array.from(e.target.files??[])]);e.target.value='';}}/></label>
     <button type="button" className="md-mail-draft-button" disabled={busy} onClick={()=>void saveMessage('draft')}>Save draft</button>
     <button type="button" className="md-mail-icon-button md-mail-discard" title="Discard composition" aria-label="Discard composition" onClick={()=>{setComposing(false);setTo('');setSubject('');setBody('');setFiles([]);}}><X size={19}/></button>
    </div>
   </form>
  </section>}
 </main>;
}
