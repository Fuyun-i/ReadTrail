// RetentionCleaner 单元测试
// 用 fake-indexeddb 构造真实仓库，测试过期数据清理逻辑

import { describe, it, expect, beforeEach } from 'vitest';
import { RetentionCleaner } from '../src/background/retention-cleaner';
import { PageRepository } from '../src/storage/repositories/page-repository';
import { VisitRepository } from '../src/storage/repositories/visit-repository';
import { SettingsRepository } from '../src/storage/repositories/settings-repository';
import { FlexSearchProvider } from '../src/search/flex-search-provider';
import { openDatabase } from '../src/storage/db';
import { applyMigrations } from '../src/storage/migrations';
import { DB_VERSION } from '../src/storage/db';
import type { PageRecord, VisitRecord, UserSettings } from '../src/shared/types';

const FIXED_NOW = 1700000000000;
const DAY = 86_400_000;

function makePage(id: string, lastVisitedAt: number, overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id,
    canonicalUrl: `https://example.com/${id}`,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    domain: 'example.com',
    text: 'content',
    excerpt: 'excerpt',
    firstVisitedAt: lastVisitedAt,
    lastVisitedAt,
    visitCount: 1,
    readingDurationMs: 10_000,
    maxScrollRatio: 0.5,
    source: 'auto',
    status: 'captured',
    createdAt: lastVisitedAt,
    updatedAt: lastVisitedAt,
    ...overrides,
  };
}

function makeVisit(pageId: string, startedAt: number): VisitRecord {
  return {
    id: `v_${pageId}_${startedAt}`,
    pageId,
    tabId: 1,
    url: `https://example.com/${pageId}`,
    startedAt,
    endedAt: startedAt + 5000,
    durationMs: 5000,
    maxScrollRatio: 0.5,
    foregroundMs: 5000,
  };
}

/** 直接写 settings 到 DB，绕过验证（用于测试 cleaner 对非法设置的处理） */
async function writeSettingsDirect(db: IDBDatabase, settings: UserSettings): Promise<void> {
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ id: 'app', settings });
  await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
}

describe('RetentionCleaner', () => {
  let repos: {
    db: IDBDatabase;
    pages: PageRepository;
    visits: VisitRepository;
    settings: SettingsRepository;
    search: FlexSearchProvider;
  };

  beforeEach(async () => {
    const dbName = `readtrail-test-${Math.random().toString(36).slice(2)}`;
    const db = await openDatabase(dbName, DB_VERSION, applyMigrations);
    const pages = new PageRepository(db);
    const visits = new VisitRepository(db);
    const settings = new SettingsRepository(db);
    const search = new FlexSearchProvider(async () => []);
    await search.init();
    repos = { db, pages, visits, settings, search };
  });

  it('(1) retentionDays 未设置 → 返回 0 不删', async () => {
    const cleaner = new RetentionCleaner(repos.pages, repos.visits, repos.settings, repos.search, () => FIXED_NOW);
    await repos.pages.upsert(makePage('p1', FIXED_NOW - 10 * DAY));
    const deleted = await cleaner.clean();
    expect(deleted).toBe(0);
    expect(await repos.pages.count()).toBe(1);
  });

  it('(2) retentionDays=0 → 返回 0 不删', async () => {
    // 直接写 DB 绕过验证（SettingsRepository.validate 拒绝 retentionDays=0）
    await writeSettingsDirect(repos.db, {
      enabled: true, minReadingDurationMs: 10_000, minScrollRatio: 0.25,
      minTextLength: 300, excludedDomains: [], includedDomains: [],
      retentionDays: 0, searchResultLimit: 30,
    });
    // 新建 settings repo 以清除缓存
    const settings = new SettingsRepository(repos.db);
    const cleaner = new RetentionCleaner(repos.pages, repos.visits, settings, repos.search, () => FIXED_NOW);
    await repos.pages.upsert(makePage('p1', FIXED_NOW - 10 * DAY));
    const deleted = await cleaner.clean();
    expect(deleted).toBe(0);
    expect(await repos.pages.count()).toBe(1);
  });

  it('(3) 过期记录被删除、visits 级联删除、索引 remove', async () => {
    await repos.settings.update({ retentionDays: 7 });
    // 过期记录（10 天前）
    const oldPage = makePage('p_old', FIXED_NOW - 10 * DAY);
    await repos.pages.upsert(oldPage);
    await repos.visits.create(makeVisit('p_old', FIXED_NOW - 10 * DAY));
    await repos.search.index(oldPage);
    // 新记录（1 天前）
    const newPage = makePage('p_new', FIXED_NOW - 1 * DAY);
    await repos.pages.upsert(newPage);
    await repos.visits.create(makeVisit('p_new', FIXED_NOW - 1 * DAY));
    await repos.search.index(newPage);

    const cleaner = new RetentionCleaner(repos.pages, repos.visits, repos.settings, repos.search, () => FIXED_NOW);
    const deleted = await cleaner.clean();
    expect(deleted).toBe(1);
    expect(await repos.pages.count()).toBe(1);
    expect(await repos.pages.findById('p_old')).toBeUndefined();
    expect(await repos.pages.findById('p_new')).toBeDefined();
    // visits 也应被删除
    expect(await repos.visits.countByPageId('p_old')).toBe(0);
    expect(await repos.visits.countByPageId('p_new')).toBe(1);
  });

  it('(4) 未过期记录保留', async () => {
    await repos.settings.update({ retentionDays: 30 });
    const recent = makePage('p1', FIXED_NOW - 5 * DAY);
    await repos.pages.upsert(recent);
    const cleaner = new RetentionCleaner(repos.pages, repos.visits, repos.settings, repos.search, () => FIXED_NOW);
    const deleted = await cleaner.clean();
    expect(deleted).toBe(0);
    expect(await repos.pages.count()).toBe(1);
  });

  it('(5) 批量删除 600 条过期，分批 500 正确', async () => {
    await repos.settings.update({ retentionDays: 7 });
    for (let i = 0; i < 600; i++) {
      await repos.pages.upsert(makePage(`p${i}`, FIXED_NOW - 10 * DAY));
    }
    const cleaner = new RetentionCleaner(repos.pages, repos.visits, repos.settings, repos.search, () => FIXED_NOW);
    const deleted = await cleaner.clean();
    expect(deleted).toBe(600);
    expect(await repos.pages.count()).toBe(0);
  });

  it('(6) 并发调用 clean() 合并为单次', async () => {
    await repos.settings.update({ retentionDays: 7 });
    await repos.pages.upsert(makePage('p1', FIXED_NOW - 10 * DAY));
    await repos.pages.upsert(makePage('p2', FIXED_NOW - 10 * DAY));

    const cleaner = new RetentionCleaner(repos.pages, repos.visits, repos.settings, repos.search, () => FIXED_NOW);
    const [r1, r2] = await Promise.all([cleaner.clean(), cleaner.clean()]);
    expect(r1).toBe(r2);
    expect(r1).toBe(2);
    expect(await repos.pages.count()).toBe(0);
  });

  it('(7) 单条删除失败不阻塞其他', async () => {
    await repos.settings.update({ retentionDays: 7 });
    await repos.pages.upsert(makePage('p1', FIXED_NOW - 10 * DAY));
    await repos.pages.upsert(makePage('p2', FIXED_NOW - 10 * DAY));

    // mock pages.deleteById 对 p1 抛异常
    const origDeleteById = repos.pages.deleteById.bind(repos.pages);
    repos.pages.deleteById = async (id: string) => {
      if (id === 'p1') throw new Error('simulated delete failure');
      return origDeleteById(id);
    };

    const cleaner = new RetentionCleaner(repos.pages, repos.visits, repos.settings, repos.search, () => FIXED_NOW);
    const deleted = await cleaner.clean();
    expect(deleted).toBe(1);
    expect(await repos.pages.findById('p1')).toBeDefined();
    expect(await repos.pages.findById('p2')).toBeUndefined();
  });
});
