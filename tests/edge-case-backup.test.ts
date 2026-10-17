import { describe, it, expect } from 'vitest';
import { validatePageRecord } from '../src/background/backup-service';
import { SearchSuggester } from '../src/search/search-suggester';

// ============================================================
// 备份导入极端边界测试
// ============================================================

describe('边界测试：validatePageRecord 极端输入', () => {
  it('null 输入抛异常', () => {
    expect(() => validatePageRecord(null)).toThrow();
  });

  it('undefined 输入抛异常', () => {
    expect(() => validatePageRecord(undefined)).toThrow();
  });

  it('空对象抛异常（缺少必需字段）', () => {
    expect(() => validatePageRecord({})).toThrow();
  });

  it('最小合法记录', () => {
    const record = validatePageRecord({ url: 'https://a.com', title: 'T', text: 'B' });
    expect(record.url).toBe('https://a.com');
    expect(record.title).toBe('T');
    expect(record.text).toBe('B');
    expect(record.id).toBeDefined();
    expect(record.visitCount).toBe(1); // 默认值
  });

  it('负数 visitCount 被拒绝', () => {
    expect(() => validatePageRecord({ url: 'a', title: 't', text: 'b', visitCount: -1 })).toThrow();
  });

  it('maxScrollRatio > 1 被拒绝', () => {
    expect(() => validatePageRecord({ url: 'a', title: 't', text: 'b', maxScrollRatio: 1.5 })).toThrow();
  });

  it('非法时间戳被拒绝', () => {
    expect(() => validatePageRecord({ url: 'a', title: 't', text: 'b', firstVisitedAt: -1 })).toThrow();
    expect(() => validatePageRecord({ url: 'a', title: 't', text: 'b', firstVisitedAt: NaN })).toThrow();
    expect(() => validatePageRecord({ url: 'a', title: 't', text: 'b', firstVisitedAt: Infinity })).toThrow();
  });

  it('tags 数组被正确处理', () => {
    const record = validatePageRecord({ url: 'a', title: 't', text: 'b', tags: ['Rust', 'Async', 'rust'] });
    expect(record.tags).toEqual(['rust', 'async']); // 小写化 + 去重
  });

  it('tags 非数组被忽略', () => {
    const record = validatePageRecord({ url: 'a', title: 't', text: 'b', tags: 'not-array' });
    expect(record.tags).toBeUndefined();
  });

  it('超长正文不崩溃', () => {
    const longText = 'x'.repeat(1_000_000);
    const record = validatePageRecord({ url: 'a', title: 't', text: longText });
    expect(record.text.length).toBe(1_000_000);
  });

  it('id 缺失时自动生成', () => {
    const record = validatePageRecord({ url: 'a', title: 't', text: 'b' });
    expect(record.id).toMatch(/^p_/);
  });

  it('canonicalUrl 缺失时用 url 替代', () => {
    const record = validatePageRecord({ url: 'https://example.com/page', title: 't', text: 'b' });
    expect(record.canonicalUrl).toBe('https://example.com/page');
  });
});

// ============================================================
// 搜索建议器边界测试
// ============================================================

describe('边界测试：SearchSuggester 极端输入', () => {
  it('空前缀返回空', () => {
    const suggester = new SearchSuggester();
    const result = suggester.suggestFromPages([], '');
    expect(result).toEqual([]);
  });

  it('空页面列表返回空', () => {
    const suggester = new SearchSuggester();
    const result = suggester.suggestFromPages([], 'test');
    expect(result).toEqual([]);
  });

  it('超长前缀不崩溃', () => {
    const suggester = new SearchSuggester();
    const longPrefix = 'x'.repeat(10000);
    const result = suggester.suggestFromPages([], longPrefix);
    expect(result).toEqual([]);
  });

  it('搜索历史去重', () => {
    const suggester = new SearchSuggester();
    suggester.updateSearchHistory('rust');
    suggester.updateSearchHistory('go');
    suggester.updateSearchHistory('rust'); // 重复
    const history = suggester.getSearchHistory();
    expect(history).toEqual(['rust', 'go']); // rust 移到最前，不重复
  });

  it('空查询不更新历史', () => {
    const suggester = new SearchSuggester();
    suggester.updateSearchHistory('');
    const history = suggester.getSearchHistory();
    expect(history).not.toContain('');
  });

  it('搜索历史上限 20 条', () => {
    const fresh = new SearchSuggester();
    for (let i = 0; i < 30; i++) {
      fresh.updateSearchHistory(`query-${i}`);
    }
    const history = fresh.getSearchHistory();
    expect(history.length).toBe(20);
    expect(history[0]).toBe('query-29');
  });
});
