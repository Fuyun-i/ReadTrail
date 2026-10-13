// ===== 备份服务（architecture.md 第 11 节）=====

import type {
  ExportOptions,
  ImportOptions,
  ImportReport,
  PageRecord,
  VisitRecord,
} from '../shared/types';import type { PageRepository } from '../storage/repositories/page-repository';
import type { VisitRepository } from '../storage/repositories/visit-repository';
import type { SearchProvider } from '../search/search-provider';

const BACKUP_FORMAT_VERSION = 1;

export type BackupPayload = {
  format: 'yuehou-backup';
  version: number;
  exportedAt: number;
  pages: PageRecord[];
  visits?: VisitRecord[];
};

export class BackupService {
  constructor(
    private pages: PageRepository,
    private visits: VisitRepository,
    private search: SearchProvider,
  ) {}

  async exportJson(options: ExportOptions = {}): Promise<Blob> {
    let records: PageRecord[];
    if (options.pageIds) {
      records = await this.pages.getByIds(options.pageIds);
    } else {
      records = await this.pages.list({ from: options.from, to: options.to, limit: Number.MAX_SAFE_INTEGER });
    }

    const payload: BackupPayload = {
      format: 'yuehou-backup',
      version: BACKUP_FORMAT_VERSION,
      exportedAt: Date.now(),
      pages: records,
    };
    if (options.includeVisits) {
      const visits: VisitRecord[] = [];
      for (const record of records) {
        visits.push(...(await this.visits.listByPageId(record.id)));
      }
      payload.visits = visits;
    }
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  }

  async importJson(file: Blob, options: ImportOptions = {}): Promise<ImportReport> {
    const report: ImportReport = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      report.errors.push({ index: -1, message: '文件不是合法 JSON' });
      return report;
    }

    const payload = parsed as Partial<BackupPayload>;
    if (payload.format !== 'yuehou-backup' || !Array.isArray(payload.pages)) {
      report.errors.push({ index: -1, message: '备份格式不正确（缺少 format 或 pages）' });
      return report;
    }

    // replace：页面、访问记录、索引全部清理（5.2）
    if (options.mode === 'replace') {
      await this.pages.deleteAll();
      await this.visits.deleteAll();
      await this.search.clear();
    }

    // merge 模式下记录已有 canonicalUrl，判断重复导入（不重复增加 visitCount）
    const mergeMode = options.mode !== 'replace';
    const seenCanonical = new Set<string>();

    for (let i = 0; i < payload.pages.length; i++) {
      const raw = payload.pages[i];
      try {
        const record = validatePageRecord(raw);

        // 同一备份内的重复 URL：跳过
        if (seenCanonical.has(record.canonicalUrl)) {
          report.skipped++;
          continue;
        }
        seenCanonical.add(record.canonicalUrl);

        const existing = await this.pages.findByCanonicalUrl(record.canonicalUrl);
        if (existing && mergeMode) {
          // merge：同 URL 已存在 → 保留本地统计，仅当备份内容更新时更新正文/标题
          const contentChanged = existing.text !== record.text || existing.title !== record.title;
          const merged: PageRecord = {
            ...existing,
            title: contentChanged ? record.title : existing.title,
            text: contentChanged ? record.text : existing.text,
            excerpt: contentChanged ? record.excerpt : existing.excerpt,
            lastVisitedAt: Math.max(existing.lastVisitedAt, record.lastVisitedAt),
            readingDurationMs: Math.max(existing.readingDurationMs, record.readingDurationMs),
            maxScrollRatio: Math.max(existing.maxScrollRatio, record.maxScrollRatio),
            visitCount: Math.max(existing.visitCount, record.visitCount), // 不累加
            updatedAt: contentChanged ? Date.now() : existing.updatedAt,
          };
          await this.pages.overwrite(merged); // 直接覆盖，避免 upsert 的 +1 兜底重复计数
          await this.search.update(merged);
          report.updated++;
        } else {
          await this.pages.upsert(record);
          await this.search.index(record);
          report.inserted++;
        }
      } catch (err) {
        report.errors.push({ index: i, message: err instanceof Error ? err.message : String(err) });
      }
    }

    // 导入备份中的 visits（5.2）：校验 pageId 存在、按 ID 幂等
    if (Array.isArray(payload.visits)) {
      for (let i = 0; i < payload.visits.length; i++) {
        const raw = payload.visits[i];
        try {
          const visit = validateVisitRecord(raw);
          const parent = visit.pageId ? await this.pages.findById(visit.pageId) : undefined;
          if (!parent || !visit.pageId) {
            // 孤儿访问记录：不挂靠到任何页面，跳过并计入 skipped
            report.skipped++;
            continue;
          }
          const known = await this.visits.listByPageId(visit.pageId);
          if (known.some((v) => v.id === visit.id)) {
            report.skipped++; // 幂等：已存在同 ID 访问记录
            continue;
          }
          await this.visits.create(visit);
        } catch (err) {
          report.errors.push({ index: i, message: `visits[${i}]: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }

    return report;
  }

  async exportMarkdown(pageIds?: string[]): Promise<Blob> {
    const records = pageIds
      ? await this.pages.getByIds(pageIds)
      : await this.pages.list({ limit: Number.MAX_SAFE_INTEGER });

    const lines: string[] = [`# ReadTrail 导出（${new Date().toLocaleString()}）`, ''];
    for (const record of records) {
      lines.push(`## ${record.title}`);
      lines.push('');
      lines.push(`- 链接: ${record.url}`);
      lines.push(`- 域名: ${record.domain}`);
      lines.push(`- 最近访问: ${new Date(record.lastVisitedAt).toLocaleString()}`);
      lines.push(`- 访问次数: ${record.visitCount}`);
      if (record.excerpt) {
        lines.push('', `> ${record.excerpt}`);
      }
      lines.push('', record.text, '');
    }
    return new Blob([lines.join('\n')], { type: 'text/markdown' });
  }
}

/** 导入记录的结构校验（协议要求：不能直接信任未知数据） */
export function validatePageRecord(raw: unknown): PageRecord {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('记录必须是对象');
  }
  const r = raw as Record<string, unknown>;
  const required: Array<[string, string]> = [
    ['url', 'string'],
    ['title', 'string'],
    ['text', 'string'],
  ];
  for (const [field, type] of required) {
    if (typeof r[field] !== type) {
      throw new Error(`字段 ${field} 必须是 ${type}`);
    }
  }

  // 数值合法性：负数计数、非法时间戳拒绝（5.2 逐条错误）
  const numFields: Array<[string, number]> = [
    ['visitCount', 1],
    ['readingDurationMs', 0],
    ['maxScrollRatio', 0],
  ];
  for (const [field, fallback] of numFields) {
    const value = r[field];
    if (value !== undefined && (!Number.isFinite(value) || (value as number) < 0)) {
      throw new Error(`字段 ${field} 必须是非负有限数字`);
    }
  }
  for (const field of ['firstVisitedAt', 'lastVisitedAt', 'createdAt', 'updatedAt'] as const) {
    const value = r[field];
    if (value !== undefined && (!Number.isFinite(value) || (value as number) < 0)) {
      throw new Error(`字段 ${field} 必须是合法时间戳`);
    }
  }
  if (typeof r.maxScrollRatio === 'number' && r.maxScrollRatio > 1) {
    throw new Error('字段 maxScrollRatio 不能大于 1');
  }

  const now = Date.now();
  return {
    id: typeof r.id === 'string' ? r.id : `p_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    canonicalUrl: typeof r.canonicalUrl === 'string' ? r.canonicalUrl : String(r.url),
    url: r.url as string,
    title: r.title as string,
    domain: typeof r.domain === 'string' ? (r.domain as string) : '',
    text: r.text as string,
    excerpt: typeof r.excerpt === 'string' ? (r.excerpt as string) : '',
    firstVisitedAt: typeof r.firstVisitedAt === 'number' ? (r.firstVisitedAt as number) : now,
    lastVisitedAt: typeof r.lastVisitedAt === 'number' ? (r.lastVisitedAt as number) : now,
    visitCount: typeof r.visitCount === 'number' ? (r.visitCount as number) : 1,
    readingDurationMs: typeof r.readingDurationMs === 'number' ? (r.readingDurationMs as number) : 0,
    maxScrollRatio: typeof r.maxScrollRatio === 'number' ? (r.maxScrollRatio as number) : 0,
    source: r.source === 'manual' ? 'manual' : 'auto',
    status: 'captured',
    createdAt: typeof r.createdAt === 'number' ? (r.createdAt as number) : now,
    updatedAt: typeof r.updatedAt === 'number' ? (r.updatedAt as number) : now,
  };
}

/** 访问记录导入校验（5.2） */
function validateVisitRecord(raw: unknown): VisitRecord {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('访问记录必须是对象');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) {
    throw new Error('访问记录缺少 id');
  }
  if (typeof r.url !== 'string') {
    throw new Error('访问记录 url 必须是字符串');
  }
  const startedAt = typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) && r.startedAt >= 0
    ? (r.startedAt as number)
    : Date.now();
  return {
    id: r.id,
    pageId: typeof r.pageId === 'string' ? r.pageId : undefined,
    tabId: typeof r.tabId === 'number' ? (r.tabId as number) : 0,
    url: r.url,
    startedAt,
    endedAt: typeof r.endedAt === 'number' ? (r.endedAt as number) : undefined,
    durationMs: typeof r.durationMs === 'number' && (r.durationMs as number) >= 0 ? (r.durationMs as number) : 0,
    maxScrollRatio: typeof r.maxScrollRatio === 'number' ? (r.maxScrollRatio as number) : 0,
    foregroundMs: typeof r.foregroundMs === 'number' && (r.foregroundMs as number) >= 0 ? (r.foregroundMs as number) : 0,
  };
}
