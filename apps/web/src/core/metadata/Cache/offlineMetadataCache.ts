/** Encrypted, identity-scoped metadata snapshots for the single MetaDrive client.
 * Read is allowed only after the caller has an authenticated identity; never used
 * as an authentication or entitlement source. Payment and Flow execution stay online/LAN.
 */
export type OfflineMetadataIdentity = { tenantId: string; userId: string };
import type { MetadataRevision } from '../Definitions/metadataRevisionPolicy';

export type OfflineMetadataSnapshot = {
  version: 1;
  savedAt: number;
  /** Optional verified publication revision; legacy encrypted snapshots remain readable. */
  revision?: MetadataRevision;
  pages: unknown[];
  apps: unknown[];
  objects: unknown[];
  components: unknown[];
};
const DB = 'metadrive-metadata-cache-v1';
const identityKey = (identity: OfflineMetadataIdentity) => {
  if (!identity.tenantId || !identity.userId) throw Error('Authenticated tenant and user are required');
  return JSON.stringify([identity.tenantId, identity.userId]);
};
function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) return Promise.reject(Error('Secure offline storage is unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('keys');
      request.result.createObjectStore('snapshots');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? Error('Metadata database unavailable'));
  });
}
function operation<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? Error('Metadata storage failed'));
    tx.onabort = () => reject(tx.error ?? Error('Metadata storage cancelled'));
  });
}
async function keyFor(db: IDBDatabase, owner: string, allowCreate: boolean): Promise<CryptoKey | undefined> {
  const current = await operation<CryptoKey | undefined>(db, 'keys', 'readonly', s => s.get(owner));
  if (current || !allowCreate) return current;
  const generated = await crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    const s = tx.objectStore('keys');
    const check = s.get(owner);
    check.onsuccess = () => { if (!check.result) s.put(generated, owner); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return operation<CryptoKey | undefined>(db, 'keys', 'readonly', s => s.get(owner));
}
export async function saveOfflineMetadata(identity: OfflineMetadataIdentity, snapshot: Omit<OfflineMetadataSnapshot,'version'|'savedAt'>): Promise<void> {
  const owner = identityKey(identity);
  const db = await openDatabase();
  try {
    const key = await keyFor(db,owner,true);
    if (!key) throw Error('Offline metadata encryption unavailable');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload: OfflineMetadataSnapshot = { version:1, savedAt:Date.now(), ...snapshot };
    const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(payload)));
    await operation(db,'snapshots','readwrite',s => s.put({iv,cipher},owner));
  } finally { db.close(); }
}
export async function readOfflineMetadata(identity: OfflineMetadataIdentity, maxAgeMs = 86400000): Promise<OfflineMetadataSnapshot | null> {
  const owner = identityKey(identity);
  const db = await openDatabase();
  try {
    const key = await keyFor(db,owner,false);
    if (!key) return null;
    const stored = await operation<{iv:Uint8Array;cipher:ArrayBuffer}|undefined>(db,'snapshots','readonly',s=>s.get(owner));
    if (!stored) return null;
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:stored.iv as BufferSource},key,stored.cipher);
    const value: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (!value || typeof value !== 'object') return null;
    const result = value as OfflineMetadataSnapshot;
    if (result.version !== 1 || !Number.isFinite(result.savedAt) || result.savedAt > Date.now()
      || Date.now()-result.savedAt > maxAgeMs
      || ![result.pages,result.apps,result.objects,result.components].every(Array.isArray)) return null;
    return result;
  } finally { db.close(); }
}
export async function clearOfflineMetadata(identity: OfflineMetadataIdentity): Promise<void> {
  const owner = identityKey(identity);
  const db = await openDatabase();
  try {
    await Promise.all([
      operation(db,'snapshots','readwrite',s=>s.delete(owner)),
      operation(db,'keys','readwrite',s=>s.delete(owner))
    ]);
  } finally { db.close(); }
}
