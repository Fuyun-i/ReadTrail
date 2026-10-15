// 搜索历史存储测试 — 使用 fake-indexeddb
import { describe, it, expect, beforeEach } from 'vitest';
import { SearchHistoryRepository } from '../src/storage/repositories/search-history-repository';

describe('SearchHistoryRepository', () => {
  let repo: SearchHistoryRepository;

  beforeEach(async () => {
    repo = new SearchHistoryRepository();
    // 清空上一次测试残留
    await repo.clear();
  });

  it('初始 getAll 返回空数组', async () => {
    const result = await repo.getAll();
    expect(result).toEqual([]);
  });

  it('add 添加搜索词', async () => {
    await repo.add('rust async');
    const result = await repo.getAll();
    expect(result.length).toBe(1);
    expect(result[0]!.query).toBe('rust async');
    expect(result[0]!.timestamp).toBeGreaterThan(0);
  });

  it('add 去重 — 相同搜索词移到最前', async () => {
    await repo.add('rust');
    await repo.add('go');
    await repo.add('rust'); // 重复
    const result = await repo.getAll();
    expect(result.length).toBe(2);
    expect(result[0]!.query).toBe('rust');
    expect(result[1]!.query).toBe('go');
  });

  it('add 最多保留 20 条', async () => {
    for (let i = 0; i < 25; i++) {
      await repo.add(`query-${i}`);
    }
    const result = await repo.getAll();
    expect(result.length).toBe(20);
    expect(result[0]!.query).toBe('query-24');
  });

  it('add 空字符串不添加', async () => {
    await repo.add('rust');
    await repo.add('   ');
    const result = await repo.getAll();
    expect(result.length).toBe(1);
  });

  it('clear 清空所有历史', async () => {
    await repo.add('rust');
    await repo.add('go');
    await repo.clear();
    const result = await repo.getAll();
    expect(result).toEqual([]);
  });
});
