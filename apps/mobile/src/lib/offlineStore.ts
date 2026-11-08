import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import type { Identity, OfflineBriefcaseResponse } from './mobileApi';

export type CachedRecord = {
  objectApi: string;
  recordId: string;
  record: Record<string, unknown>;
  syncedAt: string;
};

type EncryptedRow = {
  object_api: string;
  record_id: string;
  ciphertext: string;
  synced_at: string;
};

let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('metadrive-offline-briefcase.db')
      .then(async db => {
        await db.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS offline_records (
            tenant_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            object_api TEXT NOT NULL,
            record_id TEXT NOT NULL,
            ciphertext TEXT NOT NULL,
            synced_at TEXT NOT NULL,
            PRIMARY KEY (tenant_id, user_id, object_api, record_id)
          );
        `);
        return db;
      })
      .catch(error => {
        databasePromise = undefined;
        throw error;
      });
  }
  return databasePromise;
}

function keyStorageKey(identity: Identity): string {
  return `metadrive.briefcase.key.v1.${identity.tenantId}.${identity.userId}`;
}

function additionalData(identity: Identity, objectApi: string, recordId: string): Uint8Array {
  return encoder.encode(JSON.stringify([identity.tenantId, identity.userId, objectApi, recordId]));
}

async function encryptionKey(identity: Identity): Promise<AESEncryptionKey> {
  const secureKey = keyStorageKey(identity);
  const encoded = await SecureStore.getItemAsync(secureKey);
  if (encoded) return AESEncryptionKey.import(encoded, 'hex');
  const generated = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(secureKey, await generated.encoded('hex'));
  return generated;
}

function validateRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The briefcase API returned an invalid record.');
  }
  return value as Record<string, unknown>;
}

export async function replaceCachedRecords(
  identity: Identity,
  response: OfflineBriefcaseResponse
): Promise<number> {
  const key = await encryptionKey(identity);
  const syncedAt = response.syncedAt;
  const rows: EncryptedRow[] = [];
  for (const selection of response.selections) {
    if (!selection || typeof selection.objectApi !== 'string' || !Array.isArray(selection.records)) {
      throw new Error('The briefcase API returned an invalid object selection.');
    }
    for (const item of selection.records) {
      if (!item || typeof item.recordId !== 'string') {
        throw new Error('The briefcase API returned an invalid record identifier.');
      }
      const record = validateRecord(item.record);
      const aad = additionalData(identity, selection.objectApi, item.recordId);
      const sealed = await aesEncryptAsync(encoder.encode(JSON.stringify(record)), key, { additionalData: aad });
      rows.push({
        object_api: selection.objectApi,
        record_id: item.recordId,
        ciphertext: await sealed.combined('base64'),
        synced_at: syncedAt
      });
    }
  }

  const db = await database();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'DELETE FROM offline_records WHERE tenant_id = ? AND user_id = ?',
      identity.tenantId,
      identity.userId
    );
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO offline_records
          (tenant_id, user_id, object_api, record_id, ciphertext, synced_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        identity.tenantId,
        identity.userId,
        row.object_api,
        row.record_id,
        row.ciphertext,
        row.synced_at
      );
    }
  });
  return rows.length;
}

export async function readCachedRecords(identity: Identity): Promise<CachedRecord[]> {
  const db = await database();
  const rows = await db.getAllAsync<EncryptedRow>(
    `SELECT object_api, record_id, ciphertext, synced_at
       FROM offline_records WHERE tenant_id = ? AND user_id = ?
       ORDER BY object_api, record_id`,
    identity.tenantId,
    identity.userId
  );
  if (rows.length === 0) return [];
  const key = await encryptionKey(identity);
  const records: CachedRecord[] = [];
  for (const row of rows) {
    const sealed = AESSealedData.fromCombined(row.ciphertext);
    const plaintext = await aesDecryptAsync(sealed, key, {
      additionalData: additionalData(identity, row.object_api, row.record_id)
    });
    if (!(plaintext instanceof Uint8Array)) throw new Error('Unable to decode an offline record.');
    records.push({
      objectApi: row.object_api,
      recordId: row.record_id,
      record: validateRecord(JSON.parse(decoder.decode(plaintext))),
      syncedAt: row.synced_at
    });
  }
  return records;
}

export async function clearCachedRecords(identity: Identity): Promise<void> {
  let failure: unknown;
  try {
    const db = await database();
    await db.runAsync(
      'DELETE FROM offline_records WHERE tenant_id = ? AND user_id = ?',
      identity.tenantId,
      identity.userId
    );
  } catch (error) {
    failure = error;
  }
  try {
    await SecureStore.deleteItemAsync(keyStorageKey(identity));
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}
