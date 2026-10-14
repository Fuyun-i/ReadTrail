// PageRepository 集成测试
// 用 fake-indexeddb 测试所有 CRUD 和查询路径

import { describe, it, expect, beforeEach } from 'vitest';
import { PageRepository } from '../src/storage/repositories/page-repository';
import { openDatabase } from '../src/storage/db';
import { applyMigrations } from '../src/storage/migrations';
import { DB_VERSION } from '../src/storage/db';
import type { PageRecord } from '../src/shared/types';

const T0 = 1700000000000;

function makePage(id: string, overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id,
    canonicalUrl: `https://example.com/${id}`,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    domain: 'example.com',
    text: 'content',
    excerpt: 'excerpt',
    firstVisitedAt: T0,
    lastVisitedAt: T0,
    visitCount: 1,
    readingDurationMs: 10_000,
    maxScrollRatio: 0.5,
    source: 'auto',
    status: 'captured',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe('PageRepository', () => {
  let pages: PageRepository;

  beforeEach(async () => {
    const dbName = `readtrail-test-${Math.random().toString(36).slice(2)}`;
    const db = await openDatabase(dbName, DB_VERSION, applyMigrations);
    pages = new PageRepository(db);
  });

  it('(1) upsert 新记录', async () => {
    const page = makePage('p1');
    const result = await pages.upsert(page);
    expect(result.id).toBe('p1');
    expect(await pages.count()).toBe(1);
    const found = await pages.findById('p1');
    expect(found).toBeDefined();
    expect(found!.title).toBe('Page p1');
  });

  it('(2) upsert 已有 canonicalUrl → 合并 firstVisitedAt/createdAt、visitCount 取较大值', async () => {
    const existing = makePage('p1', {
      canonicalUrl: 'https://example.com/article',
      firstVisitedAt: T0 - 100_000,
      createdAt: T0 - 100_000,
      visitCount: 5,
      lastVisitedAt: T0,
    });
    await pages.overwrite(existing);

    // upsert 同 canonicalUrl，新记录
    const updated = makePage('p1_new', {
      canonicalUrl: 'https://example.com/article',
      firstVisitedAt: T0,
      createdAt: T0,
      visitCount: 1,
      lastVisitedAt: T0 + 1000,
    });
    const result = await pages.upsert(updated);

    // 合并：保留原有 firstVisitedAt/createdAt，visitCount 取较大值
    expect(result.id).toBe('p1'); // 保留原 ID
    expect(result.firstVisitedAt).toBe(T0 - 100_000);
    expect(result.createdAt).toBe(T0 - 100_000);
    expect(result.visitCount).toBeGreaterThanOrEqual(6); // max(1, 5+1) = 6
    expect(result.lastVisitedAt).toBe(T0 + 1000);

    // DB 中只有 1 条记录
    expect(await pages.count()).toBe(1);
  });

  it('(3) overwrite 直接覆盖不合并', async () => {
    const original = makePage('p1', { visitCount: 5, firstVisitedAt: T0 - 100_000 });
    await pages.overwrite(original);

    const overwrite = makePage('p1', { visitCount: 1, firstVisitedAt: T0 });
    await pages.overwrite(overwrite);

    const found = await pages.findById('p1');
    expect(found!.visitCount).toBe(1);
    expect(found!.firstVisitedAt).toBe(T0);
  });

  it('(4) findById / findByCanonicalUrl', async () => {
    const page = makePage('p1', { canonicalUrl: 'https://test.com/page' });
    await pages.upsert(page);

    const byId = await pages.findById('p1');
    expect(byId).toBeDefined();
    expect(byId!.canonicalUrl).toBe('https://test.com/page');

    const byUrl = await pages.findByCanonicalUrl('https://test.com/page');
    expect(byUrl).toBeDefined();
    expect(byUrl!.id).toBe('p1');

    // 不存在的
    expect(await pages.findById('nonexistent')).toBeUndefined();
    expect(await pages.findByCanonicalUrl('https://nope.com/x')).toBeUndefined();
  });

  it('(5) list 纯时间范围 → 走 lastVisitedAt 索引', async () => {
    await pages.upsert(makePage('p1', { lastVisitedAt: T0 - 3000 }));
    await pages.upsert(makePage('p2', { lastVisitedAt: T0 - 2000 }));
    await pages.upsert(makePage('p3', { lastVisitedAt: T0 - 1000 }));
    await pages.upsert(makePage('p4', { lastVisitedAt: T0 }));

    // from ~ to 范围
    const results = await pages.list({ from: T0 - 2500, to: T0 - 500 });
    expect(results.length).toBe(2); // p2, p3
    // 最近优先（降序）
    expect(results[0]!.id).toBe('p3');
    expect(results[1]!.id).toBe('p2');

    // 只有 from
    const fromResults = await pages.list({ from: T0 - 1500 });
    expect(fromResults.length).toBe(2); // p3, p4
    expect(fromResults[0]!.id).toBe('p4');

    // 只有 to
    const toResults = await pages.list({ to: T0 - 1500 });
    expect(toResults.length).toBe(2); // p1, p2
    expect(toResults[0]!.id).toBe('p2');
  });

  it('(6) list 带 domain → 走 domain 索引', async () => {
    await pages.upsert(makePage('p1', { domain: 'rust-lang.org' }));
    await pages.upsert(makePage('p2', { domain: 'github.com' }));
    await pages.upsert(makePage('p3', { domain: 'rust-lang.org' }));

    const results = await pages.list({ domain: 'rust-lang.org' });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.domain === 'rust-lang.org')).toBe(true);
  });

  it('(7) list 多域名管道分隔 → OR 匹配', async () => {
    await pages.upsert(makePage('p1', { domain: 'rust-lang.org' }));
    await pages.upsert(makePage('p2', { domain: 'github.com' }));
    await pages.upsert(makePage('p3', { domain: 'stackoverflow.com' }));
    await pages.upsert(makePage('p4', { domain: 'example.com' }));

    const results = await pages.list({ domain: 'rust-lang.org|github.com' });
    expect(results.length).toBe(2);
    const domains = results.map((r) => r.domain).sort();
    expect(domains).toEqual(['github.com', 'rust-lang.org']);
  });

  it('(8) list sort=frequent → 走 visitCount 索引', async () => {
    await pages.upsert(makePage('p1', { visitCount: 1 }));
    await pages.upsert(makePage('p2', { visitCount: 10 }));
    await pages.upsert(makePage('p3', { visitCount: 5 }));

    const results = await pages.list({ sort: 'frequent' });
    expect(results.length).toBe(3);
    // 按访问次数降序
    expect(results[0]!.id).toBe('p2');
    expect(results[1]!.id).toBe('p3');
    expect(results[2]!.id).toBe('p1');
  });

  it('(9) list 分页 offset+limit', async () => {
    for (let i = 0; i < 10; i++) {
      await pages.upsert(makePage(`p${i}`, { lastVisitedAt: T0 + i }));
    }

    const page1 = await pages.list({ sort: 'recent', offset: 0, limit: 3 });
    expect(page1.length).toBe(3);
    expect(page1[0]!.id).toBe('p9'); // 最近优先

    const page2 = await pages.list({ sort: 'recent', offset: 3, limit: 3 });
    expect(page2.length).toBe(3);
    expect(page2[0]!.id).toBe('p6');

    const page3 = await pages.list({ sort: 'recent', offset: 9, limit: 3 });
    expect(page3.length).toBe(1);
    expect(page3[0]!.id).toBe('p0');
  });

  it('(10) deleteBefore 按时间范围删', async () => {
    await pages.upsert(makePage('p1', { lastVisitedAt: T0 - 3000 }));
    await pages.upsert(makePage('p2', { lastVisitedAt: T0 - 2000 }));
    await pages.upsert(makePage('p3', { lastVisitedAt: T0 - 1000 }));
    await pages.upsert(makePage('p4', { lastVisitedAt: T0 }));

    const deleted = await pages.deleteBefore(T0 - 1500);
    expect(deleted).toBe(2); // p1, p2
    expect(await pages.count()).toBe(2);
    expect(await pages.findById('p1')).toBeUndefined();
    expect(await pages.findById('p2')).toBeUndefined();
    expect(await pages.findById('p3')).toBeDefined();
    expect(await pages.findById('p4')).toBeDefined();
  });

  it('(11) getByIds 批量读取', async () => {
    await pages.upsert(makePage('p1'));
    await pages.upsert(makePage('p2'));
    await pages.upsert(makePage('p3'));

    const results = await pages.getByIds(['p1', 'p3', 'nonexistent']);
    expect(results.length).toBe(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(['p1', 'p3']);

    // 空数组
    expect(await pages.getByIds([])).toEqual([]);
  });

  it('(12) listForIndex 截断 text', async () => {
    const longText = 'x'.repeat(50_000);
    await pages.upsert(makePage('p1', { text: longText }));
    await pages.upsert(makePage('p2', { text: 'short' }));

    const records = await pages.listForIndex(20_000);
    expect(records.length).toBe(2);
    const p1 = records.find((r) => r.id === 'p1')!;
    const p2 = records.find((r) => r.id === 'p2')!;
    expect(p1.text.length).toBe(20_000);
    expect(p2.text).toBe('short');
  });
});
