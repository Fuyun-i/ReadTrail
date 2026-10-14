// ===== SearchProvider 接口（architecture.md 第 9 节）=====

import type { PageRecord, SearchInput, SearchResult, SearchHealth } from '../shared/types';

/** 分页加载回调：按 offset/limit 返回一批记录，供流式重建索引使用 */
export type BatchFetcher = (offset: number, limit: number) => Promise<PageRecord[]>;

export interface SearchProvider {
  index(record: PageRecord): Promise<void>;
  update(record: PageRecord): Promise<void>;
  remove(pageId: string): Promise<void>;
  search(input: SearchInput): Promise<SearchResult[]>;
  rebuild(records: PageRecord[]): Promise<void>;
  /** 流式重建：分页加载记录并增量建索引，避免一次性全量载入内存 */
  rebuildStream(fetchBatch: BatchFetcher, chunkSize?: number): Promise<number>;
  clear(): Promise<void>;
  health(databaseCount: number): Promise<SearchHealth>;
  /** 索引与数据库不一致时标记，等待重建 */
  markNeedsRebuild(): void;
}
