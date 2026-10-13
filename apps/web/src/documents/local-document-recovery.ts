export interface RecoveryMetadata {
  accountId: string;
  workspaceId: string;
  tabId: string;
  snapshotId: string;
  writtenAt: string;
}
export interface RecoverySnapshot<T extends Record<string, unknown> = Record<string, unknown>> extends RecoveryMetadata { payload: T }
export type RecoveryErrorCode = 'UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'READ_FAILED' | 'WRITE_FAILED' | 'INVALID_SCOPE' | 'INVALID_SNAPSHOT';
export class LocalDocumentRecoveryError extends Error {
  constructor(readonly code: RecoveryErrorCode, message: string) { super(message); this.name = 'LocalDocumentRecoveryError'; }
}

const DATABASE = 'claim-center-local-document-recovery';
const STORE = 'snapshots';
let connection: Promise<IDBDatabase> | undefined;
let pageTabId: string | undefined;
const queues = new Map<string, Promise<void>>();
const identity = () => {
  if (!globalThis.crypto?.randomUUID) throw new LocalDocumentRecoveryError('UNAVAILABLE', '이 브라우저에서는 로컬 복구 식별자를 만들 수 없습니다.');
  return globalThis.crypto.randomUUID();
};
const failure = (error: unknown, mode: IDBTransactionMode): LocalDocumentRecoveryError => {
  if (error instanceof LocalDocumentRecoveryError) return error;
  return error instanceof DOMException && error.name === 'QuotaExceededError'
    ? new LocalDocumentRecoveryError('QUOTA_EXCEEDED', '브라우저 저장 공간이 부족하여 로컬 복구본을 보관하지 못했습니다. 서버 저장 완료와 별도로 확인해 주세요.')
    : new LocalDocumentRecoveryError(mode === 'readonly' ? 'READ_FAILED' : 'WRITE_FAILED', '로컬 복구본을 읽거나 저장하지 못했습니다. 저장 완료로 처리하지 않았습니다.');
};
const openDatabase = (): Promise<IDBDatabase> => {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      if (!globalThis.indexedDB) throw new Error('IndexedDB unavailable');
      request = globalThis.indexedDB.open(DATABASE, 1);
    } catch { reject(new LocalDocumentRecoveryError('UNAVAILABLE', '브라우저의 로컬 복구 저장소를 사용할 수 없습니다.')); return; }
    let settled = false;
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: ['accountId', 'workspaceId', 'tabId'] });
      store.createIndex('workspace', ['accountId', 'workspaceId']);
      store.createIndex('snapshot', ['accountId', 'workspaceId', 'snapshotId'], { unique: true });
    };
    request.onerror = () => { settled = true; reject(failure(request.error, 'readwrite')); };
    request.onblocked = () => { settled = true; reject(new LocalDocumentRecoveryError('UNAVAILABLE', '다른 탭에서 복구 저장소를 사용 중입니다. 복구본 저장을 완료하지 못했습니다.')); };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
  }).catch(error => { connection = undefined; throw error; });
  return connection;
};
const value = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  let tx: IDBTransaction;
  try { tx = db.transaction(STORE, mode); } catch (error) { throw failure(error, mode); }
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
  try { const result = await action(tx.objectStore(STORE)); await committed; return result; }
  catch (error) { try { tx.abort(); } catch { /* Already aborted or committed. */ } await committed.catch(() => undefined); throw failure(error, mode); }
}
function queue<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}
function checked<T extends Record<string, unknown>>(record: RecoverySnapshot<T>, accountId: string, workspaceId: string): RecoverySnapshot<T> {
  if (record.accountId !== accountId || record.workspaceId !== workspaceId || typeof record.tabId !== 'string' || !record.tabId
    || typeof record.snapshotId !== 'string' || !record.snapshotId || typeof record.writtenAt !== 'string' || !Number.isFinite(Date.parse(record.writtenAt))
    || !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) throw new LocalDocumentRecoveryError('INVALID_SNAPSHOT', '로컬 복구본의 문서·계정 또는 데이터 형식을 확인하지 못했습니다.');
  return record;
}

/** Local-only journal. The caller decides whether an exact server acknowledgement exists. */
export function createLocalDocumentRecovery<T extends Record<string, unknown> = Record<string, unknown>>(scope: { accountId: string; workspaceId: string; tabId?: string }) {
  const { accountId, workspaceId } = scope;
  if ([accountId, workspaceId, ...(scope.tabId === undefined ? [] : [scope.tabId])].some(id => typeof id !== 'string' || !id.trim() || id.length > 500)) throw new LocalDocumentRecoveryError('INVALID_SCOPE', '복구할 계정과 문서를 명확히 지정해 주세요.');
  const tabId = scope.tabId ?? (pageTabId ??= identity());
  const queueKey = JSON.stringify([accountId, workspaceId]);
  return {
    tabId,
    write(payload: T): Promise<RecoverySnapshot<T>> {
      let snapshot: RecoverySnapshot<T>;
      try {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new LocalDocumentRecoveryError('INVALID_SNAPSHOT', '복구본은 구조형 문서 스냅샷이어야 합니다.');
        snapshot = { accountId, workspaceId, tabId, snapshotId: identity(), writtenAt: new Date().toISOString(), payload: structuredClone(payload) };
      } catch (error) { return Promise.reject(failure(error, 'readwrite')); }
      return queue(queueKey, () => transaction('readwrite', async store => { await value(store.put(snapshot)); return snapshot; }));
    },
    list(): Promise<RecoveryMetadata[]> {
      return queue(queueKey, () => transaction('readonly', async store => {
        const records = await value<RecoverySnapshot<T>[]>(store.index('workspace').getAll(IDBKeyRange.only([accountId, workspaceId])));
        return records.map(record => { const { payload: _payload, ...metadata } = checked(record, accountId, workspaceId); return metadata; }).sort((a, b) => b.writtenAt.localeCompare(a.writtenAt));
      }));
    },
    read(snapshotId: string): Promise<RecoverySnapshot<T> | null> {
      return queue(queueKey, () => transaction('readonly', async store => {
        const record = await value<RecoverySnapshot<T> | undefined>(store.index('snapshot').get([accountId, workspaceId, snapshotId]));
        return record ? checked(record, accountId, workspaceId) : null;
      }));
    },
    acknowledge(snapshotId: string): Promise<boolean> {
      return queue(queueKey, () => transaction('readwrite', async store => {
        const record = await value<RecoverySnapshot<T> | undefined>(store.index('snapshot').get([accountId, workspaceId, snapshotId]));
        if (!record) return false;
        checked(record, accountId, workspaceId);
        await value(store.delete([accountId, workspaceId, record.tabId]));
        return true;
      }));
    }
  };
}
