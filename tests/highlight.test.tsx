// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderHighlighted } from '../src/ui/highlight';
import type { SearchHighlight } from '../src/shared/types';

describe('renderHighlighted', () => {
  it('(1) 正常高亮单个 token', () => {
    const text = 'Hello World Foo';
    const highlights: SearchHighlight[] = [
      { field: 'title', text: 'World', start: 6, end: 11 },
    ];
    const result = renderHighlighted(text, highlights, 'title');
    expect(result).toEqual(['Hello ', <mark key="h0">World</mark>, ' Foo']);
  });

  it('(2) 多 token 高亮', () => {
    const text = 'rust async runtime';
    const highlights: SearchHighlight[] = [
      { field: 'title', text: 'rust', start: 0, end: 4 },
      { field: 'title', text: 'async', start: 5, end: 10 },
    ];
    const result = renderHighlighted(text, highlights, 'title');
    expect(result).toEqual([<mark key="h0">rust</mark>, ' ', <mark key="h1">async</mark>, ' runtime']);
  });

  it('(3) 重叠区间合并', () => {
    const text = 'abcdefghij';
    const highlights: SearchHighlight[] = [
      { field: 'title', text: 'bcd', start: 1, end: 4 },
      { field: 'title', text: 'cde', start: 2, end: 5 },
    ];
    const result = renderHighlighted(text, highlights, 'title');
    // 重叠合并为 [1,5)
    expect(result).toEqual(['a', <mark key="h0">bcde</mark>, 'fghij']);
  });

  it('(4) 空文本', () => {
    const result = renderHighlighted('', [{ field: 'title', text: 'x', start: 0, end: 1 }], 'title');
    expect(result).toBe('');
  });

  it('(5) 无匹配 field → 返回原文', () => {
    const text = 'Hello World';
    const highlights: SearchHighlight[] = [
      { field: 'excerpt', text: 'World', start: 6, end: 11 },
    ];
    const result = renderHighlighted(text, highlights, 'title');
    expect(result).toBe('Hello World');
  });

  it('(6) 越界区间自动截断', () => {
    const text = 'abc';
    const highlights: SearchHighlight[] = [
      { field: 'title', text: 'abcdef', start: 0, end: 10 },
    ];
    const result = renderHighlighted(text, highlights, 'title');
    expect(result).toEqual([<mark key="h0">abc</mark>]);
  });

  it('(7) 特殊字符在文本中', () => {
    const text = 'a<b>c & "quote"';
    const highlights: SearchHighlight[] = [
      { field: 'title', text: 'b', start: 2, end: 3 },
    ];
    const result = renderHighlighted(text, highlights, 'title');
    expect(result).toEqual(['a<', <mark key="h0">b</mark>, '>c & "quote"']);
  });
});
