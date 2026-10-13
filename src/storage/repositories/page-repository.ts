// ===== 页面仓库（architecture.md 第 8 节 PageRepository 接口实现）=====

import type { PageRecord } from '../../shared/types';
import { AppError } from '../../shared/errors';
import { canonicalizeUrl } from '../../shared/url';
import {
  openDatabase,
  dbGet,
  dbGetAll,
  dbGetByIndex,
  dbPut,
  dbDelete,
  dbClear,
  dbCount,
  DB_NAME,
  DB_VERSION,
} from '../db';
import { applyMigrations } from '../migrations';

export type PageListInput = {
  offset?: number;
  limit?: number;
  from?: number;
  to?: number;
  domain?: string;
  sort?: 'recent' | 'frequent';
};

export class PageRepository {
  private dbPromise: Promise<IDBDatabase>;

  constructor(db?: IDBDatabase) {
    this.dbPromise = db
      ? Promise.resolve(db)
      : openDatabase(DB_NAME, DB_VERSION, applyMigrations);
  }

  async ready(): Promise<IDBDatabase> {
    return this.dbPromise;
  }

  close(): void {
    void this.dbPromise.then((db) => db.close());
  }

  /** 新增或更新（以 canonicalUrl 去重）。已有记录时保留 firstVisitedAt / createdAt。 */
  async upsert(record: PageRecord): Promise<PageRecord> {
    const db = await this.dbPromise;
    const existing = await dbGetByIndex<PageRecord>(db, 'pages', 'canonicalUrl', record.canonicalUrl);
    if (existing) {
      const merged: PageRecord = {
        ...record,
        id: existing.id,
        firstVisitedAt: existing.firstVisitedAt,
        createdAt: existing.createdAt,
        // 调用方（协调器）已经做了 +1；这里取较大值兜底，避免导入等路径重复计数
        visitCount: Math.max(record.visitCount, existing.visitCount + 1),
        readingDurationMs: Math.max(record.readingDurationMs, existing.readingDurationMs),
        maxScrollRatio: Math.max(record.maxScrollRatio, existing.maxScrollRatio),
        updatedAt: Date.now(),
      };
      await dbPut(db, 'pages', merged);
      return merged;
    }
    await dbPut(db, 'pages', record);
    return record;
  }

  /** 直接按 id 覆盖写入，不做 canonicalUrl 合并和计数兜底（导入等已算好统计的场景使用） */
  async overwrite(record: PageRecord): Promise<void> {
    const db = await this.dbPromise;
    await dbPut(db, 'pages', record);
  }

  async findById(id: string): Promise<PageRecord | undefined> {
    const db = await this.dbPromise;
    return dbGet<PageRecord>(db, 'pages', id);
  }

  async findByCanonicalUrl(url: string): Promise<PageRecord | undefined> {
    const db = await this.dbPromise;
    return dbGetByIndex<PageRecord>(db, 'pages', 'canonicalUrl', canonicalizeUrl(url));
  }

  async list(input: PageListInput = {}): Promise<PageRecord[]> {
    const db = await this.dbPromise;
    let records = await dbGetAll<PageRecord>(db, 'pages');

    if (input.from !== undefined) records = records.filter((r) => r.lastVisitedAt >= input.from!);
    if (input.to !== undefined) records = records.filter((r) => r.lastVisitedAt <= input.to!);
    if (input.domain) {
      const d = input.domain.toLowerCase();
      records = records.filter((r) => r.domain === d || r.domain.endsWith('.' + d) || d.endsWith('.' + r.domain));
    }

    const sort = input.sort ?? 'recent';
    records.sort((a, b) => {
      if (sort === 'frequent') {
        return b.visitCount - a.visitCount || b.lastVisitedAt - a.lastVisitedAt;
      }
      return b.lastVisitedAt - a.lastVisitedAt;
    });

    const offset = input.offset ?? 0;
    const limit = input.limit ?? records.length;
    return records.slice(offset, offset + limit);
  }

  async deleteById(id: string): Promise<void> {
    const db = await this.dbPromise;
    await dbDelete(db, 'pages', id);
  }

  async deleteBefore(timestamp: number): Promise<number> {
    const db = await this.dbPromise;
    const all = await dbGetAll<PageRecord>(db, 'pages');
    const stale = all.filter((r) => r.lastVisitedAt < timestamp);
    for (const record of stale) {
      await dbDelete(db, 'pages', record.id);
    }
    return stale.length;
  }

  async deleteAll(): Promise<void> {
    const db = await this.dbPromise;
    await dbClear(db, 'pages');
  }

  async count(): Promise<number> {
    const db = await this.dbPromise;
    return dbCount(db, 'pages');
  }

  async getByIds(ids: string[]): Promise<PageRecord[]> {
    const results: PageRecord[] = [];
    for (const id of ids) {
      const record = await this.findById(id);
      if (record) results.push(record);
    }
    return results;
  }
}

export { AppError };
