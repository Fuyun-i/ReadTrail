import { describe, it, expect, vi } from 'vitest';
import { BackupService, validatePageRecord } from '../src/background/backup-service';
import type { PageRecord } from '../src/shared/types';

function page(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id: 'p_1',
    canonicalUrl: 'https://a.com/x',
    url: 'https://a.com/x',
    title: 'T',
    domain: 'a.com',
    text: 'hello world content',
    excerpt: 'hello',
    firstVisitedAt: 1000,
    lastVisitedAt: 2000,
    visitCount: 1,
    readingDurationMs: 5000,
    maxScrollRatio: 0.5,
    source: 'auto',
    status: 'captured',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeDeps(records: PageRecord[] = []) {
  const pages = {
    ready: async () => ({}),
    getByIds: async (ids: string[]) => records.filter((r) => ids.includes(r.id)),
    list: async () => records,
    findById: async (id: string) => records.find((r) => r.id === id),
    findByCanonicalUrl: async (url: string) => records.find((r) => r.canonicalUrl === url),
    upsert: vi.fn(async (r: PageRecord) => {
      records.push(r);
      return r;
    }),
    overwrite: vi.fn(async (r: PageRecord) => {
      const i = records.findIndex((x) => x.id === r.id);
      if (i >= 0) records[i] = r;
    }),
    deleteAll: vi.fn(async () => {
      records.length = 0;
    }),
  };
  const visits = {
    listByPageId: vi.fn(async () => []),
    listAll: vi.fn(async () => []),
    create: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => {}),
  };
  const search = {
    index: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
  return { service: new BackupService(pages as never, visits as never, search as never), pages, visits, search };
}

describe('validatePageRecord', () => {
  it('缺 url / title / text 时报错', () => {
    expect(() => validatePageRecord({ title: 'x', text: 'y' })).toThrow();
    expect(() => validatePageRecord({ url: 'https://a.com', text: 'y' })).toThrow();
    expect(() => validatePageRecord({ url: 'https://a.com', title: 'x' })).toThrow();
  });

  it('负数 visitCount / 非法时间戳 / maxScrollRatio>1 拒绝', () => {
    expect(() => validatePageRecord(page({ visitCount: -1 }))).toThrow();
    expect(() => validatePageRecord(page({ lastVisitedAt: NaN }))).toThrow();
    expect(() => validatePageRecord(page({ maxScrollRatio: 1.5 }))).toThrow();
  });

  it('合法记录通过并补全默认值', () => {
    const r = validatePageRecord({ url: 'https://a.com', title: 'T', text: 'x' });
    expect(r.visitCount).toBe(1);
    expect(r.status).toBe('captured');
    expect(r.canonicalUrl).toBe('https://a.com');
  });
});

describe('BackupService.importJson', () => {
  function backup(pages: unknown[]) {
    return new Blob([JSON.stringify({ format: 'yuehou-backup', version: 1, exportedAt: 0, pages })]);
  }

  it('非法 JSON 返回错误报告', async () => {
    const { service } = makeDeps();
    const report = await service.importJson(new Blob(['not json']));
    expect(report.errors).toHaveLength(1);
    expect(report.inserted).toBe(0);
  });

  it('格式不对（缺 format）返回错误报告', async () => {
    const { service } = makeDeps();
    const report = await service.importJson(new Blob([JSON.stringify({ pages: [] })]));
    expect(report.errors[0]?.message).toContain('格式');
  });

  it('合法记录导入为 inserted', async () => {
    const { service } = makeDeps();
    const report = await service.importJson(backup([page()]));
    expect(report.inserted).toBe(1);
    expect(report.errors).toHaveLength(0);
  });

  it('merge 模式：同 canonicalUrl 不重复插入，不累加 visitCount', async () => {
    const existing = page({ id: 'p_local', text: 'old text' });
    const { service, pages } = makeDeps([existing]);
    const incoming = page({ id: 'p_remote', text: 'new text', visitCount: 99 });
    const report = await service.importJson(backup([incoming]));
    expect(report.updated).toBe(1);
    expect(report.inserted).toBe(0);
    const merged = await pages.findByCanonicalUrl('https://a.com/x');
    expect(merged?.text).toBe('new text');
    expect(merged?.visitCount).toBe(99); // 取 max，不累加
  });

  it('replace 模式：先清空再导入', async () => {
    const { service, pages, search } = makeDeps([page()]);
    const incoming = page({ id: 'p_2', canonicalUrl: 'https://b.com/y', url: 'https://b.com/y', domain: 'b.com' });
    await service.importJson(backup([incoming]), { mode: 'replace' });
    expect(search.clear).toHaveBeenCalled();
    expect(reportInserted(await pages.list())).toBe(1);
  });

  it('同一备份内重复 URL 跳过', async () => {
    const { service, pages } = makeDeps();
    await service.importJson(backup([page(), page({ id: 'p_dup' })]));
    expect((await pages.list()).length).toBe(1);
  });

  it('visits 孤儿记录跳过', async () => {
    const { service, visits } = makeDeps();
    const blob = new Blob([JSON.stringify({
      format: 'yuehou-backup', version: 1, exportedAt: 0,
      pages: [page()],
      visits: [{ id: 'v1', pageId: 'p_missing', url: 'https://x.com', tabId: 0, startedAt: 1, durationMs: 1, maxScrollRatio: 0, foregroundMs: 1 }],
    })]);
    const report = await service.importJson(blob);
    expect(report.skipped).toBeGreaterThanOrEqual(1);
    expect(visits.create).not.toHaveBeenCalled();
  });
});

function reportInserted(records: PageRecord[]): number {
  return records.length;
}

describe('BackupService.exportMarkdown', () => {
  it('生成包含标题与正文的 Markdown', async () => {
    const { service } = makeDeps([page({ title: 'My Title' })]);
    const blob = await service.exportMarkdown();
    const md = await blob.text();
    expect(md).toContain('## My Title');
    expect(md).toContain('hello world content');
  });
});
