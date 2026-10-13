import { describe, it, expect } from 'vitest';
import { tokenize, QueryParser } from '../src/search/query-parser';

describe('tokenize', () => {
  it('英文按词小写输出', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('CJK 输出单字与二元组', () => {
    const tokens = tokenize('异步');
    expect(tokens).toContain('异');
    expect(tokens).toContain('步');
    expect(tokens).toContain('异步');
  });

  it('中英混合：英文词与 CJK 单字/二元组共存', () => {
    const tokens = tokenize('Rust 异步');
    expect(tokens).toContain('rust');
    expect(tokens).toContain('异');
    expect(tokens).toContain('异步');
  });

  it('标点与空白切分', () => {
    const tokens = tokenize('foo, bar；测试');
    expect(tokens).toContain('foo');
    expect(tokens).toContain('bar');
    expect(tokens).toContain('测');
    expect(tokens).toContain('测试');
  });
});

describe('QueryParser.parse', () => {
  const now = Date.UTC(2026, 9, 13, 12, 0, 0);

  it('提取 domain: 语法（中英文前缀，可多次）', async () => {
    const q = await new QueryParser().parse('domain:github.com rust 站点:vitejs.dev', now);
    expect(q.domains).toEqual(['github.com', 'vitejs.dev']);
    expect(q.text).toBe('rust');
  });

  it('「昨天」转为时间下界', async () => {
    const q = await new QueryParser().parse('昨天 typescript', now);
    expect(q.text).toBe('typescript');
    expect(q.from).toBe(now - 1 * 86_400_000);
    expect(q.to).toBeUndefined();
  });

  it('「3天前」相对时间转下界', async () => {
    const q = await new QueryParser().parse('3天前 vite', now);
    expect(q.text).toBe('vite');
    expect(q.from).toBeCloseTo(now - 3 * 86_400_000, 0);
  });

  it('英文时间短语 last week', async () => {
    const q = await new QueryParser().parse('last week flexsearch', now);
    expect(q.text).toBe('flexsearch');
    expect(q.from).toBe(now - 7 * 86_400_000);
  });

  it('无时间短语时 from/to 保持 undefined', async () => {
    const q = await new QueryParser().parse('普通 关键词', now);
    expect(q.from).toBeUndefined();
    expect(q.to).toBeUndefined();
    expect(q.text).toBe('普通 关键词');
  });
});
