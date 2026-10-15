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
  dbGetAllByIndex,
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

/** 域名匹配（支持管道分隔 OR 语义 + 子域匹配） */
function matchesAnyDomain(recordDomain: string, filterDomain: string): boolean {
  const d = recordDomain.toLowerCase();
  return filterDomain.split('|').some((f) => {
    const target = f.trim().toLowerCase();
    if (!target) return true;
    return d === target || d.endsWith('.' + target) || target.endsWith('.' + d);
  });
}

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
        tags: record.tags ?? existing.tags,
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

   */
  async list(input: PageListInput = {}): Promise<PageRecord[]> {
    const db = await this.dbPromise;
    const offset = input.offset ?? 0;
    const limit = input.limit ?? Number.MAX_SAFE_INTEGER;
    const sort = input.sort ?? 'recent';

    // frequent 排序：走 visitCount 降序索引，避免全量 getAll
    if (sort === 'frequent') {
      // 无额外过滤时直接走索引，只取需要的条数
      if (input.from === undefined && input.to === undefined && !input.domain) {
        const fetchLimit = offset + limit;
        const records = await dbGetAllByIndexRange<PageRecord>(
          db, 'pages', 'visitCount', undefined,
          { limit: Number.isFinite(fetchLimit) ? fetchLimit : undefined, reverse: true },
        );
        return records.slice(offset, offset + limit);
      }
      // 有过滤条件时仍需全量加载后 JS filter（无法跨字段 AND）
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

    // 带 domain 过滤 → 优先走 domain 索引，避免全量 getAll
    {
      const d = input.domain.toLowerCase();
      // 单域名时直接走 domain 索引，只加载该域名的记录
      if (!d.includes('|')) {
        let records = await dbGetAllByIndex<PageRecord>(db, 'pages', 'domain', d);
        // 仍需 JS 过滤时间范围 + 子域名匹配
        records = this.applyFilters(records, input);
        records.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
        return records.slice(offset, offset + limit);
      }
      // 多域名（| 分隔）→ 回退到全量加载
      let records = await dbGetAll<PageRecord>(db, 'pages');
      records = this.applyFilters(records, input);
      records.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
      return records.slice(offset, offset + limit);
    }
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
      const d = input.domain;
      filtered = filtered.filter((r) => matchesAnyDomain(r.domain, d));
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


  // ---- 标签管理 ----

  /** 为指定页面添加标签（去重，幂等） */
  async addTag(pageId: string, tag: string): Promise<PageRecord | undefined> {
    const record = await this.findById(pageId);
    if (!record) return undefined;
    const normalized = tag.trim().toLowerCase();
    if (!normalized) return record;
    const tags = record.tags ?? [];
    if (tags.includes(normalized)) return record; // 幂等：已存在则不重复添加
    const updated: PageRecord = {
      ...record,
      tags: [...tags, normalized],
      updatedAt: Date.now(),
    };
    await this.overwrite(updated);
    return updated;
  }

  /** 从指定页面移除标签 */
  async removeTag(pageId: string, tag: string): Promise<PageRecord | undefined> {
    const record = await this.findById(pageId);
    if (!record) return undefined;
    if (!record.tags || record.tags.length === 0) return record;
    const normalized = tag.trim().toLowerCase();
    const updated: PageRecord = {
      ...record,
      tags: record.tags.filter((t) => t !== normalized),
      updatedAt: Date.now(),
    };
    await this.overwrite(updated);
    return updated;
  }

  /** 按标签筛选页面（走 tags 多值索引） */
  async listByTag(tag: string, input: PageListInput = {}): Promise<PageRecord[]> {
    const db = await this.dbPromise;
    const normalized = tag.trim().toLowerCase();
    if (!normalized) return [];

    // 走 tags 多值索引获取所有含该标签的记录
    let records = await dbGetAllByIndex<PageRecord>(db, 'pages', 'tags', normalized);

    // 应用额外过滤（时间范围等）
    records = this.applyFilters(records, input);

    // 排序
    const sort = input.sort ?? 'recent';
    if (sort === 'frequent') {
      records.sort((a, b) => b.visitCount - a.visitCount || b.lastVisitedAt - a.lastVisitedAt);
    } else {
      records.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
    }

    // 分页
    const offset = input.offset ?? 0;
    const limit = input.limit ?? Number.MAX_SAFE_INTEGER;
    return records.slice(offset, offset + limit);
  }

  /** 获取所有标签及其使用计数（走 tags 多值索引游标，不全量加载记录） */
  async listAllTags(): Promise<Array<{ tag: string; count: number }>> {
    const db = await this.dbPromise;
    const tx = db.transaction('pages', 'readonly');
    const index = tx.objectStore('pages').index('tags');
    const tagMap = new Map<string, number>();

    await new Promise<void>((resolve, reject) => {
      // openKeyCursor 只遍历索引键（标签字符串），不加载完整记录，内存开销极小
      const cursorReq = index.openKeyCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const tag = cursor.key as string;
          tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error('tags index cursor error'));
    });

    return Array.from(tagMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /**
   * 列出用于索引重建的记录（截断 text 字段以减少内存占用）。
   * 索引只用 text.slice(0, 20_000)，无需加载完整正文（最高 500KB/条）。
   */
  async listForIndex(maxTextLength: number = 20_000): Promise<PageRecord[]> {
    const records = await this.list({ sort: 'recent', limit: Number.MAX_SAFE_INTEGER });
    // 截断 text 字段，保留其他字段不变
    return records.map((r) => ({
      ...r,
      text: r.text.length > maxTextLength ? r.text.slice(0, maxTextLength) : r.text,
    }));
  }
}

export { AppError };
