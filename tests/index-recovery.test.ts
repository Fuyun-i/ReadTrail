// IndexRecovery 单元测试
// 用 fake-indexeddb 构造真实 PageRepository + FlexSearchProvider

import { describe, it, expect, beforeEach } from 'vitest';
import { IndexRecovery, rebuildFromDatabase } from '../src/background/index-recovery';
import { PageRepository } from '../src/storage/repositories/page-repository';
import { FlexSearchProvider } from '../src/search/flex-search-provider';
import { openDatabase } from '../src/storage/db';
import { applyMigrations } from '../src/storage/migrations';
import { DB_VERSION } from '../src/storage/db';
import type { PageRecord } from '../src/shared/types';

const FIXED_NOW = 1700000000000;

function makePage(id: string, overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id,
    canonicalUrl: `https://example.com/${id}`,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    domain: 'example.com',
    text: `content for page ${id}`,
    excerpt: `excerpt ${id}`,
    firstVisitedAt: FIXED_NOW,
    lastVisitedAt: FIXED_NOW,
    visitCount: 1,
    readingDurationMs: 10_000,
    maxScrollRatio: 0.5,
    source: 'auto',
    status: 'captured',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

/** 创建连接到真实 DB 的 PageFetcher */
function makeDbFetcher(pages: PageRepository) {
  return async (
    ids: string[],
    listOptions?: { limit?: number; offset?: number; sort?: 'recent' | 'frequent'; from?: number; to?: number; domain?: string },
  ): Promise<PageRecord[]> => {
    if (ids.length > 0) return pages.getByIds(ids);
    return pages.list({
      sort: listOptions?.sort ?? 'recent',
      offset: listOptions?.offset ?? 0,
      limit: listOptions?.limit ?? 50,
      from: listOptions?.from,
      to: listOptions?.to,
      domain: listOptions?.domain,
    });
  };
}

describe('IndexRecovery', () => {
  let db: IDBDatabase;
  let pages: PageRepository;
  let search: FlexSearchProvider;

  beforeEach(async () => {
    const dbName = `readtrail-test-${Math.random().toString(36).slice(2)}`;
    db = await openDatabase(dbName, DB_VERSION, applyMigrations);
    pages = new PageRepository(db);
    search = new FlexSearchProvider(makeDbFetcher(pages));
    await search.init();
  });

  it('(1) ensureRecovered 首次调用触发流式重建，状态 idle→running→done', async () => {
    await pages.upsert(makePage('p1'));
    await pages.upsert(makePage('p2'));
    await pages.upsert(makePage('p3'));

    const recovery = new IndexRecovery(pages, search);
    expect(recovery.status).toBe('idle');

    await recovery.ensureRecovered();
    expect(recovery.status).toBe('done');

    // 搜索应该能找到重建后的数据
    const results = await search.search({ query: 'Page', limit: 10 });
    expect(results.length).toBe(3);
  });

  it('(2) 已 done 时再次调用直接返回', async () => {
    await pages.upsert(makePage('p1'));

    const recovery = new IndexRecovery(pages, search);
    await recovery.ensureRecovered();
    expect(recovery.status).toBe('done');

    // 第二次调用应立即返回
    await recovery.ensureRecovered();
    expect(recovery.status).toBe('done');
  });

  it('(3) 进行中并发调用复用同一 Promise', async () => {
    await pages.upsert(makePage('p1'));
    await pages.upsert(makePage('p2'));

    const recovery = new IndexRecovery(pages, search);
    const [r1, r2] = await Promise.all([
      recovery.ensureRecovered(),
      recovery.ensureRecovered(),
    ]);
    expect(recovery.status).toBe('done');
    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
  });

  it('(4) 重建失败 → 状态 failed + markNeedsRebuild', async () => {
    await pages.upsert(makePage('p1'));

    const origRebuildStream = search.rebuildStream.bind(search);
    search.rebuildStream = async () => { throw new Error('rebuild failed'); };
    let markCalled = false;
    const origMark = search.markNeedsRebuild.bind(search);
    search.markNeedsRebuild = () => { markCalled = true; };

    const recovery = new IndexRecovery(pages, search);
    await recovery.ensureRecovered();
    expect(recovery.status).toBe('failed');
    expect(markCalled).toBe(true);

    // 恢复
    search.rebuildStream = origRebuildStream;
    search.markNeedsRebuild = origMark;
  });

  it('(5) failed 后可再次调用重试', async () => {
    await pages.upsert(makePage('p1'));

    const recovery = new IndexRecovery(pages, search);

    // 第一次失败
    const origRebuildStream = search.rebuildStream.bind(search);
    search.rebuildStream = async () => { throw new Error('fail'); };
    search.markNeedsRebuild = () => {};
    await recovery.ensureRecovered();
    expect(recovery.status).toBe('failed');

    // 恢复后重试
    search.rebuildStream = origRebuildStream;
    await recovery.ensureRecovered();
    expect(recovery.status).toBe('done');
  });

  it('(6) markDone 后状态对齐', async () => {
    const recovery = new IndexRecovery(pages, search);
    expect(recovery.status).toBe('idle');

    recovery.markDone();
    expect(recovery.status).toBe('done');

    // ensureRecovered 应直接返回
    await recovery.ensureRecovered();
    expect(recovery.status).toBe('done');
  });

  it('(7) rebuildFromDatabase 共享函数正确分页加载', async () => {
    // 插入 1200 条记录，测试分页加载
    for (let i = 0; i < 1200; i++) {
      await pages.upsert(makePage(`p${i}`, { title: `Page ${i} unique` }));
    }

    const count = await rebuildFromDatabase(pages, search, 500);
    expect(count).toBe(1200);

    // 验证搜索可用
    const results = await search.search({ query: 'unique', limit: 200 });
    expect(results.length).toBe(200); // 搜索结果上限 200
  });
});
