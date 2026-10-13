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

describe('FlexSearchProvider', () => {
  it('空查询返回最近页面（走 emptyQueryResults 轻量路径）', async () => {
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
});
