/** Presentation-only route declarations from independently owned app packages. */
export type StandaloneEntry=Readonly<{
  appId:string;slug:string;label:string;tagline:string;eyebrow:string;
  accent:string;signInDescription:string;
}>;
const entries:ReadonlyArray<StandaloneEntry>=[];

/** Accept only registered product root paths. No generic /slug bypass or setup redirect. */
export function resolveStandaloneEntry(pathname:string,basePath=''):StandaloneEntry|null {
  const base=basePath.replace(/\/$/,'');
  const local=base && pathname.startsWith(base+'/')?pathname.slice(base.length):pathname;
  const match=/^\/([a-z][a-z0-9]*?)\/?$/i.exec(local);
  return match?entries.find(e=>e.slug===match[1].toLowerCase())??null:null;
}

/** Resolve only explicitly registered standalone products, never arbitrary app IDs. */
export function standaloneEntryForAppId(appId:string):StandaloneEntry|null {
  const normal=appId.toLowerCase();
  return entries.find(entry=>entry.appId.toLowerCase()===normal||entry.slug===normal)??null;
}

/** Convert old internal app URLs into the standalone frontend's canonical URL.
 * Keep only safe app-page names; backend still verifies app/page entitlements.
 */
export function standaloneCanonicalPath(pathname:string,search='',basePath=''):string|null {
  const base=basePath.replace(/\/$/,'');
  const local=base&&pathname.startsWith(base+'/')?pathname.slice(base.length):pathname;
  const parts=local.split('/').filter(Boolean);
  if(parts.length!==4&&parts.length!==5)return null;
  if(parts[0]!=='une'||parts[1]!=='apps')return null;
  const entry=standaloneEntryForAppId(parts[2]);
  if(!entry)return null;
  if(parts.length===4&&parts[3]!=='home')return null;
  if(parts.length===5&&(parts[3]!=='pages'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(parts[4])))return null;
  const query=new URLSearchParams(search);
  if(parts.length===5)query.set('page',parts[4]);
  else query.delete('page');
  // The app page is resolved through the existing RBAC-checked published runtime.
  const suffix=query.toString();
  return base+'/'+entry.slug+(suffix?'?'+suffix:'');
}
