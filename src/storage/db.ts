// ===== IndexedDB 底层封装 =====
// 数据库名称与版本号（对应 architecture.md 第 8 节）

export const DB_NAME = 'readtrail';
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

// ---- 通用 CRUD 辅助函数 ----

export async function dbGet<T>(db: IDBDatabase, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function dbGetAll<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function dbGetByIndex<T>(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).index(indexName).get(key) as IDBRequest<T | undefined>);
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
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).count());
}

export async function dbGetAllByIndex<T>(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  range?: IDBKeyRange | IDBValidKey,
): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  const index = tx.objectStore(store).index(indexName);
  return requestToPromise(index.getAll(range) as IDBRequest<T[]>);
}

/**
 * 按索引范围获取记录（利用 IDBKeyRange 做服务端过滤，避免全表加载）。
 * 支持排序方向与 limit，适用于 lastVisitedAt 等有序索引。
 */
export async function dbGetAllByIndexRange<T>(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  range: IDBKeyRange | undefined,
  options?: { limit?: number; reverse?: boolean },
): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  const index = tx.objectStore(store).index(indexName);
  // 有 limit 时用 openKeyCursor 逐条收集，避免 getAll 拉全量再 slice
  if (options?.limit !== undefined) {
    const results: T[] = [];
    const direction = options.reverse ? 'prev' : 'next';
    return new Promise<T[]>((resolve, reject) => {
      const cursorReq = range !== undefined ? index.openKeyCursor(range, direction) : index.openKeyCursor(null, direction);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor && results.length < options.limit!) {
          const getReq = index.get(cursor.primaryKey);
          getReq.onsuccess = () => {
            if (getReq.result !== undefined) results.push(getReq.result as T);
            cursor.continue();
          };
          getReq.onerror = () => reject(getReq.error ?? new Error('IndexedDB get failed'));
        } else {
          resolve(results);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error('IndexedDB cursor failed'));
    });
  }
  // 无 limit 时直接 getAll(range)
  return requestToPromise(index.getAll(range) as IDBRequest<T[]>);
}

/**
 * 单事务批量读取：N 个 get() 共享一个 readonly 事务，
 * 替代 N 次独立事务的 getByIds 旧实现。
 */
export async function dbGetBatch<T>(db: IDBDatabase, store: StoreName, keys: IDBValidKey[]): Promise<T[]> {
  if (keys.length === 0) return [];
  const tx = db.transaction(store, 'readonly');
  const objectStore = tx.objectStore(store);
  const promises = keys.map((key) => requestToPromise(objectStore.get(key) as IDBRequest<T | undefined>));
  const results = await Promise.all(promises);
  return results.filter((r) => r !== undefined) as T[];
}

/**
 * 按索引范围计数（不加载记录数据，只计数）。
 */
export async function dbCountByIndex(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  range?: IDBKeyRange | IDBValidKey,
): Promise<number> {
  const tx = db.transaction(store, 'readonly');
  const index = tx.objectStore(store).index(indexName);
  return requestToPromise(index.count(range));
}

/**
 * 按索引范围删除记录（游标遍历逐条删，避免全量加载到内存）。
 */
export async function dbDeleteByIndexRange(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  range: IDBKeyRange | undefined,
): Promise<number> {
  const tx = db.transaction(store, 'readwrite');
  const index = tx.objectStore(store).index(indexName);
  let count = 0;
  await new Promise<void>((resolve, reject) => {
    const cursorReq = range !== undefined ? index.openKeyCursor(range) : index.openKeyCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        tx.objectStore(store).delete(cursor.primaryKey);
        count++;
        cursor.continue();
      } else {
        // 游标遍历完毕，等事务提交
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error('cursor error'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('tx error'));
    tx.onabort = () => reject(tx.error ?? new Error('tx aborted'));
  });
  return count;
}
