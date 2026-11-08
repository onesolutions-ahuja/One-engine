export type PlatformEventTarget='page-session'|'record'|'user'|'context';
export function matchesPlatformEventTarget(config:Record<string,unknown>,payload:Record<string,unknown>,
 context:{pageSessionKey?:string;recordId?:string;userId?:string;contextRecordId?:string}):boolean{
 const target=config.matchEventTo;
 if(!target)return true; // Explicitly configured broadcast; permission still enforced by the server.
 if(!['page-session','record','user','context'].includes(String(target)))return false;
 const field=config.matchEventField;
 if(typeof field!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)
  ||['constructor','prototype','__proto__'].includes(field))return false;
 const expected=target==='page-session'?context.pageSessionKey:target==='record'?context.recordId:
  target==='context'?context.contextRecordId:context.userId;
 return typeof expected==='string'&&expected.length>0&&payload[field]===expected;
}
