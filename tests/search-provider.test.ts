// FlexSearchProvider 单元测试（纯逻辑，不依赖 IndexedDB）
import { describe, it, expect } from 'vitest';
import { FlexSearchProvider } from '../src/search/flex-search-provider';
import type { PageRecord } from '../src/shared/types';

function makePage(overrides: Partial<PageRecord> & { id: string }): PageRecord {
  const now = Date.now();
  return {
    canonicalUrl: `https://example.com/${overrides.id}`,
    url: `https://example.com/${overrides.id}`,
    title: overrides.id,
    domain: 'example.com',
    text: '',
    excerpt: '',
    firstVisitedAt: now,
    lastVisitedAt: now,
    visitCount: 1,
    readingDurationMs: 0,
    maxScrollRatio: 0,
    source: 'auto',
    status: 'captured',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** mock fetchPages：模拟 SW 侧行为，按 listOptions.sort 排序 + limit 截断 */
function makeFetchPages(pages: PageRecord[]) {
  return async (_ids: string[], listOptions?: { limit?: number; offset?: number; sort?: string }) => {
    let list = [...pages];
    if (listOptions?.sort === 'recent') {
      list.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
    }
    const offset = listOptions?.offset ?? 0;
    const limit = listOptions?.limit ?? list.length;
    return list.slice(offset, offset + limit);
  };
}

/** mock fetchBatch：模拟分页加载，按 offset/limit 截断 */
function makeFetchBatch(pages: PageRecord[]) {
  return async (offset: number, limit: number): Promise<PageRecord[]> => {
    return pages.slice(offset, offset + limit);
  };
}

describe('FlexSearchProvider', () => {
  it('空查询返回最近页面（走 emptyQueryResults 载量路径）', async () => {
    const pages: PageRecord[] = [
      makePage({ id: 'p1', title: 'Page 1', lastVisitedAt: 1000 }),
      makePage({ id: 'p2', title: 'Page 2', lastVisitedAt: 2000 }),
      makePage({ id: 'p3', title: 'Page 3', lastVisitedAt: 3000 }),
    ];
    const provider = new FlexSearchProvider(makeFetchPages(pages));
    await provider.rebuild(pages);
    const results = await provider.search({ query: '', limit: 2, sort: 'recent' });
    expect(results.length).toBe(2);
    // 最近优先
    expect(results[0]!.page.id).toBe('p3');
    expect(results[1]!.page.id).toBe('p2');
  });

  it('关键词搜索匹配标题', async () => {
    const pages: PageRecord[] = [
      makePage({ id: 'p1', title: 'Rust 异步编程', text: 'async rust' }),
      makePage({ id: 'p2', title: 'Go 语言入门', text: 'go golang' }),
    ];
    const provider = new FlexSearchProvider(makeFetchPages(pages));
    await provider.rebuild(pages);
    const results = await provider.search({ query: 'Rust', limit: 10, sort: 'relevance' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.page.id).toBe('p1');
  });

  it('remove 后搜索不再命中', async () => {
    const pages: PageRecord[] = [
      makePage({ id: 'p1', title: 'TypeScript 教程', text: 'typescript tutorial' }),
    ];
    const provider = new FlexSearchProvider(makeFetchPages(pages));
    await provider.rebuild(pages);
    await provider.remove('p1');
    const results = await provider.search({ query: 'TypeScript', limit: 10, sort: 'relevance' });
    expect(results.length).toBe(0);
  });

  it('health 报告索引与数据库一致', async () => {
    const pages: PageRecord[] = [
      makePage({ id: 'p1', title: 'A', text: 'a' }),
      makePage({ id: 'p2', title: 'B', text: 'b' }),
    ];
    const provider = new FlexSearchProvider(makeFetchPages(pages));
    await provider.rebuild(pages);
    const h = await provider.health(2);
    expect(h.indexedCount).toBe(2);
    expect(h.databaseCount).toBe(2);
    expect(h.needsRebuild).toBe(false);
  });

  it('clear 后索引为空', async () => {
    const pages: PageRecord[] = [
      makePage({ id: 'p1', title: 'Test', text: 'test content' }),
    ];
    const provider = new FlexSearchProvider(makeFetchPages(pages));
    await provider.rebuild(pages);
    await provider.clear();
    const results = await provider.search({ query: 'Test', limit: 10, sort: 'relevance' });
    expect(results.length).toBe(0);
  });

  // ---- rebuildStream 流式重建测试 ----

  it('rebuildStream 分页加载并正确建索引', async () => {
    const pages: PageRecord[] = [
      makePage({ id: 'p1', title: 'Rust 入门', text: 'rust beginner' }),
      makePage({ id: 'p2', title: 'Go 入门', text: 'go beginner' }),
      makePage({ id: 'p3', title: 'Python 入门', text: 'python beginner' }),
    ];
    const provider = new FlexSearchProvider(makeFetchPages(pages));
    const total = await provider.rebuildStream(makeFetchBatch(pages), 2);
    expect(total).toBe(3);
    // 搜索应能命中
    const results = await provider.search({ query: 'Rust', limit: 10, sort: 'relevance' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.page.id).toBe('p1');
  });

  it('rebuildStream 与 rebuild 结果一致', async () => {
    const pages: PageRecord[] = [
      makePage({ id: 'p1', title: 'TypeScript 高级', text: 'typescript advanced' }),
      makePage({ id: 'p2', title: 'JavaScript 基础', text: 'javascript basic' }),
      makePage({ id: 'p3', title: 'Python 数据分析', text: 'python data' }),
      makePage({ id: 'p4', title: 'Rust 系统编程', text: 'rust system' }),
    ];
    // 用 rebuild 建索引
    const provider1 = new FlexSearchProvider(makeFetchPages(pages));
    await provider1.rebuild(pages);
    // 用 rebuildStream 建索引（chunkSize=1，逐条加载）
    const provider2 = new FlexSearchProvider(makeFetchPages(pages));
    await provider2.rebuildStream(makeFetchBatch(pages), 1);

    const h1 = await provider1.health(4);
    const h2 = await provider2.health(4);
    expect(h2.indexedCount).toBe(h1.indexedCount);
    expect(h2.needsRebuild).toBe(false);

    // 搜索结果一致
    const r1 = await provider1.search({ query: 'TypeScript', limit: 10, sort: 'relevance' });
    const r2 = await provider2.search({ query: 'TypeScript', limit: 10, sort: 'relevance' });
    expect(r2.length).toBe(r1.length);
    if (r1.length > 0) expect(r2[0]!.page.id).toBe(r1[0]!.page.id);
  });

  it('rebuildStream 空数据库返回 0', async () => {
    const provider = new FlexSearchProvider(makeFetchPages([]));
    const total = await provider.rebuildStream(makeFetchBatch([]), 500);
    expect(total).toBe(0);
  });
});
