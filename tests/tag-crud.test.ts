// 标签 CRUD 测试 — 使用 fake-indexeddb + PageRepository
import { describe, it, expect, beforeEach } from 'vitest';
import { PageRepository } from '../src/storage/repositories/page-repository';
import type { PageRecord } from '../src/shared/types';

function makePage(overrides: Partial<PageRecord> = {}): PageRecord {
  const now = Date.now();
  return {
    id: 'test-page-1',
    canonicalUrl: 'https://example.com/article',
    url: 'https://example.com/article',
    domain: 'example.com',
    title: 'Test Article',
    text: 'This is a test article with sufficient content for testing purposes.',
    excerpt: 'This is a test article',
    source: 'auto',
    status: 'captured',
    visitCount: 1,
    firstVisitedAt: now,
    lastVisitedAt: now,
    createdAt: now,
    updatedAt: now,
    readingDurationMs: 10000,
    maxScrollRatio: 0.5,
    ...overrides,
  };
}

describe('标签 CRUD (PageRepository)', () => {
  let repo: PageRepository;

  beforeEach(async () => {
    repo = new PageRepository();
    // 清空上一次测试残留
    const { openDatabase, DB_NAME, DB_VERSION } = await import('../src/storage/db');
    const { applyMigrations } = await import('../src/storage/migrations');
    const db = await openDatabase(DB_NAME, DB_VERSION, applyMigrations);
    const tx = db.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    await new Promise<void>((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  });

  it('addTag 为页面添加标签', async () => {
    await repo.upsert(makePage());
    await repo.addTag('test-page-1', 'rust');
    const page = await repo.findById('test-page-1');
    expect(page?.tags).toEqual(['rust']);
  });

  it('addTag 多个标签', async () => {
    await repo.upsert(makePage());
    await repo.addTag('test-page-1', 'rust');
    await repo.addTag('test-page-1', 'async');
    await repo.addTag('test-page-1', 'systems');
    const page = await repo.findById('test-page-1');
    expect(page?.tags).toEqual(['rust', 'async', 'systems']);
  });

  it('addTag 不重复添加', async () => {
    await repo.upsert(makePage());
    await repo.addTag('test-page-1', 'rust');
    await repo.addTag('test-page-1', 'rust');
    const page = await repo.findById('test-page-1');
    expect(page?.tags).toEqual(['rust']);
  });

  it('removeTag 移除标签', async () => {
    await repo.upsert(makePage({ tags: ['rust', 'go', 'python'] }));
    await repo.removeTag('test-page-1', 'go');
    const page = await repo.findById('test-page-1');
    expect(page?.tags).toEqual(['rust', 'python']);
  });

  it('removeTag 不存在的标签无影响', async () => {
    await repo.upsert(makePage({ tags: ['rust'] }));
    await repo.removeTag('test-page-1', 'nonexistent');
    const page = await repo.findById('test-page-1');
    expect(page?.tags).toEqual(['rust']);
  });

  it('listByTag 按标签查找页面', async () => {
    await repo.upsert(makePage({ id: 'p1', tags: ['rust', 'async'] }));
    await repo.upsert(makePage({ id: 'p2', canonicalUrl: 'https://example.com/2', url: 'https://example.com/2', tags: ['rust', 'systems'] }));
    await repo.upsert(makePage({ id: 'p3', canonicalUrl: 'https://example.com/3', url: 'https://example.com/3', tags: ['go'] }));

    const rustPages = await repo.listByTag('rust');
    expect(rustPages.length).toBe(2);
    expect(rustPages.some((p) => p.id === 'p1')).toBe(true);
    expect(rustPages.some((p) => p.id === 'p2')).toBe(true);
  });

  it('listAllTags 汇总所有标签及计数', async () => {
    await repo.upsert(makePage({ id: 'p1', tags: ['rust', 'async'] }));
    await repo.upsert(makePage({ id: 'p2', canonicalUrl: 'https://example.com/2', url: 'https://example.com/2', tags: ['rust', 'go'] }));
    await repo.upsert(makePage({ id: 'p3', canonicalUrl: 'https://example.com/3', url: 'https://example.com/3', tags: ['rust'] }));

    const tags = await repo.listAllTags();
    const rustTag = tags.find((t) => t.tag === 'rust');
    expect(rustTag?.count).toBe(3);
    const asyncTag = tags.find((t) => t.tag === 'async');
    expect(asyncTag?.count).toBe(1);
  });

  it('upsert 保留已有标签', async () => {
    await repo.upsert(makePage({ tags: ['rust', 'async'] }));
    // 模拟二次访问，不带 tags
    await repo.upsert(makePage({ tags: undefined }));
    const page = await repo.findById('test-page-1');
    expect(page?.tags).toEqual(['rust', 'async']);
  });
});
