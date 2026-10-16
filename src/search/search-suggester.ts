// 搜索建议生成器
// 基于已索引数据提供三类建议：标题/域名前缀匹配、搜索历史、热门标签

import type { PageRecord } from '../shared/types';

export type Suggestion = {
  text: string;
  type: 'title' | 'domain' | 'history' | 'tag';
  label?: string; // 显示标签（如 "历史" "标签"）
};

export class SearchSuggester {
  private searchHistory: string[] = [];
  private popularTags: Array<{ tag: string; count: number }> = [];

  /** 从页面记录中提取标题/域名子串匹配建议 */
  suggestFromPages(pages: PageRecord[], prefix: string, max = 5): Suggestion[] {
    if (!prefix || prefix.length < 1) return [];
    const lower = prefix.toLowerCase();
    const seen = new Set<string>();
    const results: Suggestion[] = [];

    for (const page of pages) {
      if (results.length >= max) break;

      // 标题子串匹配
      if (page.title) {
        const titleLower = page.title.toLowerCase();
        if (titleLower.includes(lower) && !seen.has(page.title)) {
          seen.add(page.title);
          results.push({ text: page.title, type: 'title', label: '标题' });
        }
      }

      // 域名子串匹配
      if (page.domain.toLowerCase().includes(lower) && !seen.has(page.domain)) {
        seen.add(page.domain);
        results.push({ text: page.domain, type: 'domain', label: '域名' });
      }
    }

    return results.slice(0, max);
  }

  /** 搜索历史建议 */
  suggestFromHistory(prefix: string, max = 5): Suggestion[] {
    if (!prefix) {
      // 无前缀时返回最近的历史
      return this.searchHistory.slice(0, max).map((text) => ({
        text,
        type: 'history' as const,
        label: '历史',
      }));
    }
    const lower = prefix.toLowerCase();
    return this.searchHistory
      .filter((h) => h.toLowerCase().includes(lower))
      .slice(0, max)
      .map((text) => ({ text, type: 'history' as const, label: '历史' }));
  }

  /** 热门标签建议 */
  suggestFromTags(prefix: string, max = 3): Suggestion[] {
    if (!prefix) {
      return this.popularTags.slice(0, max).map(({ tag }) => ({
        text: `tag:${tag}`,
        type: 'tag' as const,
        label: '标签',
      }));
    }
    const lower = prefix.toLowerCase();
    return this.popularTags
      .filter(({ tag }) => tag.toLowerCase().includes(lower))
      .slice(0, max)
      .map(({ tag }) => ({ text: `tag:${tag}`, type: 'tag' as const, label: '标签' }));
  }

  /** 合并所有建议来源 */
  suggest(pages: PageRecord[], prefix: string, max = 8): Suggestion[] {
    const titleDomain = this.suggestFromPages(pages, prefix, 5);
    const history = this.suggestFromHistory(prefix, 3);
    const tags = this.suggestFromTags(prefix, 2);

    // 去重（按 text）
    const seen = new Set<string>();
    const merged: Suggestion[] = [];
    for (const s of [...titleDomain, ...history, ...tags]) {
      if (!seen.has(s.text)) {
        seen.add(s.text);
        merged.push(s);
      }
      if (merged.length >= max) break;
    }
    return merged;
  }

  /** 更新搜索历史（去重，保留最近 20 条） */
  updateSearchHistory(query: string): string[] {
    const trimmed = query.trim();
    if (!trimmed) return this.searchHistory;
    // 去重：移除已有相同项，再放到最前面
    this.searchHistory = [trimmed, ...this.searchHistory.filter((h) => h !== trimmed)].slice(0, 20);
    return this.searchHistory;
  }

  /** 从外部加载搜索历史 */
  setSearchHistory(history: string[]): void {
    this.searchHistory = history.slice(0, 20);
  }

  /** 更新热门标签列表 */
  setPopularTags(tags: Array<{ tag: string; count: number }>): void {
    // 按计数降序
    this.popularTags = [...tags].sort((a, b) => b.count - a.count);
  }

  /** 获取当前搜索历史（用于持久化） */
  getSearchHistory(): string[] {
    return [...this.searchHistory];
  }
}
