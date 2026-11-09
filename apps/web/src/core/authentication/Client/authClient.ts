import {createRecordPageCoalescer} from './recordPageCoalescer';
import {invalidatePageMediaAssets} from '../../pages/PageRuntime/pageMediaAssetCoalescer';
import {setAuthenticatedFormulaBindingContext} from '../../components/RegisteredComponent/fieldExpressionRuntime';
import {setSqlFormulaRequest} from '../../../component-libraries/shared/SqlFormulaRequest.js';
import {setLocalRecordSetProvider} from '../../../component-libraries/shared/localRecordSets.js';
import {rememberCompleteRecordSet,recordSetGeneration,rowsForFilters,applyRecordSetMutation,heldRowById,
  type SetFilter} from './recordSetStore';
// Same-origin API for deployed builds and development's Vite /api proxy.
export const apiBase = import.meta.env.VITE_API_BASE_URL ?? `${window.location.origin}/api`;
let accessToken: string | undefined;
let refreshInFlight: Promise<string | undefined> | undefined;
export function isAuthErrorMessage(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes('401')
    || text.includes('bearer access token required')
    || text.includes('access token is invalid or expired')
    || text.includes('access token has been revoked')
    || text.includes('refresh token')
    || text.includes('session-expired')
    || text.includes('unable to refresh the login session');
}

export function withAuthRefreshLock(refresh: () => Promise<Response>, signal?: AbortSignal): Promise<Response> {
  if (typeof navigator === 'undefined' || !navigator.locks) return refresh();
  // A request can wait behind another tab's Web Lock before fetch even starts.
  // Applying the abort signal to the lock itself bounds that wait as well.
  return navigator.locks.request('metadrive-auth-refresh', { signal }, refresh).then(async (response) => await response);
}

function refreshAccessToken() {
  if (!refreshInFlight) {
    const startedToken = accessToken;
    refreshInFlight = withAuthRefreshLock(() =>
      fetch(`${apiBase}/auth/refresh`, { method: 'POST', credentials: 'include' })
    )
      .then(async (response) => {
        if (!response.ok) {
          // Only expire the session if our token didn't change while refreshing.
          // Otherwise another tab already refreshed and we hold a stale in-memory token.
          if (accessToken === startedToken) {
            setAccessToken(undefined);
            window.dispatchEvent(new Event('metadrive:session-expired'));
          }
          return undefined;
        }
        const session = await response.json() as { access_token: string };
        accessToken = session.access_token;
        return accessToken;
      })
      .catch((error: unknown) => {
        if (accessToken === startedToken) {
          setAccessToken(undefined);
          window.dispatchEvent(new Event('metadrive:session-expired'));
        }
        throw new Error(`Unable to refresh the login session: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        refreshInFlight = undefined;
      });
  }
  return refreshInFlight;
}

// Share only identical in-flight GETs. This is request coalescing, not a data cache:
// every later navigation still goes through the server's tenant/RBAC checks.
// Include the in-memory access token in the key so requests cannot cross an auth
// transition, and skip custom signals/headers because their semantics are caller-owned.
const inFlightGetRequests = new Map<string, Promise<unknown>>();
// A write or page mutation changes the query generation: a refetch must never
// join a pre-write GET still in flight. This is not a settled record cache.
let recordReadGeneration=0;
export function invalidateRecordReadRequests():void { recordReadGeneration++; }

// Start the authenticated editor draft request before the lazy workspace mounts.
// Consume a prefetch once: later editor visits and device switches always revalidate.
const earlyEditorDrafts=new Map<string,{promise:Promise<unknown>;expiresAt:number}>();
const editorDraftKey=(path:string)=>JSON.stringify([accessToken??null,path]);
export function prefetchPageEditorDraft(apiName:string,variant:string):void {
 if(!accessToken||!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(apiName)||
  !['Desktop','Tablet','Mobile','Custom'].includes(variant))return;
 const path='/metadata/pages/'+encodeURIComponent(apiName)+'/layouts/'+variant+'/editor';
 const key=editorDraftKey(path),previous=earlyEditorDrafts.get(key);
 if(previous&&previous.expiresAt>Date.now())return;
 const promise=apiRequest<unknown>(path);
 earlyEditorDrafts.set(key,{promise,expiresAt:Date.now()+20_000});
 while(earlyEditorDrafts.size>8)earlyEditorDrafts.delete(earlyEditorDrafts.keys().next().value!);
 void promise.catch(()=>{if(earlyEditorDrafts.get(key)?.promise===promise)earlyEditorDrafts.delete(key);});
}
export function takePrefetchedPageEditorDraft<T>(
 path:string,request:<R>(path:string,init?:RequestInit)=>Promise<R>
):Promise<T>{
 const key=editorDraftKey(path),prefetched=earlyEditorDrafts.get(key);
 if(prefetched)earlyEditorDrafts.delete(key);
 if(request===apiRequest&&prefetched&&prefetched.expiresAt>Date.now())
  return prefetched.promise as Promise<T>;
 return request<T>(path);
}

if(typeof window!=='undefined'){
 window.addEventListener('metadrive:page-flow-mutated',invalidateRecordReadRequests);
 // Registered at load, before any component: held record sets are patched from
 // the save before components re-read them.
 window.addEventListener('metadrive:page-flow-mutated',event=>
  applyRecordSetMutation((event as CustomEvent).detail));
}
function invalidateAfterWrite(path:string,init?:RequestInit):void {
 const method=init?.method?.toUpperCase();
 if(!method||!['POST','PUT','PATCH','DELETE'].includes(method))return;
 if(path.startsWith('/records/'))invalidateRecordReadRequests();
 if(path==='/media-assets'||path.startsWith('/media-assets/'))invalidatePageMediaAssets();
 if(path.startsWith('/metadata/pages/'))earlyEditorDrafts.clear();
}

export function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  // Only default GETs are coalesced. Any explicit RequestInit may carry caller
  // semantics (cache mode, credentials, abort signal, headers, etc.) and must
  // remain an independent request.
  if (init !== undefined) return performApiRequest<T>(path, init);
  const key = JSON.stringify([accessToken ?? null, path,
    path.startsWith('/records/')?recordReadGeneration:0]);
  const existing = inFlightGetRequests.get(key);
  if (existing) return existing as Promise<T>;
  const request = performApiRequest<T>(path, init);
  inFlightGetRequests.set(key, request);
  void request.finally(() => {
    if (inFlightGetRequests.get(key) === request) inFlightGetRequests.delete(key);
  }).catch(() => {
    // The caller receives the original rejection; this handler only avoids an
    // unhandled rejection from the cleanup promise created by finally().
  });
  return request;
}

async function performApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const send = (token: string | undefined) => fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
      'X-MetaDrive-Request-Source': 'web-app'
    }
  });
  const sentToken = accessToken;
  let response = await send(sentToken);
  if (response.status === 401 && !path.startsWith('/auth/')) {
    // If another request already refreshed while we were in flight, reuse that token.
    // Otherwise join the single shared refresh instead of firing N parallel refreshes
    // (parallel refreshes reuse the same rotation cookie -> family revoked -> logout).
    const token = accessToken !== undefined && accessToken !== sentToken
      ? accessToken
      : await refreshAccessToken();
    // Only retry once with a *different* token; retrying with the same/empty token
    // just repeats the 401 and can trigger another refresh loop.
    if (token && token !== sentToken) response = await send(token);
  }
  if (response.status === 204) {
    invalidateAfterWrite(path,init);
    return undefined as T;
  }
  if (!(response.headers.get('content-type')??'').toLowerCase().includes('application/json'))
    throw new ApiRequestError(`API ${path} returned non-JSON (HTTP ${response.status}); verify API deployment and routing`,
      {path},response.status);
  const payload = await response.json() as T & { error?: string; details?: unknown };
  if (!response.ok) {
    const details = Array.isArray(payload.details)
      ? payload.details.map(String).join('; ')
      : typeof payload.details === 'string'
        ? payload.details
        : payload.details
          ? JSON.stringify(payload.details)
          : '';
    throw new ApiRequestError(
      `${payload.error ?? `Request failed (${response.status})`}${details ? `: ${details}` : ''}`,
      payload, response.status
    );
  }
  invalidateAfterWrite(path,init);
  if(path==='/auth/me' && payload && typeof payload==='object' && 'user' in payload)
    setAuthenticatedFormulaBindingContext((payload as {user:unknown}).user);
  return payload;
}


/** Streaming uses the same short-lived Bearer token and refresh policy as normal API calls. */
export async function apiStream(path:string,signal:AbortSignal):Promise<Response> {
 const send=(token:string|undefined)=>fetch(apiBase+path,{
  method:'GET',signal,credentials:'include',
  headers:{Accept:'text/event-stream',...(token?{Authorization:'Bearer '+token}:{}),
   'X-MetaDrive-Request-Source':'web-app'}
 });
 const original=accessToken;
 let response=await send(original);
 if(response.status===401){
  const next=accessToken&&accessToken!==original?accessToken:await refreshAccessToken();
  if(next&&next!==original)response=await send(next);
 }
 if(!response.ok||!(response.headers.get('content-type')??'').includes('text/event-stream'))
  throw new ApiRequestError('Event stream unavailable (HTTP '+response.status+')',{path},response.status);
 return response;
}

export async function apiDownload(path: string, init?: RequestInit): Promise<Blob> {
  const send = (token: string | undefined) => fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
      'X-MetaDrive-Request-Source': 'web-app'
    }
  });
  const sentToken = accessToken;
  let response = await send(sentToken);
  if (response.status === 401 && !path.startsWith('/auth/')) {
    const token = accessToken !== undefined && accessToken !== sentToken
      ? accessToken
      : await refreshAccessToken();
    if (token && token !== sentToken) response = await send(token);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    if ((response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      const payload = await response.json() as { error?: string };
      if (payload.error) message = payload.error;
    }
    throw new ApiRequestError(message, { path }, response.status);
  }
  return response.blob();
}

export class ApiRequestError extends Error {
  constructor(message: string, readonly responseBody: unknown, readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function loadAppCommunicationHistory(objectName: string, field: string, source: string, offset: number, search: string) {
  const params = new URLSearchParams({
    limit: '50', offset: String(offset), ...(field ? {filterField:field, filterValue:source} : {}),
    ...(search ? { search } : {})
  });
  return apiRequest<{ records: Array<{ Id: string; [key: string]: unknown }>; total: number }>(
    `/records/${encodeURIComponent(objectName)}?${params.toString()}`);
}

export async function loadConnectorMarketplaceApps() {
  const result = await apiRequest<{records: import('../../integrations/ConnectorAppWorkspace/ConnectorAppWorkspace').ConnectorApp[]}>(`/connector-apps/catalog`);
  return result.records;
}
export async function executeConnectorAppLifecycleFlow(apiName: string, appKey: string): Promise<void> {
  await apiRequest(`/flows/${encodeURIComponent(apiName)}/execute`, {
    method: 'POST', body: JSON.stringify({AppKey:appKey})
  });
}
const pageCoalescer=createRecordPageCoalescer<Record<string,unknown>>();
export type FlowScreenRecordPageOptions={
  limit?:number;
  offset?:number;
  filter?:{field:string;value:string;related:boolean};
  filters?:Array<{field:string;operator:string;value:string|string[]}>;
  filterLogic?:string;
  /** Tenant/RBAC-checked Object search; never replaces list paging. */
  search?:string;
  forceRefresh?:boolean;
};
export async function loadFlowScreenRecordPage(
  objectApiName:string,options:FlowScreenRecordPageOptions={}
):Promise<{records:Record<string,unknown>[];total:number}> {
  const limit=options.limit??100,offset=options.offset??0;
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>1000000)
    throw new Error('Invalid record page request');
  const params=new URLSearchParams({offset:String(offset)});
  if(options.search!==undefined){
    if(typeof options.search!=='string'||options.search.length>256)throw new Error('Invalid record search');
    params.set('search',options.search);
  }
  if(options.filter){
    params.set(options.filter.related?'relatedField':'filterField',options.filter.field);
    params.set(options.filter.related?'relatedId':'filterValue',options.filter.value);
  }
  if(options.filters?.length){
    params.set('filters',JSON.stringify(options.filters));
    if(options.filterLogic)params.set('filterLogic',options.filterLogic);
  }
  // The key includes auth identity and every server query dimension except
  // limit. A concurrent 2-row and 100-row request then uses the larger page.
  // A short-lived successful page cache avoids remount refetches; a write
  // changes recordReadGeneration, so the old generation is never reused.
  const key=JSON.stringify([accessToken??null,recordReadGeneration,objectApiName,params.toString()]);
  const setFilters=offset===0?recordSetFilters(options):null;
  const readScope=accessToken,setGeneration=recordSetGeneration(accessToken);
  const page=await pageCoalescer(key,limit,combinedLimit=>{
   const query=new URLSearchParams(params);
   query.set('limit',String(combinedLimit));
   return apiRequest<{records:Record<string,unknown>[];total:number}>(
    '/records/'+encodeURIComponent(objectApiName)+'?'+query.toString());
  },options.forceRefresh===true);
  if(setFilters&&Array.isArray(page?.records)&&typeof page.total==='number')
   rememberCompleteRecordSet(readScope,objectApiName,setFilters,page.records,page.total,setGeneration);
  return page;
}
/** Equality-only, AND-only queries describe an exact record set the store can reuse. */
function recordSetFilters(options:FlowScreenRecordPageOptions):SetFilter[]|null{
  const out:SetFilter[]=[];
  if(options.filter){
    if(!options.filter.related)return null;
    out.push({field:options.filter.field,operator:'eq',value:options.filter.value});
  }
  if(options.filters?.length){
    if(options.filterLogic&&!/^\(?\s*1(\s+AND\s+\d+)*\s*\)?$/i.test(options.filterLogic))return null;
    for(const filter of options.filters){
      if(filter.operator!=='eq'||typeof filter.value!=='string'||!filter.value)return null;
      out.push({field:filter.field,operator:'eq',value:filter.value});
    }
  }
  return out;
}
setLocalRecordSetProvider({
  rowsFor:(object:string,filters:SetFilter[])=>rowsForFilters(accessToken,object,filters,
    (name,query)=>loadFlowScreenRecordPage(name,{limit:100,offset:0,filters:query})),
  rowById:(object:string,id:string)=>heldRowById(accessToken,object,id)
});
export async function loadFlowScreenRecords(
  objectApiName:string,filter?:{field:string;value:string;related:boolean}
):Promise<Record<string,unknown>[]> {
  const result=await loadFlowScreenRecordPage(objectApiName,{filter});
  return result.records;
}


export function getAccessToken() { return accessToken; }
export function setAccessToken(value: string | undefined) {
  if(value!==accessToken){setAuthenticatedFormulaBindingContext(null);earlyEditorDrafts.clear();}
  accessToken=value;
}

// Published components use the existing authenticated Core API.
setSqlFormulaRequest(apiRequest);
