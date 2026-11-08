import React, {createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  completeMfa,loadStoredSession,loadSessionMetadata,deleteStoredSession,normalizeApiBase,
  signInWithPassword,signOutRemote,syncBriefcase,authenticatedRequest,
  type MobileSession
} from './mobileApi';
import {clearCachedRecords,readCachedRecords,replaceCachedRecords,type CachedRecord} from './offlineStore';

export type Connection='checking'|'online'|'offline';
export type PhoneRole='title'|'subtitle'|'badge'|'trailing'|'hidden';
export type PhoneRoleMapping=Record<string,PhoneRole>;
type Context={
  session:MobileSession|null;initializing:boolean;busy:boolean;syncing:boolean;
  connection:Connection;records:CachedRecord[];phoneRoles:Record<string,PhoneRoleMapping>;
  error:string;notice:string;
  signIn:(apiUrl:string,tenantSlug:string,email:string,password:string)=>Promise<string|null>;
  verifyMfa:(apiUrl:string,challenge:string,code:string)=>Promise<void>;
  refresh:()=>Promise<void>;sync:()=>Promise<void>;signOut:()=>Promise<void>;
  clearMessages:()=>void;
};
const MobileContext=createContext<Context|null>(null);
const textError=(e:unknown)=>e instanceof Error?e.message:String(e);
const roleKey=(s:MobileSession)=>'md.mobile.phoneRoles.'+s.identity.tenantId+'.'+s.identity.userId;
const validRole=(role:unknown):role is PhoneRole=>
  typeof role==='string'&&['title','subtitle','badge','trailing','hidden'].includes(role);
function validRoleMap(raw:unknown):PhoneRoleMapping {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  return Object.fromEntries(Object.entries(raw).filter(([name,role])=>
    /^[A-Za-z][A-Za-z0-9_]*$/.test(name)&&validRole(role))) as PhoneRoleMapping;
}
async function cachedRoles(s:MobileSession):Promise<Record<string,PhoneRoleMapping>> {
  const raw=await SecureStore.getItemAsync(roleKey(s));
  if(!raw)return {};
  try {
    const all=JSON.parse(raw) as Record<string,unknown>;
    return Object.fromEntries(Object.entries(all).filter(([name])=>/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
      .map(([name,roles])=>[name,validRoleMap(roles)]));
  }catch{return {};}
}
async function loadPhoneRoles(s:MobileSession,records:CachedRecord[],previous:Record<string,PhoneRoleMapping>){
  const next={...previous};
  // Use the existing permission-protected list-view API; never query tenant-wide metadata.
  for(const objectApi of [...new Set(records.map(x=>x.objectApi))].slice(0,60)){
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi))continue;
    try{
      const answer=await authenticatedRequest<{views:Array<{pinned?:boolean;phoneRoles?:unknown}>}>(s,
        '/records/'+encodeURIComponent(objectApi)+'/list-views');
      const view=answer.views?.find(x=>x.pinned&&Object.keys(validRoleMap(x.phoneRoles)).length)
        ??answer.views?.find(x=>Object.keys(validRoleMap(x.phoneRoles)).length);
      if(view)next[objectApi]=validRoleMap(view.phoneRoles);
    }catch{/* A missing view or permission must never fail the offline data sync. */}
  }
  const serial=JSON.stringify(next);
  if(serial.length<1800)await SecureStore.setItemAsync(roleKey(s),serial);
  return next;
}
export function MobileSessionProvider({children}:{children:React.ReactNode}) {
 const [session,setSession]=useState<MobileSession|null>(null);
 const [initializing,setInitializing]=useState(true);
 const [busy,setBusy]=useState(false);
 const [syncing,setSyncing]=useState(false);
 const [connection,setConnection]=useState<Connection>('checking');
 const [records,setRecords]=useState<CachedRecord[]>([]);
 const [phoneRoles,setPhoneRoles]=useState<Record<string,PhoneRoleMapping>>({});
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const clearMessages=useCallback(()=>{setError('');setNotice('');},[]);
 const loadCache=useCallback(async(s:MobileSession)=>{
  const [rows,roles]=await Promise.all([readCachedRecords(s.identity),cachedRoles(s)]);
  setRecords(rows);setPhoneRoles(roles);
 },[]);
 useEffect(()=>{
  let active=true;
  void (async()=>{try{
   const stored=await loadStoredSession();
   if(!active||!stored)return;
   setSession(stored);
   await loadCache(stored);
   try{await loadSessionMetadata(stored);if(active)setConnection('online');}
   catch(e){if(active){setConnection('offline');setNotice('Offline: '+textError(e));}}
  }catch(e){if(active)setError(textError(e));}
  finally{if(active)setInitializing(false);}
  })();
  return()=>{active=false;};
 },[loadCache]);
 const accept=useCallback(async(s:MobileSession)=>{
  setSession(s);clearMessages();setConnection('online');
  await loadCache(s);
 },[loadCache,clearMessages]);
 const signIn=useCallback(async(apiUrl:string,tenantSlug:string,email:string,password:string)=>{
  setBusy(true);clearMessages();
  try{
   const result=await signInWithPassword({apiUrl,tenantSlug,email,password});
   if(result.challengeToken)return result.challengeToken;
   if(result.session)await accept(result.session);
   return null;
  }catch(e){setError(textError(e));throw e;}
  finally{setBusy(false);}
 },[accept,clearMessages]);
 const verifyMfa=useCallback(async(apiUrl:string,challenge:string,code:string)=>{
  setBusy(true);clearMessages();
  try{await accept(await completeMfa(normalizeApiBase(apiUrl),challenge,code));}
  catch(e){setError(textError(e));throw e;}
  finally{setBusy(false);}
 },[accept,clearMessages]);
 const refresh=useCallback(async()=>{
  if(!session)return;
  clearMessages();
  try{await loadSessionMetadata(session);setConnection('online');setNotice('Connection restored.');}
  catch(e){setConnection('offline');setError(textError(e));}
 },[session,clearMessages]);
 const sync=useCallback(async()=>{
  if(!session||syncing)return;
  setSyncing(true);clearMessages();
  try{
   const result=await syncBriefcase(session);
   const count=await replaceCachedRecords(session.identity,result);
   const rows=await readCachedRecords(session.identity);
   setRecords(rows);setConnection('online');
   try{setPhoneRoles(await loadPhoneRoles(session,rows,phoneRoles));}catch{/* optional layout cache */}
   setNotice('Synced '+count+' read-only records.');
  }catch(e){setConnection('offline');setError('Sync failed; cached data was kept. '+textError(e));}
  finally{setSyncing(false);}
 },[session,syncing,clearMessages,phoneRoles]);
 const signOut=useCallback(async()=>{
  if(!session)return;
  setBusy(true);clearMessages();
  let failure:unknown;
  try{await signOutRemote(session);}catch(e){failure=e;}
  try{await clearCachedRecords(session.identity);}catch(e){failure??=e;}
  try{await SecureStore.deleteItemAsync(roleKey(session));}catch(e){failure??=e;}
  try{await deleteStoredSession();}catch(e){failure??=e;}
  setSession(null);setRecords([]);setPhoneRoles({});setConnection('checking');
  if(failure)setError('Signed out locally, but cleanup was incomplete: '+textError(failure));
  setBusy(false);
 },[session,clearMessages]);
 const value=useMemo(()=>({session,initializing,busy,syncing,connection,records,phoneRoles,error,notice,
  signIn,verifyMfa,refresh,sync,signOut,clearMessages}),[session,initializing,busy,syncing,connection,records,
  phoneRoles,error,notice,signIn,verifyMfa,refresh,sync,signOut,clearMessages]);
 return <MobileContext.Provider value={value}>{children}</MobileContext.Provider>;
}
export function useMobileSession():Context {
 const value=useContext(MobileContext);
 if(!value)throw new Error('MobileSessionProvider is required');
 return value;
}
