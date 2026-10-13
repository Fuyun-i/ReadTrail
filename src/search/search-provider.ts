// ===== SearchProvider 接口（architecture.md 第 9 节）=====

import type { PageRecord, SearchInput, SearchResult, SearchHealth } from '../shared/types';

export interface SearchProvider {
  index(record: PageRecord): Promise<void>;
  update(record: PageRecord): Promise<void>;
  remove(pageId: string): Promise<void>;
  search(input: SearchInput): Promise<SearchResult[]>;
  rebuild(records: PageRecord[]): Promise<void>;
  clear(): Promise<void>;
  health(databaseCount: number): Promise<SearchHealth>;
  /** 索引与数据库不一致时标记，等待重建 */
  markNeedsRebuild(): void;
}
