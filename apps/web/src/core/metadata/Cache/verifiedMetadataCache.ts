import {readOfflineMetadata,saveOfflineMetadata,type OfflineMetadataIdentity,type OfflineMetadataSnapshot} from './offlineMetadataCache';
import {metadataCacheDecision,type MetadataRevision} from '../Definitions/metadataRevisionPolicy';

export type Content = Pick<OfflineMetadataSnapshot,'pages'|'apps'|'objects'|'components'>;
export type TrustedPublication = {
  revision:MetadataRevision;
  /** Must come from an authenticated server publication response, not saved browser state. */
  verifiedDigest:string;
  minimumVersion:number;
};
export type MetadataPublicationResponse={content:Content;publication:TrustedPublication};
const contentOf=(snapshot:Content):Content=>({
  pages:snapshot.pages,apps:snapshot.apps,objects:snapshot.objects,components:snapshot.components
});
export async function metadataPayloadDigest(content:Content):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(contentOf(content))));
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
/** Add publication verification to the existing encrypted per-user cache. */
export async function saveVerifiedMetadata(
  identity:OfflineMetadataIdentity,content:Content,publication:TrustedPublication
):Promise<void>{
  if(!publication?.verifiedDigest || publication.verifiedDigest!==publication.revision?.digest)
    throw Error('Metadata publication digest missing or inconsistent');
  if(await metadataPayloadDigest(content)!==publication.verifiedDigest)
    throw Error('Metadata publication payload digest mismatch');
  if(metadataCacheDecision({ ...identity,revision:publication.revision,payload:content},{
      ...identity,now:Date.now(),maxAgeMs:86400000,minimumVersion:publication.minimumVersion,
      verifiedDigest:publication.verifiedDigest
    })!=='accept')throw Error('Metadata publication identity, version or freshness rejected');
  await saveOfflineMetadata(identity,{...contentOf(content),revision:publication.revision});
}
/** Never interpret this metadata as authentication, permissions, or Flow approval. */
export async function readVerifiedMetadata(
  identity:OfflineMetadataIdentity,publication:TrustedPublication,maxAgeMs=86400000
):Promise<OfflineMetadataSnapshot|null>{
  if(!publication.verifiedDigest||publication.verifiedDigest!==publication.revision.digest)return null;
  const cached=await readOfflineMetadata(identity,maxAgeMs);
  if(!cached?.revision)return null;
  if(cached.revision.version!==publication.revision.version
    ||cached.revision.digest!==publication.revision.digest)return null;
  if(metadataCacheDecision({...identity,revision:cached.revision,payload:contentOf(cached)},{
    ...identity,now:Date.now(),maxAgeMs,minimumVersion:publication.minimumVersion,
    verifiedDigest:publication.verifiedDigest
  })!=='accept')return null;
  if(await metadataPayloadDigest(cached)!==publication.verifiedDigest)return null;
  return cached;
}
