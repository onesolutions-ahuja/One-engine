/**
 * User-and-tenant-isolated encrypted IndexedDB queue for provisional record writes.
 * Only authenticated browser sessions may sync; never persist bearer/refresh tokens.
 * Denials and ambiguous responses are retained locally, not silently discarded.
 */
export type OfflineQueueOwner = { userId: string; tenantId: string };
export type OfflineRecordWrite = {
  id: string;
  objectApiName: string;
  method: 'POST' | 'PUT';
  recordId?: string;
  originalModifiedAt?: string;
  values: Record<string, unknown>;
  createdAt: string;
};
export type OfflineRecordItem = OfflineRecordWrite & {
  status: 'pending' | 'rejected' | 'needs-review';
  reason?: string;
};
type StoredItem = {
  id: string; owner: string; status: OfflineRecordItem['status']; reason?: string;
  createdAt: string; iv: Uint8Array; cipher: ArrayBuffer;
};
const databaseName = 'metadrive-provisional-records-v1';
const ownerKey = ({userId, tenantId}: OfflineQueueOwner) => tenantId + ':' + userId;
let databasePromise: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle)
    return Promise.reject(new Error('Secure offline storage is unavailable in this browser.'));
  if (!databasePromise) databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('keys');
      db.createObjectStore('mutations', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? Error('Offline database unavailable'));
  }).catch((error: unknown) => { databasePromise = undefined; throw error; });
  return databasePromise!;
}
function transact<T>(db: IDBDatabase, storeName: string, mode: IDBTransactionMode,
  requestFactory: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = requestFactory(transaction.objectStore(storeName));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? Error('Offline storage transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? Error('Offline storage transaction aborted'));
  });
}
async function getKey(db: IDBDatabase, owner: string, create: boolean): Promise<CryptoKey> {
  const stored = await transact(db, 'keys', 'readonly', store => store.get(owner)) as CryptoKey | undefined;
  if (stored) return stored;
  if (!create) throw Error('The offline encryption key is missing; queued records cannot be read.');
  const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // First transaction that creates an owner key wins. The stored key is never extractable.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    const store = tx.objectStore('keys');
    const get = store.get(owner);
    get.onsuccess = () => { if (!get.result) store.put(generated, owner); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return (await transact(db, 'keys', 'readonly', store => store.get(owner))) as CryptoKey;
}
function validWrite(write: OfflineRecordWrite): boolean {
  return Boolean(write.id && write.objectApiName && ['POST', 'PUT'].includes(write.method)
    && (write.method === 'POST' || write.recordId)
    && write.values && typeof write.values === 'object' && !Array.isArray(write.values));
}
export async function queueOfflineRecord(owner: OfflineQueueOwner, write: OfflineRecordWrite,
  status: OfflineRecordItem['status'] = 'pending', reason?: string): Promise<void> {
  if (!owner.userId || !owner.tenantId || !validWrite(write) || write.objectApiName === 'User')
    throw Error('This record cannot be queued for offline synchronisation.');
  const db = await database();
  const key = await getKey(db, ownerKey(owner), true);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv },
    key, new TextEncoder().encode(JSON.stringify(write)));
  const row: StoredItem = { id: write.id, owner: ownerKey(owner), status, reason,
    createdAt: write.createdAt, iv, cipher };
  await transact(db, 'mutations', 'readwrite', store => store.add(row));
}
export async function listOfflineRecords(owner: OfflineQueueOwner): Promise<OfflineRecordItem[]> {
  const db = await database();
  const rows = await transact(db, 'mutations', 'readonly', store => store.getAll()) as StoredItem[];
  const scoped = rows.filter(row => row.owner === ownerKey(owner));
  if (!scoped.length) return [];
  const key = await getKey(db, ownerKey(owner), false);
  const items = await Promise.all(scoped.map(async row => {
    const buffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv as BufferSource }, key, row.cipher);
    const write = JSON.parse(new TextDecoder().decode(buffer)) as OfflineRecordWrite;
    if (!validWrite(write) || write.id !== row.id) throw Error('Offline record integrity check failed');
    return { ...write, status: row.status, reason: row.reason } as OfflineRecordItem;
  }));
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function markOfflineRecord(owner: OfflineQueueOwner, id: string,
  status: OfflineRecordItem['status'], reason?: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const get = store.get(id);
    get.onsuccess = () => {
      const row = get.result as StoredItem | undefined;
      if (!row || row.owner !== ownerKey(owner)) { tx.abort(); return; }
      store.put({ ...row, status, reason });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? Error('Offline write status update failed'));
    tx.onabort = () => reject(Error('Offline record does not belong to this user'));
  });
}
export async function removeOfflineRecord(owner: OfflineQueueOwner, id: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const get = store.get(id);
    get.onsuccess = () => {
      const row = get.result as StoredItem | undefined;
      if (!row || row.owner !== ownerKey(owner)) { tx.abort(); return; }
      store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? Error('Offline record deletion failed'));
    tx.onabort = () => reject(Error('Offline record does not belong to this user'));
  });
}
/**
 * Never infer success on a missing HTTP response: server may have committed.
 * The caller must explicitly review an ambiguous entry before any retry.
 */
export type SyncOutcome = 'saved' | 'rejected' | 'needs-review' | 'unavailable';
export async function synchronizeOfflineRecords(
  owner: OfflineQueueOwner,
  submit: (write: OfflineRecordWrite) => Promise<{ outcome: SyncOutcome; reason?: string }>
): Promise<{ saved: number; rejected: number; review: number }> {
  // A browser crash or lost HTTP response must never trigger an automatic
  // duplicate create on the next page load. Mark indeterminate BEFORE sending.
  // The cross-tab Web Lock prevents two tabs replaying the same operation.
  if (!navigator.locks)
    throw Error('This browser cannot safely synchronise offline changes. Local drafts are preserved.');
  const result = await navigator.locks.request(
    'metadrive:offline-record-sync:' + ownerKey(owner),
    { mode: 'exclusive', ifAvailable: true },
    async lock => {
      if (!lock) return null;
      let saved = 0, rejected = 0, review = 0;
      for (const write of await listOfflineRecords(owner)) {
        if (write.status !== 'pending') continue;
        if (!navigator.onLine) break;
        await markOfflineRecord(owner,write.id,'needs-review',
          'A sync request may have reached the server. Confirm its result before retrying.');
        const outcome = await submit(write);
        if (outcome.outcome === 'unavailable') break;
        if (outcome.outcome === 'saved') {
          await removeOfflineRecord(owner, write.id);
          saved++;
        } else {
          await markOfflineRecord(owner, write.id, outcome.outcome, outcome.reason);
          if (outcome.outcome === 'rejected') rejected++;
          else review++;
        }
      }
      return {saved,rejected,review};
    }
  );
  return result ?? {saved:0,rejected:0,review:0};
}
