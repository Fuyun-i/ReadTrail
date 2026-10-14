// 搜索历史存储 — 使用 IndexedDB meta store
// 存储最近 20 个搜索词（去重、带时间戳）

import { openDatabase, dbGet, dbPut, DB_NAME, DB_VERSION } from '../db';
import { applyMigrations } from '../migrations';

const MAX_HISTORY = 20;
const META_KEY = 'searchHistory';

export type SearchHistoryEntry = { query: string; timestamp: number };

type MetaRecord = { key: string; value: SearchHistoryEntry[] };

export class SearchHistoryRepository {
  async getAll(): Promise<SearchHistoryEntry[]> {
    const db = await openDatabase(DB_NAME, DB_VERSION, applyMigrations);
    const record = await dbGet<MetaRecord>(db, 'meta', META_KEY);
    db.close();
    return record?.value ?? [];
  }

  async add(query: string): Promise<SearchHistoryEntry[]> {
    const trimmed = query.trim();
    if (!trimmed) return this.getAll();

    const existing = await this.getAll();
    const filtered = existing.filter((e) => e.query !== trimmed);
    const updated = [{ query: trimmed, timestamp: Date.now() }, ...filtered].slice(0, MAX_HISTORY);

    const db = await openDatabase(DB_NAME, DB_VERSION, applyMigrations);
    await dbPut(db, 'meta', { key: META_KEY, value: updated } satisfies MetaRecord);
    db.close();
    return updated;
  }

  async clear(): Promise<void> {
    const db = await openDatabase(DB_NAME, DB_VERSION, applyMigrations);
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    await new Promise<void>((resolve, reject) => {
      const req = store.delete(META_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  }
}
