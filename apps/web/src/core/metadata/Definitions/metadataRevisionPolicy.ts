/** Phase 2f: versioned metadata cache acceptance and recovery decisions.
 * Works with the existing identity-encrypted offlineMetadataCache; never
 * authorises a user or executes a Flow from cached permissions.
 */
export type MetadataRevision = {version:number;publishedAt:number;digest:string};
export type CachedMetadataEnvelope<T> = {
  tenantId:string;userId:string;revision:MetadataRevision;payload:T;
};
const safeId=(value:string)=>typeof value==='string'&&value.length>0&&value.length<=256;
const validRevision=(r:MetadataRevision)=>r&&Number.isSafeInteger(r.version)&&r.version>0
  &&Number.isFinite(r.publishedAt)&&r.publishedAt>0
  &&typeof r.digest==='string'&&/^[a-f0-9]{64}$/.test(r.digest);
export function metadataCacheDecision<T>(
  candidate:CachedMetadataEnvelope<T>|undefined,context:{
    tenantId:string;userId:string;now:number;maxAgeMs:number;
    minimumVersion:number;verifiedDigest?:string;
  }
):'accept'|'reject'{
  if(!candidate||!safeId(context.tenantId)||!safeId(context.userId)
    ||candidate.tenantId!==context.tenantId||candidate.userId!==context.userId
    ||!validRevision(candidate.revision)||!Number.isFinite(context.now)
    ||!Number.isFinite(context.maxAgeMs)||context.maxAgeMs<0
    ||!Number.isSafeInteger(context.minimumVersion)||context.minimumVersion<1)
    return 'reject';
  // A freshly authenticated publication is stamped by the API server.
  // Client clocks can be a few seconds behind, particularly on Windows devices.
  // Rejecting every future millisecond made valid online metadata fail its
  // integrity check; allow bounded skew without weakening digest/version checks.
  const age=context.now-candidate.revision.publishedAt;
  const maxClockSkewMs=5*60*1000;
  if(age < -maxClockSkewMs || age > context.maxAgeMs
    || candidate.revision.version < context.minimumVersion)
    return 'reject';
  if(context.verifiedDigest!==undefined && candidate.revision.digest!==context.verifiedDigest)
    return 'reject';
  return 'accept';
}
/** A last-known-good revision can be selected only if explicitly supplied by
 * a trusted server publication authority, never by client-saved metadata.
 * This selects metadata, not permissions, credentials or tenant data.
 */
export function chooseMetadataRecovery<T>(
  current:CachedMetadataEnvelope<T>|undefined,
  trustedLastKnownGood:CachedMetadataEnvelope<T>|undefined,
  context:Parameters<typeof metadataCacheDecision<T>>[1]
):CachedMetadataEnvelope<T>|undefined{
  if(current&&metadataCacheDecision(current,context)==='accept')return current;
  if(trustedLastKnownGood&&metadataCacheDecision(trustedLastKnownGood,context)==='accept')
    return trustedLastKnownGood;
  return undefined;
}
