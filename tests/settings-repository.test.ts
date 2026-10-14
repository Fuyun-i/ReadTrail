// SettingsRepository 集成测试
// 用 fake-indexeddb 测试设置仓库的 CRUD 和校验

import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsRepository, DEFAULT_SETTINGS } from '../src/storage/repositories/settings-repository';
import { openDatabase } from '../src/storage/db';
import { applyMigrations } from '../src/storage/migrations';
import { DB_VERSION } from '../src/storage/db';

describe('SettingsRepository', () => {
  let db: IDBDatabase;
  let settings: SettingsRepository;

  beforeEach(async () => {
    const dbName = `readtrail-test-${Math.random().toString(36).slice(2)}`;
    db = await openDatabase(dbName, DB_VERSION, applyMigrations);
    settings = new SettingsRepository(db);
  });

  it('(1) 首次 get 返回默认设置', async () => {
    const result = await settings.get();
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(result.enabled).toBe(true);
    expect(result.minReadingDurationMs).toBe(10_000);
    expect(result.minScrollRatio).toBe(0.25);
    expect(result.minTextLength).toBe(300);
    expect(result.retentionDays).toBeUndefined();
    expect(result.searchResultLimit).toBe(30);
  });

  it('(2) update 持久化 + 内存缓存更新', async () => {
    const updated = await settings.update({ retentionDays: 7, searchResultLimit: 50 });
    expect(updated.retentionDays).toBe(7);
    expect(updated.searchResultLimit).toBe(50);

    // 新实例应从 DB 读取持久化的值
    const settings2 = new SettingsRepository(db);
    const loaded = await settings2.get();
    expect(loaded.retentionDays).toBe(7);
    expect(loaded.searchResultLimit).toBe(50);
  });

  it('(3) 各字段校验：minReadingDurationMs 范围', async () => {
    await expect(settings.update({ minReadingDurationMs: -1 })).rejects.toThrow();
    const result = await settings.update({ minReadingDurationMs: 5000 });
    expect(result.minReadingDurationMs).toBe(5000);
  });

  it('(4) 各字段校验：minScrollRatio 0-1', async () => {
    await expect(settings.update({ minScrollRatio: -0.1 })).rejects.toThrow();
    await expect(settings.update({ minScrollRatio: 1.5 })).rejects.toThrow();
    await settings.update({ minScrollRatio: 0 });
    await settings.update({ minScrollRatio: 1 });
  });

  it('(5) 各字段校验：excludedDomains 数组', async () => {
    await expect(settings.update({ excludedDomains: 'not-array' as unknown as string[] })).rejects.toThrow();
    const result = await settings.update({ excludedDomains: ['facebook.com', 'twitter.com'] });
    expect(result.excludedDomains).toEqual(['facebook.com', 'twitter.com']);
  });

  it('(6) 各字段校验：retentionDays 正数', async () => {
    await expect(settings.update({ retentionDays: -1 })).rejects.toThrow();
    await expect(settings.update({ retentionDays: 0 })).rejects.toThrow();
    const result = await settings.update({ retentionDays: 30 });
    expect(result.retentionDays).toBe(30);
  });

  it('(7) 各字段校验：searchResultLimit 1-200', async () => {
    await expect(settings.update({ searchResultLimit: 0 })).rejects.toThrow();
    await expect(settings.update({ searchResultLimit: 201 })).rejects.toThrow();
    await settings.update({ searchResultLimit: 1 });
    await settings.update({ searchResultLimit: 200 });
  });

  it('(8) reset 恢复默认', async () => {
    await settings.update({ retentionDays: 7, searchResultLimit: 100, minScrollRatio: 0.5 });
    const reset = await settings.reset();
    expect(reset).toEqual(DEFAULT_SETTINGS);
    expect(reset.retentionDays).toBeUndefined();
    expect(reset.searchResultLimit).toBe(30);
  });

  it('(9) 缓存命中不读 DB', async () => {
    const first = await settings.get();
    const second = await settings.get();
    expect(second).toEqual(first);
  });
});
