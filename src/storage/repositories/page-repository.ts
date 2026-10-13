// ===== 页面仓库（architecture.md 第 8 节 PageRepository 接口实现）=====

import type { PageRecord } from '../../shared/types';
import { AppError } from '../../shared/errors';
import { canonicalizeUrl } from '../../shared/url';
import {
  openDatabase,
  dbGet,
  dbGetAll,
  dbGetByIndex,
  dbGetAllByIndexRange,
  dbGetBatch,
  dbPut,
  dbDelete,
  dbDeleteByIndexRange,
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

  /**
   * 列出页面记录。
   * 优化：优先使用 lastVisitedAt 索引 + IDBKeyRange 做服务端过滤与排序，
   * 避免全表 getAll 到内存再 JS filter/sort。
   * - 纯时间范围查询（无 domain 过滤）→ 直接走索引范围查询
   * - 带 domain 过滤 → 仍需 getAll 后 JS filter（IndexedDB 索引无法做跨字段 AND）
   * - frequent 排序 → 需 getAll 后 JS sort（无 visitCount 索引）
   */
  async list(input: PageListInput = {}): Promise<PageRecord[]> {
    const db = await this.dbPromise;
    const offset = input.offset ?? 0;
    const limit = input.limit ?? Number.MAX_SAFE_INTEGER;
    const sort = input.sort ?? 'recent';

    // frequent 排序需要 visitCount，没有对应索引，只能全量加载后排序
    if (sort === 'frequent') {
      let records = await dbGetAll<PageRecord>(db, 'pages');
      records = this.applyFilters(records, input);
      records.sort((a, b) => b.visitCount - a.visitCount || b.lastVisitedAt - a.lastVisitedAt);
      return records.slice(offset, offset + limit);
    }

    // recent 排序 + 无 domain 过滤 → 走 lastVisitedAt 索引范围查询
    if (!input.domain) {
      const range = this.buildTimeRange(input);
      // 索引按 lastVisitedAt 升序，reverse=true 得到降序（最近优先）
      const fetchLimit = offset + limit; // 多取 offset 条用于切片
      const records = await dbGetAllByIndexRange<PageRecord>(
        db, 'pages', 'lastVisitedAt', range,
        { limit: Number.isFinite(fetchLimit) ? fetchLimit : undefined, reverse: true },
      );
      return records.slice(offset, offset + limit);
    }

    // 带 domain 过滤 → 需全量加载后 JS filter（IndexedDB 无法跨字段 AND）
    let records = await dbGetAll<PageRecord>(db, 'pages');
    records = this.applyFilters(records, input);
    records.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
    return records.slice(offset, offset + limit);
  }

  /** 构建 lastVisitedAt 的 IDBKeyRange（from ~ to） */
  private buildTimeRange(input: PageListInput): IDBKeyRange | undefined {
    const from = input.from;
    const to = input.to;
    if (from !== undefined && to !== undefined) return IDBKeyRange.bound(from, to);
    if (from !== undefined) return IDBKeyRange.lowerBound(from);
    if (to !== undefined) return IDBKeyRange.upperBound(to);
    return undefined;
  }

  /** JS 内存过滤（domain + 时间），用于无法走索引的场景 */
  private applyFilters(records: PageRecord[], input: PageListInput): PageRecord[] {
    let filtered = records;
    if (input.from !== undefined) filtered = filtered.filter((r) => r.lastVisitedAt >= input.from!);
    if (input.to !== undefined) filtered = filtered.filter((r) => r.lastVisitedAt <= input.to!);
    if (input.domain) {
      const d = input.domain.toLowerCase();
      filtered = filtered.filter((r) => r.domain === d || r.domain.endsWith('.' + d) || d.endsWith('.' + r.domain));
    }
    return filtered;
  }

  async deleteById(id: string): Promise<void> {
    const db = await this.dbPromise;
    await dbDelete(db, 'pages', id);
  }

  /** 按时间范围删除（使用索引游标，不全量加载到内存） */
  async deleteBefore(timestamp: number): Promise<number> {
    const db = await this.dbPromise;
    return dbDeleteByIndexRange(db, 'pages', 'lastVisitedAt', IDBKeyRange.upperBound(timestamp));
  }

  async deleteAll(): Promise<void> {
    const db = await this.dbPromise;
    await dbClear(db, 'pages');
  }

  async count(): Promise<number> {
    const db = await this.dbPromise;
    return dbCount(db, 'pages');
  }

  /** 批量按 ID 读取（单事务，避免 N 次独立事务） */
  async getByIds(ids: string[]): Promise<PageRecord[]> {
    if (ids.length === 0) return [];
    const db = await this.dbPromise;
    return dbGetBatch<PageRecord>(db, 'pages', ids);
  }
}

export { AppError };
