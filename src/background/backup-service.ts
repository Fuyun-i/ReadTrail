// ===== 备份服务（architecture.md 第 11 节）=====

import type {
  ExportOptions,
  ImportOptions,
  ImportReport,
  PageRecord,
  VisitRecord,
} from '../shared/types';
import type { PageRepository } from '../storage/repositories/page-repository';
import type { VisitRepository } from '../storage/repositories/visit-repository';
import type { SearchProvider } from '../search/search-provider';

const BACKUP_FORMAT_VERSION = 1;

export type BackupPayload = {
  format: 'readtrail-backup';
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
    // 分页加载记录，避免一次性全量载入内存导致 SW OOM
    const records: PageRecord[] = [];
    if (options.pageIds) {
      records.push(...await this.pages.getByIds(options.pageIds));
    } else {
      const PAGE_SIZE = 500;
      let offset = 0;
      while (true) {
        const batch = await this.pages.list({
          from: options.from, to: options.to,
          offset, limit: PAGE_SIZE, sort: 'recent',
        });
        if (batch.length === 0) break;
        records.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
    }

    const payload: BackupPayload = {
      format: 'readtrail-backup',
      version: BACKUP_FORMAT_VERSION,
      exportedAt: Date.now(),
      pages: records,
    };
    if (options.includeVisits) {
      // H5: 分页加载访问记录，避免全量载入内存导致 SW OOM
      const pageIdSet = new Set(records.map((r) => r.id));
      const allVisits: VisitRecord[] = [];
      const VISIT_PAGE_SIZE = 500;
      let visitOffset = 0;
      while (true) {
        const batch = await this.visits.listPaged(VISIT_PAGE_SIZE, visitOffset);
        if (batch.length === 0) break;
        allVisits.push(...batch.filter((v) => v.pageId && pageIdSet.has(v.pageId)));
        if (batch.length < VISIT_PAGE_SIZE) break;
        visitOffset += VISIT_PAGE_SIZE;
      }
      payload.visits = allVisits;
    }
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  }

  async importJson(file: Blob, options: ImportOptions = {}): Promise<ImportReport> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      const report: ImportReport = { inserted: 0, updated: 0, skipped: 0, errors: [] };
      report.errors.push({ index: -1, message: '文件不是合法 JSON' });
      return report;
    }
    return this.processImport(parsed, options);
  }

  /** 导入处理核心逻辑（被 importJson 和 importData 共用） */
  private async processImport(parsed: unknown, options: ImportOptions = {}): Promise<ImportReport> {
    const report: ImportReport = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    const payload = parsed as Partial<BackupPayload>;
    // 兼容旧版 yuehou-backup 格式名
    const isBackup = payload.format === 'readtrail-backup' || payload.format === 'yuehou-backup';
    if (!isBackup || !Array.isArray(payload.pages)) {
      report.errors.push({ index: -1, message: '备份格式不正确（缺少 format 或 pages）' });
      return report;
    }
    // M19: 检查备份版本兼容性
    if (payload.version !== undefined && payload.version > BACKUP_FORMAT_VERSION) {
      report.errors.push({ index: -1, message: `备份版本 v${payload.version} 高于当前支持版本 v${BACKUP_FORMAT_VERSION}，请升级扩展` });
      return report;
    }

    // replace：先验证所有记录，再清理（避免损坏的备份导致永久数据丢失）
    let dataReplaced = false;
    if (options.mode === 'replace') {
      // H3: 预验证所有记录，任一失败则中止导入，不触碰现有数据
      for (let i = 0; i < payload.pages.length; i++) {
        try {
          validatePageRecord(payload.pages[i]);
        } catch (err) {
          report.errors.push({ index: i, message: `替换导入预校验失败: ${err instanceof Error ? err.message : String(err)}` });
          return report;
        }
      }
      // H4: 先删 visits（孤儿 visit 比 orphan page 更安全），再删 pages
      await this.visits.deleteAll();
      await this.pages.deleteAll();
      await this.search.clear();
      dataReplaced = true;
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
          // M16: 合并标签（并集，去重）
          const mergedTags = [...new Set([
            ...(existing.tags ?? []),
            ...(record.tags ?? []),
          ])];
          const tagsChanged = mergedTags.length !== new Set(existing.tags ?? []).size;
          const merged: PageRecord = {
            ...existing,
            title: contentChanged ? record.title : existing.title,
            text: contentChanged ? record.text : existing.text,
            excerpt: contentChanged ? record.excerpt : existing.excerpt,
            lastVisitedAt: Math.max(existing.lastVisitedAt, record.lastVisitedAt),
            readingDurationMs: Math.max(existing.readingDurationMs, record.readingDurationMs),
            maxScrollRatio: Math.max(existing.maxScrollRatio, record.maxScrollRatio),
            visitCount: Math.max(existing.visitCount, record.visitCount), // 不累加
            tags: mergedTags.length > 0 ? mergedTags : existing.tags,
            updatedAt: (contentChanged || tagsChanged) ? Date.now() : existing.updatedAt,
          };
          await this.pages.overwrite(merged); // 直接覆盖，避免 upsert 的 +1 兜底重复计数
          // L5: 仅在内容或标签变更时更新搜索索引
          if (contentChanged || tagsChanged) {
            await this.search.update(merged);
          }
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

    // 如果 replace 模式下有导入错误，标记索引需要重建
    if (dataReplaced && report.errors.length > 0) {
      this.search.markNeedsRebuild();
    }

    // 导入备份中的 visits（5.2）：校验 pageId 存在、按 ID 幂等
    // 优化：预加载所有已导入 page 的 ID 集合 + 预加载现有 visits ID 集合，消除 N+1 查询
    if (Array.isArray(payload.visits) && payload.visits.length > 0) {
      // 收集备份中涉及的所有 pageId
      const importPageIds = new Set<string>();
      for (const raw of payload.visits) {
        if (typeof raw === 'object' && raw !== null) {
          const r = raw as Record<string, unknown>;
          if (typeof r.pageId === 'string') importPageIds.add(r.pageId);
        }
      }
      // 批量验证 pageId 存在性
      const existingPages = await this.pages.getByIds([...importPageIds]);
      const validPageIds = new Set(existingPages.map((p) => p.id));
      // 批量预加载涉及页面的已有 visit ID（单事务，替代 listAll 全量加载）
      const existingVisitIds = await this.visits.listIdsByPageIds([...importPageIds]);

      for (let i = 0; i < payload.visits.length; i++) {
        const raw = payload.visits[i];
        try {
          const visit = validateVisitRecord(raw);
          if (!visit.pageId || !validPageIds.has(visit.pageId)) {
            // 孤儿访问记录：不挂靠到任何页面，跳过并计入 skipped
            report.skipped++;
            continue;
          }
          if (existingVisitIds.has(visit.id)) {
            report.skipped++; // 幂等：已存在同 ID 访问记录
            continue;
          }
          await this.visits.create(visit);
          existingVisitIds.add(visit.id); // 防止备份内重复 ID
        } catch (err) {
          report.errors.push({ index: i, message: `visits[${i}]: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }

    return report;
  }

  /**
   * 直接从已解析的数据对象导入，跳过 Blob 序列化/反序列化开销。
   * importJson 的内部逻辑提取到此方法。
   */
  async importData(data: unknown, options: ImportOptions = {}): Promise<ImportReport> {
    return this.processImport(data, options);
  }

  async exportMarkdown(pageIds?: string[]): Promise<Blob> {
    // 分页加载记录，避免一次性全量载入内存
    let records: PageRecord[];
    if (pageIds) {
      records = await this.pages.getByIds(pageIds);
    } else {
      records = [];
      const PAGE_SIZE = 500;
      let offset = 0;
      while (true) {
        const batch = await this.pages.list({ offset, limit: PAGE_SIZE, sort: 'recent' });
        if (batch.length === 0) break;
        records.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
    }

    const escapeMd = (s: string) => s.replace(/([#\\`*_{}\[\]()!~|>-])/g, '\\$1');
    const lines: string[] = [`# ReadTrail 导出（${new Date().toLocaleString()}）`, ''];
    for (const record of records) {
      lines.push(`## ${escapeMd(record.title)}`);
      lines.push('');
      lines.push(`- 链接: ${record.url}`);
      lines.push(`- 域名: ${record.domain}`);
      lines.push(`- 最近访问: ${new Date(record.lastVisitedAt).toLocaleString()}`);
      lines.push(`- 访问次数: ${record.visitCount}`);
      if (record.excerpt) {
        lines.push('', `> ${escapeMd(record.excerpt)}`);
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
  for (const [field] of numFields) {
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
    maxScrollRatio: typeof r.maxScrollRatio === 'number' && r.maxScrollRatio >= 0 && r.maxScrollRatio <= 1 ? (r.maxScrollRatio as number) : 0,
    source: r.source === 'manual' ? 'manual' : 'auto',
    status: 'captured',
    tags: Array.isArray(r.tags) ? [...new Set((r.tags as string[]).filter((t) => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 50))].slice(0, 50) : undefined,
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
  const endedAt = typeof r.endedAt === 'number' && Number.isFinite(r.endedAt) ? (r.endedAt as number) : undefined;
  if (endedAt !== undefined && endedAt < startedAt) {
    throw new Error('访问记录 endedAt 不能早于 startedAt');
  }
  return {
    id: r.id,
    pageId: typeof r.pageId === 'string' ? r.pageId : undefined,
    tabId: typeof r.tabId === 'number' ? (r.tabId as number) : 0,
    url: r.url,
    startedAt,
    endedAt: endedAt,
    durationMs: typeof r.durationMs === 'number' && (r.durationMs as number) >= 0 ? (r.durationMs as number) : 0,
    maxScrollRatio: typeof r.maxScrollRatio === 'number' && r.maxScrollRatio >= 0 && r.maxScrollRatio <= 1 ? (r.maxScrollRatio as number) : 0,
    foregroundMs: typeof r.foregroundMs === 'number' && (r.foregroundMs as number) >= 0 ? (r.foregroundMs as number) : 0,
  };
}
