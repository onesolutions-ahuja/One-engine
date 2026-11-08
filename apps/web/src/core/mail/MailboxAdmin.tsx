import ResponsiveDataList from '../records/ResponsiveDataList/ResponsiveDataList';
import React,{useCallback,useEffect,useState} from 'react';
import {apiRequest} from '../authentication/Client/authClient';
import './MailboxAdmin.css';

type Domain={id:string;name:string;isEnabled:boolean;verificationToken?:string|null};
type Mailbox={id:string;emailAddress:string;name:string;domainId:string;description:string;usedDiskQuota:number;quotas?:Record<string,number>;createdAt:string|null};
type Props={onLogout:()=>void};
const panel:React.CSSProperties={background:'#fff',color:'#172b3f',border:'1px solid #d9e0e7',borderRadius:12,padding:20};
const field:React.CSSProperties={display:'grid',gap:6,marginBottom:14};
const input:React.CSSProperties={width:'100%',boxSizing:'border-box',padding:'10px 12px',border:'1px solid #94a3b8',borderRadius:8,font:'inherit',background:'#fff',color:'#172b3f',colorScheme:'light'};
const button:React.CSSProperties={padding:'9px 13px',border:'1px solid #94a3b8',borderRadius:8,background:'#fff',color:'#172b3f',cursor:'pointer',font:'inherit'};
const primary:React.CSSProperties={...button,background:'#163a5f',borderColor:'#163a5f',color:'#fff'};
const dialogBackdrop:React.CSSProperties={position:'fixed',inset:0,zIndex:1000,display:'grid',placeItems:'center',padding:16,background:'rgba(15,23,42,.58)'};
const dialogPanel:React.CSSProperties={...panel,width:'min(560px,100%)',maxHeight:'calc(100vh - 32px)',overflowY:'auto'};
const fmtBytes=(raw:number)=>{const n=Number(raw)||0;if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(2)+' GB';};

function ActionDialog({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
 const dialog=React.useRef<HTMLElement>(null);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const first=dialog.current?.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])');
  (first??dialog.current)?.focus();
  return()=>previous?.focus();
 },[]);
 const onKeyDown=(event:React.KeyboardEvent<HTMLElement>)=>{
  if(event.key==='Escape'){event.preventDefault();onClose();return;}
  if(event.key!=='Tab')return;
  const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>(
   'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )??[]);
  if(!controls.length){event.preventDefault();return;}
  const first=controls[0],last=controls[controls.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 };
 return <div style={dialogBackdrop} onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
  <section ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
   onKeyDown={onKeyDown} style={dialogPanel}>
   <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:16}}>
    <h2 style={{margin:0,fontSize:20}}>{title}</h2>
    <button type="button" aria-label={'Close '+title} style={button} onClick={onClose}>✕</button>
   </header>
   {children}
  </section>
 </div>;
}

export default function MailboxAdmin({onLogout}:Props){
 const [domains,setDomains]=useState<Domain[]>([]);
 const [newDomain,setNewDomain]=useState('');
 const [mailboxes,setMailboxes]=useState<Mailbox[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [showDomainCreate,setShowDomainCreate]=useState(false);
 const [showCreate,setShowCreate]=useState(false);
 const [name,setName]=useState('');
 const [domainId,setDomainId]=useState('');
 const [password,setPassword]=useState('');
 const [description,setDescription]=useState('');
 const [resetId,setResetId]=useState('');
 const [resetPassword,setResetPassword]=useState('');
 const [editId,setEditId]=useState('');
 const [editDescription,setEditDescription]=useState('');
 const closeCreate=()=>{if(busy)return;setShowCreate(false);setName('');setPassword('');setDescription('');};
 const closeDomainCreate=()=>{if(busy)return;setShowDomainCreate(false);setNewDomain('');};
 
 
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const [d,m]=await Promise.all([
    apiRequest<{domains:Domain[]}>('/mail/domains'),
    apiRequest<{mailboxes:Mailbox[]}>('/mail/mailboxes')
   ]);
   setDomains(d.domains);setMailboxes(m.mailboxes);
   setDomainId(current=>current||d.domains.find(x=>x.isEnabled)?.id||'');
  }catch(e){setError(e instanceof Error?e.message:'Unable to load mailboxes');}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const registerDomain=async(event:React.FormEvent)=>{
  event.preventDefault();setBusy(true);setError('');
  try{
   await apiRequest('/mail/domains',{method:'POST',body:JSON.stringify({domain:newDomain.trim().toLowerCase()})});
   setNewDomain('');setShowDomainCreate(false);setNotice('Mail domain registered. Add the TXT record below.');await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Could not add domain');}
  finally{setBusy(false);}
 };
 const verifyDomain=async(id:string)=>{
  setBusy(true);setError('');
  try{
   await apiRequest('/mail/domains/'+encodeURIComponent(id)+'/verify',{method:'POST'});
   setNotice('Domain ownership verified. Configure MX, SPF, DKIM and DMARC before using it.');await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Verification failed');}
  finally{setBusy(false);}
 };
 const create=async(event:React.FormEvent)=>{
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   await apiRequest('/mail/mailboxes',{method:'POST',body:JSON.stringify({name,domainId,password,description})});
   setName('');setPassword('');setDescription('');setShowCreate(false);setNotice('Mailbox created.');await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Mailbox creation failed');}
  finally{setBusy(false);}
 };
 const saveDescription=async(event:React.FormEvent)=>{
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   await apiRequest('/mail/mailboxes/'+encodeURIComponent(editId),{method:'PATCH',body:JSON.stringify({description:editDescription})});
   setEditId('');setNotice('Mailbox updated.');await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Mailbox update failed');}
  finally{setBusy(false);}
 };
 const reset=async(event:React.FormEvent)=>{
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   await apiRequest('/mail/mailboxes/'+encodeURIComponent(resetId)+'/reset-password',{method:'POST',body:JSON.stringify({password:resetPassword})});
   setResetId('');setResetPassword('');setNotice('Password reset completed.');await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Password reset failed');}
  finally{setBusy(false);}
 };
 const openMailbox=async(mailbox:Mailbox)=>{
  const tab=window.open('about:blank','_blank');
  if(!tab){setError('Allow popups for this site to open the mailbox.');return;}
  tab.opener=null;
  setBusy(true);setError('');setNotice('');
  try{
   const {ticket}=await apiRequest<{ticket:string}>('/mail/mailboxes/'+encodeURIComponent(mailbox.id)+'/open',{method:'POST'});
   if(tab.closed)throw new Error('Mailbox tab was closed');
   tab.location.replace(window.location.origin+'/mail#admin='+encodeURIComponent(ticket));
  }catch(e){
   if(!tab.closed)tab.close();
   setError(e instanceof Error?e.message:'Unable to open mailbox');
  }finally{setBusy(false);}
 };
 const remove=async(mailbox:Mailbox)=>{
  if(!window.confirm('Permanently delete '+mailbox.emailAddress+' and its mailbox data from the tenant mail server? This cannot be undone.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   await apiRequest('/mail/mailboxes/'+encodeURIComponent(mailbox.id),{method:'DELETE'});
   setNotice('Mailbox deleted.');await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Mailbox deletion failed');}
  finally{setBusy(false);}
 };
 return <main className="md-mail-admin" style={{minHeight:'100vh',background:'#f4f7fb',color:'#172b3f',colorScheme:'light',fontFamily:'Inter,system-ui,sans-serif',padding:'28px clamp(16px,4vw,56px)',boxSizing:'border-box'}}>
  <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap',marginBottom:24}}>
   <div><p style={{margin:'0 0 5px',color:'#52677b',fontSize:12,fontWeight:700,letterSpacing:1.2}}>METADRIVE · ADMINISTRATION</p>
    <h1 style={{margin:0,fontSize:30}}>Mailboxes</h1><p style={{margin:'8px 0 0',color:'#52677b'}}>Manage tenant mail accounts, access and mailbox settings.</p></div>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={button} onClick={()=>window.location.assign('/une/setup/home')}>Back to workspace</button><button style={button} onClick={onLogout}>Sign out</button></div>
  </header>
  {error&&<div role="alert" style={{...panel,borderColor:'#d97777',color:'#9b1c1c',marginBottom:16}}>{error}</div>}
  {notice&&<div role="status" style={{...panel,borderColor:'#7cb99a',marginBottom:16}}>{notice}</div>}
  <section style={{...panel,marginBottom:18}}>
   <h2 style={{fontSize:18,marginTop:0}}>Tenant mail domains</h2>
   <p style={{color:'#52677b'}}>Verify each domain with a DNS TXT record before creating mailboxes. Ownership verification does not configure MX or email authentication records.</p>
   {domains.map(domain=><div key={domain.id} style={{padding:'12px 0',borderBottom:'1px solid #e4e9ef'}}>
    <strong>{domain.name}</strong> · {domain.isEnabled?'Verified':'Pending verification'}
    {!domain.isEnabled&&domain.verificationToken&&<div style={{paddingTop:8}}>
     <p>TXT record name: <code>{'_metadrive-mail.'+domain.name}</code></p>
     <p>TXT record value: <code>{'metadrive='+domain.verificationToken}</code></p>
     <button type="button" style={button} disabled={busy} onClick={()=>void verifyDomain(domain.id)}>Verify domain</button>
    </div>}
   </div>)}
   <button type="button" style={button} disabled={busy} onClick={()=>setShowDomainCreate(true)}>＋ Add domain</button>
  </section>
  <section style={{...panel,marginBottom:18}}>
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
    <div><h2 style={{margin:'0 0 4px',fontSize:18}}>Mailbox accounts</h2><p style={{margin:0,color:'#52677b',fontSize:14}}>Only mailboxes assigned to your signed-in MetaDrive tenant are listed.</p></div>
    <div style={{display:'flex',gap:8}}><button style={button} onClick={()=>void refresh()} disabled={loading||busy}>Refresh</button><button style={primary} onClick={()=>setShowCreate(v=>!v)} disabled={busy||!domains.some(d=>d.isEnabled)}>＋ Create mailbox</button></div>
   </div>
   {!domains.some(domain=>domain.isEnabled)&&<p style={{margin:'12px 0 0',color:'#52677b'}}>Verify a mail domain before creating a mailbox.</p>}
   {showCreate&&<ActionDialog title="Create mailbox" onClose={()=>{if(!busy)setShowCreate(false);}}>
    <form onSubmit={create}>
     <div style={field}><label htmlFor="mail-name">Mailbox name</label><input id="mail-name" name="mailbox-local-part" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. accounts" title="Enter only the mailbox name, without @domain" style={input} pattern="[A-Za-z0-9](?:[A-Za-z0-9._+\-]{0,62}[A-Za-z0-9])?" /></div>
     <div style={field}><label htmlFor="mail-domain">Domain</label><select id="mail-domain" required value={domainId} onChange={e=>setDomainId(e.target.value)} style={input}>{domains.filter(d=>d.isEnabled).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
     <div style={field}><label htmlFor="mail-password">Initial password (minimum 12 characters)</label><input id="mail-password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)} style={input}/></div>
     <div style={field}><label htmlFor="mail-description">Description (optional)</label><input id="mail-description" value={description} maxLength={500} onChange={e=>setDescription(e.target.value)} style={input}/></div>
     <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={primary} disabled={busy}>{busy?'Creating…':'Create mailbox'}</button><button type="button" style={button} disabled={busy} onClick={closeCreate}>Cancel</button></div>
    </form>
   </ActionDialog>}
  </section>
  {resetId&&<ActionDialog title="Reset mailbox password" onClose={()=>{if(!busy){setResetId('');setResetPassword('');}}}>
   <form onSubmit={reset}>
    <p style={{color:'#52677b'}}>Use a new password of at least 12 characters. The tenant mail server may reject this operation if the account has additional credentials that cannot safely be preserved.</p>
    <div style={field}><label htmlFor="reset-password">New password</label><input id="reset-password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={resetPassword} onChange={e=>setResetPassword(e.target.value)} style={input}/></div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={primary} disabled={busy}>{busy?'Saving…':'Reset password'}</button><button type="button" style={button} disabled={busy} onClick={()=>{setResetId('');setResetPassword('');}}>Cancel</button></div>
   </form>
  </ActionDialog>}
  {editId&&<ActionDialog title="Edit mailbox description" onClose={()=>{if(!busy)setEditId('');}}>
   <form onSubmit={saveDescription}>
    <div style={field}><label htmlFor="edit-description">Description</label><input id="edit-description" value={editDescription} maxLength={500} onChange={e=>setEditDescription(e.target.value)} style={input}/></div>
    <p style={{fontSize:12,color:'#617589'}}>Quota changes require separate mail server administration.</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={primary} disabled={busy}>{busy?'Saving…':'Save changes'}</button><button type="button" style={button} disabled={busy} onClick={()=>setEditId('')}>Cancel</button></div>
   </form>
  </ActionDialog>}
  {showDomainCreate&&<ActionDialog title="Add mail domain" onClose={closeDomainCreate}>
   <form onSubmit={registerDomain}>
    <div style={field}><label htmlFor="new-mail-domain">Domain</label><input id="new-mail-domain" autoComplete="off" autoCapitalize="none" spellCheck={false} style={input} required value={newDomain} onChange={e=>setNewDomain(e.target.value)} placeholder="example.com"/></div>
    <p style={{color:'#52677b'}}>You’ll need to add the verification TXT record before creating mailboxes.</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={primary} disabled={busy}>{busy?'Adding…':'Add domain'}</button><button type="button" style={button} disabled={busy} onClick={closeDomainCreate}>Cancel</button></div>
   </form>
  </ActionDialog>}
  <section style={panel}>
   {loading?<p role="status">Loading mailboxes…</p>:mailboxes.length===0?<div style={{padding:'24px 8px',textAlign:'center'}}><h3 style={{margin:'0 0 8px'}}>No mailboxes yet</h3><p style={{margin:0,color:'#52677b'}}>Create a mailbox to get started, once a domain is configured for this integration.</p></div>:
   <><ResponsiveDataList rows={mailboxes} includeTablet getId={m=>m.id} label="Mailboxes"
     columns={[
       {apiName:'email',label:'Email address',phoneRole:'title',render:m=>m.emailAddress||m.name},
       {apiName:'description',label:'Description',phoneRole:'subtitle',render:m=>m.description||'—'},
       {apiName:'used',label:'Storage used',phoneRole:'badge',render:m=>fmtBytes(m.usedDiskQuota)},
       {apiName:'created',label:'Created',phoneRole:'trailing',render:m=>m.createdAt?new Date(m.createdAt).toLocaleDateString():'—'},
       {apiName:'actions',label:'Actions',render:m=><div className="md-mail-admin-row-actions">
        <button type="button" style={{...primary,minHeight:32}} disabled={busy} onClick={()=>void openMailbox(m)}>Open</button>
        <details className="md-mail-admin-actions-menu">
          <summary aria-label={'More actions for '+(m.emailAddress||m.name)}>More actions</summary>
          <div className="md-mail-admin-actions-list">
            <button type="button" disabled={busy} onClick={()=>{setEditId(m.id);setEditDescription(m.description);setResetId('');}}>Edit</button>
            <button type="button" disabled={busy} onClick={()=>{setResetId(m.id);setResetPassword('');setEditId('');}}>Reset password</button>
            <button type="button" className="danger" disabled={busy} onClick={()=>void remove(m)}>Delete</button>
          </div>
        </details>
       </div>}
     ]}/>
   <div className="md-mobile-table-replaced md-tablet-table-replaced md-mail-admin-table-wrap" style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',textAlign:'left',tableLayout:'fixed'}}>
    <thead><tr>{['Email address','Description','Storage used','Created','Actions'].map(x=><th key={x} style={{padding:'12px 10px',borderBottom:'1px solid #dce3ea',color:'#52677b',fontSize:12,textTransform:'uppercase',letterSpacing:.5}}>{x}</th>)}</tr></thead>
    <tbody>{mailboxes.map(m=><tr key={m.id}>
     <td style={{padding:'14px 10px',borderBottom:'1px solid #edf1f5',fontWeight:650}}>{m.emailAddress||m.name}</td>
     <td style={{padding:'14px 10px',borderBottom:'1px solid #edf1f5',color:'#52677b'}}>{m.description||'—'}</td>
     <td style={{padding:'14px 10px',borderBottom:'1px solid #edf1f5'}}>{fmtBytes(m.usedDiskQuota)}</td>
     <td style={{padding:'14px 10px',borderBottom:'1px solid #edf1f5',color:'#52677b'}}>{m.createdAt?new Date(m.createdAt).toLocaleDateString():'—'}</td>
     <td style={{padding:'14px 10px',borderBottom:'1px solid #edf1f5'}}><div className="md-mail-admin-row-actions">
        <button type="button" style={{...primary,minHeight:32}} disabled={busy} onClick={()=>void openMailbox(m)}>Open</button>
        <details className="md-mail-admin-actions-menu">
          <summary aria-label={'More actions for '+(m.emailAddress||m.name)}>More actions</summary>
          <div className="md-mail-admin-actions-list">
            <button type="button" disabled={busy} onClick={()=>{setEditId(m.id);setEditDescription(m.description);setResetId('');}}>Edit</button>
            <button type="button" disabled={busy} onClick={()=>{setResetId(m.id);setResetPassword('');setEditId('');}}>Reset password</button>
            <button type="button" className="danger" disabled={busy} onClick={()=>void remove(m)}>Delete</button>
          </div>
        </details>
       </div></td>
    </tr>)}</tbody>
   </table></div></>}
  </section>
  <p style={{fontSize:12,color:'#617589',marginTop:16}}>Mail server credentials are kept server-side. This screen never receives the private mail administration API key.</p>
 </main>;
}
