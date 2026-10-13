// ===== IndexedDB 底层封装 =====
// 数据库名称与版本号（对应 architecture.md 第 8 节）

export const DB_NAME = 'yuehou';
export const DB_VERSION = 1;

export type StoreName = 'pages' | 'visits' | 'settings' | 'meta';

/** 打开数据库（升级逻辑由 migrations 提供） */
export function openDatabase(
  name: string = DB_NAME,
  version: number = DB_VERSION,
  upgrade?: (db: IDBDatabase, oldVersion: number, newVersion: number) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      upgrade?.(db, event.oldVersion, event.newVersion ?? version);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

// ---- 通用 CRUD 帮助函数 ----

export async function dbGet<T>(db: IDBDatabase, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return requestToPromise(db.transaction(store, 'readonly').objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function dbGetAll<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  return requestToPromise(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function dbGetByIndex<T>(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return requestToPromise(
    db.transaction(store, 'readonly').objectStore(store).index(indexName).get(key) as IDBRequest<T | undefined>,
  );
}

export async function dbPut(db: IDBDatabase, store: StoreName, value: unknown): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await transactionDone(tx);
}

export async function dbDelete(db: IDBDatabase, store: StoreName, key: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await transactionDone(tx);
}

export async function dbClear(db: IDBDatabase, store: StoreName): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await transactionDone(tx);
}

export async function dbCount(db: IDBDatabase, store: StoreName): Promise<number> {
  return requestToPromise(db.transaction(store, 'readonly').objectStore(store).count());
}

export async function dbGetAllByIndex<T>(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  range?: IDBKeyRange | IDBValidKey,
): Promise<T[]> {
  return requestToPromise(
    db.transaction(store, 'readonly').objectStore(store).index(indexName).getAll(range) as IDBRequest<T[]>,
  );
}
