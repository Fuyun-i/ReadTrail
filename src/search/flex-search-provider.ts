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
import type { SearchProvider, BatchFetcher } from './search-provider';
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
  private cachedCtor: (new () => FlexIndex) | null = null;

  constructor(private fetchPages: PageFetcher) {}

  async init(): Promise<void> {
    if (this.indexes) return;
    this.cachedCtor = await getIndexCtor();
    this.indexes = {
      title: this.newIndex(),
      domain: this.newIndex(),
      excerpt: this.newIndex(),
      text: this.newIndex(),
    };
  }

  private newIndex(): FlexIndex {
    if (!this.cachedCtor) throw new Error('flexsearch not initialized');
    return new this.cachedCtor();
  }

  async index(record: PageRecord): Promise<void> {
    await this.init();
    this.addToIndexes(record);
  }
  async update(record: PageRecord): Promise<void> {
    await this.remove(record.id);
    try {
      await this.index(record);
    } catch {
      this.markNeedsRebuild();
    }
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
      title: this.newIndex(),
      domain: this.newIndex(),
      excerpt: this.newIndex(),
      text: this.newIndex(),
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

  /**
   * 流式重建索引：分页加载记录并增量建索引，避免一次性全量载入内存。
   * 内存峰值只跟 chunkSize 相关（默认 500 条），与总数据量无关。
   */
  async rebuildStream(fetchBatch: BatchFetcher, chunkSize = 500): Promise<number> {
    await this.clear();
    let offset = 0;
    let total = 0;
    while (true) {
      const batch = await fetchBatch(offset, chunkSize);
      if (batch.length === 0) break;
      for (const record of batch) {
        this.addToIndexes(record);
      }
      total += batch.length;
      offset += batch.length;
      if (batch.length < chunkSize) break;
    }
    this.lastRebuiltAt = Date.now();
    this.needsRebuild = false;
    return total;
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

    // NOT 排除词集合
    const excludeTermSet = new Set<string>(input.excludeTerms ?? []);
    // 精确短语列表
    const phraseList = input.phrases ?? [];
    // OR 分组：input.orGroups 已由 QueryParser 解析，当前版本退化为普通 token 匹配

    // 各字段召回（flexsearch 内部以空格分词，索引写入时已预处理为 token 串）
    const fieldHits = new Map<string, { score: number; fields: Set<SearchMatchField> }>();
    const FIELD_WEIGHT: Record<FieldName, number> = { title: 3, domain: 2, excerpt: 1.5, text: 1 };

    // 动态追加：初始取 limit+offset+50，过滤后不足时增大 limit 重试
    let searchLimit = limit + offset + 50;
    const maxRetries = 3;
    for (let retry = 0; retry < maxRetries; retry++) {
      fieldHits.clear();
      for (const [field, idx] of Object.entries(this.indexes) as Array<[FieldName, FlexIndex]>) {
        let ids: string[] | number[];
        try {
          ids = idx.search(queryTokens.join(' '), { limit: searchLimit });
        } catch {
          ids = [];
        }
        ids.forEach((rawId, rank) => {
          const id = String(rawId);
          const existing = fieldHits.get(id) ?? { score: 0, fields: new Set<SearchMatchField>() };
          existing.score += FIELD_WEIGHT[field] * (1 + 1 / (rank + 1));
          existing.fields.add(field);
          fieldHits.set(id, existing);
        });
      }

      // 检查过滤后是否有足够结果
      const candidateIds = [...fieldHits.keys()];
      if (candidateIds.length === 0) return [];

      // 快速估算过滤后数量（不回读数据库，仅按已知的 fieldHits 数量估算）
      // 如果候选数远大于需要的数量，大概率够用
      if (candidateIds.length >= (offset + limit) * 2 || retry === maxRetries - 1) break;
      // 否则增大 searchLimit 重试
      searchLimit *= 2;
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
      if (input.tags && input.tags.length > 0 && (!page.tags || !input.tags.some((t) => page.tags!.some((pt) => pt.toLowerCase() === t)))) continue;
      // L17: 合并 NOT 排除和短语匹配的 pageText 计算，避免重复
      const needsTextCheck = excludeTermSet.size > 0 || phraseList.length > 0;
      if (needsTextCheck) {
        const pageText = (page.title + ' ' + page.excerpt + ' ' + page.text.slice(0, 20000)).toLowerCase();
        // NOT 排除：页面文本包含排除词则跳过
        if (excludeTermSet.size > 0) {
          let excluded = false;
          for (const term of excludeTermSet) {
            if (pageText.includes(term)) { excluded = true; break; }
          }
          if (excluded) continue;
        }
        // 精确短语：页面必须包含所有短语
        if (phraseList.length > 0) {
          let allMatch = true;
          for (const phrase of phraseList) {
            if (!pageText.includes(phrase.toLowerCase())) { allMatch = false; break; }
          }
          if (!allMatch) continue;
        }
      }

      const highlights = buildHighlights(page, queryTokens);
      const recencyBoost = recencyScore(page.lastVisitedAt);
      const frequencyBoost = Math.min(page.visitCount, 20) / 20;
      const score = hit.score + recencyBoost * 2 + frequencyBoost;

      results.push({
        page: { ...page, excerpt: page.excerpt.length > 200 ? page.excerpt.slice(0, 200) + '…' : page.excerpt },
        score,
        matchedFields: [...hit.fields],
        highlights,
      });
    }

    // 排序（results 已由 fieldHits Map 保证 ID 唯一，无需额外去重）
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
    // domain 传给 SW 侧过滤（已支持管道分隔 OR 匹配），客户端不再重复过滤
    // 过取 3 倍以应对 source 过滤后数量不足
    const pages = await this.fetchPages([], {
      limit: (offset + limit) * 3,
      offset: 0,
      sort: input.sort === 'frequent' ? 'frequent' : 'recent',
      from: input.from,
      to: input.to,
      domain: input.domain,
    });

    // 过滤 source、标签、精确短语、NOT 排除词（SW 侧不支持这些过滤）
    const filtered = pages
      .filter((p) => {
        if (input.source && p.source !== input.source) return false;
        // H9: 标签过滤（大小写不敏感）
        if (input.tags && input.tags.length > 0 && (!p.tags || !input.tags.some((t) => p.tags!.some((pt) => pt.toLowerCase() === t)))) return false;
        // H10: 精确短语过滤
        if (input.phrases && input.phrases.length > 0) {
          const pageText = (p.title + ' ' + p.excerpt + ' ' + p.text.slice(0, 20_000)).toLowerCase();
          for (const phrase of input.phrases) {
            if (!pageText.includes(phrase.toLowerCase())) return false;
          }
        }
        // M3: NOT 排除词过滤
        if (input.excludeTerms && input.excludeTerms.length > 0) {
          const pageText = (p.title + ' ' + p.excerpt + ' ' + p.text.slice(0, 20_000)).toLowerCase();
          for (const term of input.excludeTerms) {
            if (pageText.includes(term)) return false;
          }
        }
        return true;
      })
      .slice(offset, offset + limit);

    return filtered.map((page) => ({
      page: { ...page, excerpt: page.excerpt.length > 200 ? page.excerpt.slice(0, 200) + '…' : page.excerpt },
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
  if (!f) return false;
  const rd = recordDomain.toLowerCase();
  return rd === f || rd.endsWith('.' + f);
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

  // L21: 按 token 长度降序排列，优先高亮更长的匹配（如 CJK bigram 优先于单字）
  const sortedTokens = [...queryTokens].sort((a, b) => b.length - a.length);
  for (const { name, text } of fields) {
    if (!text) continue;
    const lower = text.toLowerCase();
    for (const token of sortedTokens) {
      if (token.length < 1) continue;
      const pos = lower.indexOf(token.toLowerCase());
      if (pos >= 0) {
        // L21: 使用码元切片（pos 来自 indexOf，是码元索引）
        highlights.push({ field: name, text: text.slice(pos, pos + token.length), start: pos, end: pos + token.length });
        break;
      }
    }
    if (highlights.length >= maxHighlights) break;
  }
  return highlights;
}
