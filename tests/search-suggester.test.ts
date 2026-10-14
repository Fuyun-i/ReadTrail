// SearchSuggester 单元测试
import { describe, it, expect } from 'vitest';
import { SearchSuggester } from '../src/search/search-suggester';
import type { PageRecord } from '../src/shared/types';

function makePage(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id: 'p1',
    canonicalUrl: 'https://example.com/page',
    url: 'https://example.com/page',
    domain: 'example.com',
    title: 'Test Page',
    text: 'Some text content here for testing purposes.',
    excerpt: 'Some text content',
    source: 'auto',
    visitCount: 1,
    firstVisitedAt: Date.now(),
    lastVisitedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    readingDurationMs: 10000,
    maxScrollRatio: 0.5,
    ...overrides,
  };
}

describe('SearchSuggester', () => {
  it('标题前缀匹配', () => {
    const suggester = new SearchSuggester();
    const pages = [
      makePage({ id: '1', title: 'Rust async runtime' }),
      makePage({ id: '2', title: 'Go concurrency' }),
      makePage({ id: '3', title: 'Rust memory safety' }),
    ];
    const suggestions = suggester.suggestFromPages(pages, 'rust', 5);
    expect(suggestions.length).toBe(2);
    expect(suggestions[0].text).toContain('Rust');
    expect(suggestions[0].type).toBe('title');
  });

  it('域名前缀匹配', () => {
    const suggester = new SearchSuggester();
    const pages = [
      makePage({ id: '1', domain: 'github.com' }),
      makePage({ id: '2', domain: 'stackoverflow.com' }),
    ];
    const suggestions = suggester.suggestFromPages(pages, 'git', 5);
    expect(suggestions.some((s) => s.text === 'github.com')).toBe(true);
  });

  it('空前缀返回空', () => {
    const suggester = new SearchSuggester();
    const pages = [makePage({ title: 'Test' })];
    expect(suggester.suggestFromPages(pages, '', 5)).toEqual([]);
  });

  it('搜索历史建议 — 有前缀', () => {
    const suggester = new SearchSuggester();
    suggester.setSearchHistory(['rust async', 'go channels', 'python asyncio']);
    const suggestions = suggester.suggestFromHistory('async', 5);
    expect(suggestions.length).toBe(2);
    expect(suggestions[0].type).toBe('history');
  });

  it('搜索历史建议 — 无前缀返回最近', () => {
    const suggester = new SearchSuggester();
    suggester.setSearchHistory(['rust', 'go', 'python']);
    const suggestions = suggester.suggestFromHistory('', 5);
    expect(suggestions.length).toBe(3);
  });

  it('热门标签建议', () => {
    const suggester = new SearchSuggester();
    suggester.setPopularTags([
      { tag: 'rust', count: 10 },
      { tag: 'go', count: 5 },
      { tag: 'python', count: 3 },
    ]);
    const suggestions = suggester.suggestFromTags('', 3);
    expect(suggestions.length).toBe(3);
    expect(suggestions[0].text).toBe('tag:rust');
  });

  it('热门标签建议 — 有前缀', () => {
    const suggester = new SearchSuggester();
    suggester.setPopularTags([
      { tag: 'rust', count: 10 },
      { tag: 'go', count: 5 },
    ]);
    const suggestions = suggester.suggestFromTags('ru', 3);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].text).toBe('tag:rust');
  });

  it('合并建议 — 去重', () => {
    const suggester = new SearchSuggester();
    const pages = [makePage({ title: 'rust tutorial' })];
    suggester.setSearchHistory(['rust tutorial']);
    const suggestions = suggester.suggest(pages, 'rust', 8);
    const texts = suggestions.map((s) => s.text);
    expect(new Set(texts).size).toBe(texts.length); // 无重复
  });

  it('更新搜索历史 — 去重并放到最前', () => {
    const suggester = new SearchSuggester();
    suggester.setSearchHistory(['rust', 'go', 'python']);
    const updated = suggester.updateSearchHistory('rust');
    expect(updated[0]).toBe('rust');
    expect(updated.length).toBe(3);
  });

  it('更新搜索历史 — 新词加到最前', () => {
    const suggester = new SearchSuggester();
    suggester.setSearchHistory(['rust', 'go']);
    const updated = suggester.updateSearchHistory('typescript');
    expect(updated[0]).toBe('typescript');
    expect(updated.length).toBe(3);
  });

  it('搜索历史最多 20 条', () => {
    const suggester = new SearchSuggester();
    for (let i = 0; i < 25; i++) {
      suggester.updateSearchHistory(`query-${i}`);
    }
    expect(suggester.getSearchHistory().length).toBe(20);
  });
});
