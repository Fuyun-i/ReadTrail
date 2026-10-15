// VisitRepository 集成测试
// 用 fake-indexeddb 测试访问记录的 CRUD 和查询

import { describe, it, expect, beforeEach } from 'vitest';
import { VisitRepository, makeVisitId } from '../src/storage/repositories/visit-repository';
import { openDatabase } from '../src/storage/db';
import { applyMigrations } from '../src/storage/migrations';
import { DB_VERSION } from '../src/storage/db';
import type { VisitRecord } from '../src/shared/types';

const T0 = 1700000000000;

function makeVisit(id: string, pageId: string, startedAt: number, overrides: Partial<VisitRecord> = {}): VisitRecord {
  return {
    id,
    pageId,
    tabId: 1,
    url: `https://example.com/${pageId}`,
    startedAt,
    endedAt: startedAt + 5000,
    durationMs: 5000,
    maxScrollRatio: 0.5,
    foregroundMs: 5000,
    ...overrides,
  };
}

describe('VisitRepository', () => {
  let visits: VisitRepository;

  beforeEach(async () => {
    const dbName = `readtrail-test-${Math.random().toString(36).slice(2)}`;
    const db = await openDatabase(dbName, DB_VERSION, applyMigrations);
    visits = new VisitRepository(db);
  });

  it('(1) create + listByPageId 按 startedAt 排序', async () => {
    await visits.create(makeVisit('v1', 'p1', T0 + 3000));
    await visits.create(makeVisit('v2', 'p1', T0 + 1000));
    await visits.create(makeVisit('v3', 'p1', T0 + 2000));
    await visits.create(makeVisit('v4', 'p2', T0 + 1000));

    const list = await visits.listByPageId('p1');
    expect(list.length).toBe(3);
    // 按 startedAt 升序
    expect(list[0]!.id).toBe('v2');
    expect(list[1]!.id).toBe('v3');
    expect(list[2]!.id).toBe('v1');
  });

  it('(2) countByPageId 使用索引 count', async () => {
    await visits.create(makeVisit('v1', 'p1', T0));
    await visits.create(makeVisit('v2', 'p1', T0 + 1000));
    await visits.create(makeVisit('v3', 'p2', T0));

    expect(await visits.countByPageId('p1')).toBe(2);
    expect(await visits.countByPageId('p2')).toBe(1);
    expect(await visits.countByPageId('p3')).toBe(0);
  });

  it('(3) deleteByPageId 单事务批量删除', async () => {
    await visits.create(makeVisit('v1', 'p1', T0));
    await visits.create(makeVisit('v2', 'p1', T0 + 1000));
    await visits.create(makeVisit('v3', 'p1', T0 + 2000));
    await visits.create(makeVisit('v4', 'p2', T0));

    await visits.deleteByPageId('p1');

    expect(await visits.countByPageId('p1')).toBe(0);
    expect(await visits.countByPageId('p2')).toBe(1);
  });

  it('(4) listIdsByPageIds 批量去重 Set', async () => {
    await visits.create(makeVisit('v1', 'p1', T0));
    await visits.create(makeVisit('v2', 'p1', T0 + 1000));
    await visits.create(makeVisit('v3', 'p2', T0));
    await visits.create(makeVisit('v4', 'p3', T0));

    const ids = await visits.listIdsByPageIds(['p1', 'p2']);
    expect(ids.size).toBe(3);
    expect(ids.has('v1')).toBe(true);
    expect(ids.has('v2')).toBe(true);
    expect(ids.has('v3')).toBe(true);
    expect(ids.has('v4')).toBe(false);

    // 空数组
    expect(await visits.listIdsByPageIds([])).toEqual(new Set());
  });

  it('(5) listAll 全量导出', async () => {
    await visits.create(makeVisit('v1', 'p1', T0));
    await visits.create(makeVisit('v2', 'p2', T0 + 1000));
    await visits.create(makeVisit('v3', 'p3', T0 + 2000));

    const all = await visits.listAll();
    expect(all.length).toBe(3);
  });

  it('(6) makeVisitId 唯一性', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(makeVisitId('v'));
    }
    // 1000 次调用应生成 1000 个唯一 ID
    expect(ids.size).toBe(1000);
  });
});
