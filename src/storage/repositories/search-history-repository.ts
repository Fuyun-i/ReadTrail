// 搜索历史存储 — 使用 IndexedDB meta store
// 存储最近 20 个搜索词（去重、带时间戳）

import { openDatabase, dbGet, transactionDone, DB_NAME, DB_VERSION } from '../db';
import { applyMigrations } from '../migrations';

const MAX_HISTORY = 20;
const META_KEY = 'searchHistory';

export type SearchHistoryEntry = { query: string; timestamp: number };

type MetaRecord = { key: string; value: SearchHistoryEntry[] };

export class SearchHistoryRepository {
  private dbPromise: Promise<IDBDatabase>;

  constructor(db?: IDBDatabase) {
    this.dbPromise = db
      ? Promise.resolve(db)
      : openDatabase(DB_NAME, DB_VERSION, applyMigrations);
  }

  async getAll(): Promise<SearchHistoryEntry[]> {
    const db = await this.dbPromise;
    const record = await dbGet<MetaRecord>(db, 'meta', META_KEY);
    return record?.value ?? [];
  }

  async add(query: string): Promise<SearchHistoryEntry[]> {
    const trimmed = query.trim();
    if (!trimmed) return this.getAll();

    // 单事务读-改-写，避免并发竞态导致后写者覆盖先写者
    const db = await this.dbPromise;
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');

    // 在同一事务内读取现有数据
    const existing = await new Promise<MetaRecord | undefined>((resolve, reject) => {
      const req = store.get(META_KEY);
      req.onsuccess = () => resolve(req.result as MetaRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error('search history get failed'));
    });

    const current = existing?.value ?? [];
    const filtered = current.filter((e) => e.query !== trimmed);
    const updated = [{ query: trimmed, timestamp: Date.now() }, ...filtered].slice(0, MAX_HISTORY);

    store.put({ key: META_KEY, value: updated } satisfies MetaRecord);
    await transactionDone(tx);
    return updated;
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    store.delete(META_KEY);
    await transactionDone(tx);
  }
}
