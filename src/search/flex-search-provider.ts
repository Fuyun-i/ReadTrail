// ===== FlexSearch 检索提供者（architecture.md 第 9 节 SearchProvider 实现）=====
//
// 设计约定：
// - 标题、域名、摘要、正文分别建字段索引（Index 只存 id + 检索文本）。
// - 中文使用字符级（单字 + bigram）分词，英文按词切分。
// - 搜索结果必须从数据库回读完整 PageRecord，索引不存正文全文。
// - 排序综合相关度、最近访问时间、访问次数。

import type {
  PageRecord,
  SearchInput,
  SearchResult,
  SearchMatchField,
  SearchHighlight,
  SearchHealth,
} from '../shared/types';
import type { SearchProvider } from './search-provider';
import { tokenize, tokenizeQuery } from './query-parser';

// FlexSearch 按需加载（其 ESM 包体较大，Service Worker 冷启动敏感）
type FlexIndex = {
  add(id: string | number, content: string): unknown;
  remove(id: string | number): unknown;
  search(query: string, options?: { limit?: number }): string[] | number[];
};

let IndexCtor: (new () => FlexIndex) | null = null;
async function getIndexCtor(): Promise<new () => FlexIndex> {
  if (!IndexCtor) {
    const mod = (await import('flexsearch')) as unknown as {
      Index: new () => FlexIndex;
      default?: { Index: new () => FlexIndex };
    };
    IndexCtor = mod.Index ?? mod.default?.Index ?? null;
    if (!IndexCtor) throw new Error('flexsearch Index not found');
  }
  return IndexCtor;
}

function newIndex(): FlexIndex {
  const host = globalThis as { __readtrailIndexCtor?: new () => FlexIndex };
  const Ctor = host.__readtrailIndexCtor;
  if (!Ctor) throw new Error('flexsearch not initialized');
  return new Ctor();
}

/**
 * 页面获取回调。
 * - ids 非空：按 ID 批量回读（搜索命中后取完整记录）
 * - ids 为空：返回最近访问的页面（空查询场景），listOptions 携带分页与过滤参数
 */
export type PageFetcher = (
  ids: string[],
  listOptions?: { limit?: number; offset?: number; sort?: 'recent' | 'frequent'; from?: number; to?: number; domain?: string },
) => Promise<PageRecord[]>;

type FieldName = 'title' | 'domain' | 'excerpt' | 'text';

export class FlexSearchProvider implements SearchProvider {
  private indexes: Record<FieldName, FlexIndex> | null = null;
  private indexedIds = new Set<string>();
  private lastRebuiltAt?: number;
  private needsRebuild = false;

  constructor(private fetchPages: PageFetcher) {}

  async init(): Promise<void> {
    if (this.indexes) return;
    const Ctor = await getIndexCtor();
    (globalThis as { __readtrailIndexCtor?: new () => FlexIndex }).__readtrailIndexCtor = Ctor;
    this.indexes = {
      title: newIndex(),
      domain: newIndex(),
      excerpt: newIndex(),
      text: newIndex(),
    };
  }

  async index(record: PageRecord): Promise<void> {
    await this.init();
    this.addToIndexes(record);
  }
  async update(record: PageRecord): Promise<void> {
    await this.remove(record.id);
    await this.index(record);
  }

  async remove(pageId: string): Promise<void> {
    if (!this.indexes) return;
    if (!this.indexedIds.has(pageId)) return;
    for (const idx of Object.values(this.indexes)) {
      idx.remove(pageId);
    }
    this.indexedIds.delete(pageId);
  }

  async clear(): Promise<void> {
    await this.init();
    this.indexes = {
      title: newIndex(),
      domain: newIndex(),
      excerpt: newIndex(),
      text: newIndex(),
    };
    this.indexedIds.clear();
    this.needsRebuild = false;
  }

  async rebuild(records: PageRecord[]): Promise<void> {
    await this.clear();
    for (const record of records) {
      this.addToIndexes(record);
    }
    this.lastRebuiltAt = Date.now();
    this.needsRebuild = false;
  }

  async search(input: SearchInput): Promise<SearchResult[]> {
    await this.init();
    if (!this.indexes) return [];

    const limit = Math.min(input.limit ?? 30, 200);
    const offset = input.offset ?? 0;
    const query = input.query.trim();

    // 空查询 → 直接走数据库排序（最近访问），只取需要的条数
    if (!query) {
      return this.emptyQueryResults(input, offset, limit);
    }

    const queryTokens = tokenizeQuery(query);
    if (queryTokens.length === 0) return [];

    // 各字段召回（flexsearch 内部以空格分词，索引写入时已预处理为 token 串）
    const fieldHits = new Map<string, { score: number; fields: Set<SearchMatchField> }>();
    const FIELD_WEIGHT: Record<FieldName, number> = { title: 3, domain: 2, excerpt: 1.5, text: 1 };

    for (const [field, idx] of Object.entries(this.indexes) as Array<[FieldName, FlexIndex]>) {
      let ids: string[] | number[];
      try {
        ids = idx.search(query, { limit: limit + offset + 50 });
      } catch {
        ids = [];
      }
      ids.forEach((rawId, rank) => {
        const id = String(rawId);
        const existing = fieldHits.get(id) ?? { score: 0, fields: new Set<SearchMatchField>() };
        // 排名靠前加分 + 字段权重
        existing.score += FIELD_WEIGHT[field] * (1 + 1 / (rank + 1));
        existing.fields.add(field);
        fieldHits.set(id, existing);
      });
    }

    if (fieldHits.size === 0) return [];

    // 数据库回读完整记录（验收要求：不能只依赖索引截断文本）
    const ids = [...fieldHits.keys()];
    const pages = await this.fetchPages(ids);
    const pageMap = new Map(pages.map((p) => [p.id, p]));

    let results: SearchResult[] = [];
    for (const [id, hit] of fieldHits) {
      const page = pageMap.get(id);
      if (!page) continue;

      // 过滤：时间范围 / 域名（OR 语义）/ 来源
      if (input.from !== undefined && page.lastVisitedAt < input.from) continue;
      if (input.to !== undefined && page.lastVisitedAt > input.to) continue;
      if (input.domain && !matchesAnyDomain(page.domain, input.domain)) continue;
      if (input.source && page.source !== input.source) continue;

      const highlights = buildHighlights(page, queryTokens);
      const recencyBoost = recencyScore(page.lastVisitedAt);
      const frequencyBoost = Math.min(page.visitCount, 20) / 20;
      const score = hit.score + recencyBoost * 2 + frequencyBoost;

      results.push({
        page,
        score,
        matchedFields: [...hit.fields],
        highlights,
      });
    }

    // 排序
    const sort = input.sort ?? 'relevance';
    results.sort((a, b) => {
      if (sort === 'recent') return b.page.lastVisitedAt - a.page.lastVisitedAt;
      if (sort === 'frequent') {
        return b.page.visitCount - a.page.visitCount || b.page.lastVisitedAt - a.page.lastVisitedAt;
      }
      return b.score - a.score;
    });

    return results.slice(offset, offset + limit);
  }

  async health(databaseCount: number): Promise<SearchHealth> {
    return {
      ready: this.indexes !== null,
      indexedCount: this.indexedIds.size,
      databaseCount,
      needsRebuild: this.needsRebuild || (this.indexes !== null && this.indexedIds.size !== databaseCount),
      lastRebuiltAt: this.lastRebuiltAt,
    };
  }

  markNeedsRebuild(): void {
    this.needsRebuild = true;
  }

  // ---- 内部 ----

  private addToIndexes(record: PageRecord): void {
    if (!this.indexes) return;
    this.indexes.title.add(record.id, tokenize(record.title).join(' '));
    this.indexes.domain.add(record.id, tokenize(record.domain).join(' '));
    this.indexes.excerpt.add(record.id, tokenize(record.excerpt).join(' '));
    // 正文截断入库，避免超大文档拖慢索引
    this.indexes.text.add(record.id, tokenize(record.text.slice(0, 20_000)).join(' '));
    this.indexedIds.add(record.id);
  }

  private async emptyQueryResults(input: SearchInput, offset: number, limit: number): Promise<SearchResult[]> {
    // 优化：不再调 fetchPages([]) 拉全量数据，而是传入 limit/offset/sort 让 SW 侧走索引查询
    const pages = await this.fetchPages([], {
      limit: offset + limit,
      offset: 0,
      sort: 'recent',
      from: input.from,
      to: input.to,
      domain: input.domain,
    });

    const filtered = pages
      .filter((p) => {
        if (input.domain && !matchesAnyDomain(p.domain, input.domain)) return false;
        if (input.source && p.source !== input.source) return false;
        return true;
      })
      .slice(offset, offset + limit);

    return filtered.map((page) => ({
      page,
      score: 0,
      matchedFields: [],
      highlights: [],
    }));
  }
}

/**
 * 域名匹配。filterDomain 可含 `|` 分隔的多个域名（normalizeSearchInput 的 OR 语义），
 * 任一命中即通过；单个域名仍支持子域匹配。
 */
function matchesAnyDomain(recordDomain: string, filterDomain: string): boolean {
  return filterDomain.split('|').some((f) => matchesDomain(recordDomain, f));
}

function matchesDomain(recordDomain: string, filterDomain: string): boolean {
  const f = filterDomain.trim().toLowerCase();
  if (!f) return true;
  return recordDomain === f || recordDomain.endsWith('.' + f) || f.endsWith('.' + recordDomain);
}

/** 最近访问时间加分：24h 内 1.0 → 线性衰减到 30 天为 0 */
function recencyScore(lastVisitedAt: number): number {
  const ageMs = Date.now() - lastVisitedAt;
  const day = 86_400_000;
  if (ageMs <= day) return 1;
  if (ageMs >= 30 * day) return 0;
  return 1 - (ageMs - day) / (29 * day);
}

/** 在记录字段里定位 token 出现位置，生成高亮片段 */
function buildHighlights(page: PageRecord, queryTokens: string[], maxHighlights = 3): SearchHighlight[] {
  const highlights: SearchHighlight[] = [];
  const fields: Array<{ name: SearchMatchField; text: string }> = [
    { name: 'title', text: page.title },
    { name: 'excerpt', text: page.excerpt },
    { name: 'text', text: page.text.slice(0, 2000) },
  ];

  for (const { name, text } of fields) {
    if (!text) continue;
    const lower = text.toLowerCase();
    for (const token of queryTokens) {
      if (token.length < 1) continue;
      const pos = lower.indexOf(token.toLowerCase());
      if (pos >= 0) {
        highlights.push({ field: name, text, start: pos, end: pos + token.length });
        break;
      }
    }
    if (highlights.length >= maxHighlights) break;
  }
  return highlights;
}
