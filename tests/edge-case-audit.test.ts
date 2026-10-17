import { describe, it, expect } from 'vitest';
import { tokenize, tokenizeQuery, QueryParser } from '../src/search/query-parser';
import { canonicalizeUrl, isSensitiveUrl, isBrowserPage, getRegistrableDomain } from '../src/shared/url';
import { formatDate, formatDuration } from '../src/ui/utils';

// ============================================================
// 极端边界测试 — 验证各种极限情况下是否会出问题
// ============================================================

describe('边界测试：tokenize 极端输入', () => {
  it('空字符串', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('单个 CJK 字符', () => {
    const result = tokenize('中');
    expect(result).toContain('中');
    // 单个字符不会产生 bigram
    expect(result.length).toBe(1);
  });

  it('纯标点符号', () => {
    expect(tokenize('！@#￥%……&*（）')).toEqual([]);
  });

  it('纯空格', () => {
    expect(tokenize('     ')).toEqual([]);
  });

  it('超长字符串不崩溃', () => {
    const long = 'a'.repeat(100_000);
    const result = tokenize(long);
    expect(result.length).toBe(1);
    expect(result[0]!.length).toBe(100_000);
  });

  it('超长 CJK 字符串 — bigram 数量正确', () => {
    const long = '中'.repeat(1000);
    const result = tokenize(long);
    // 单字 1000 + bigram 999
    expect(result.length).toBe(1000 + 999);
  });

  it('混合极端：CJK + 英文 + 数字 + 标点', () => {
    const result = tokenize('Hello世界123！@#');
    expect(result).toContain('hello');
    expect(result).toContain('世');
    expect(result).toContain('界');
    expect(result).toContain('世界');
    expect(result).toContain('123');
  });

  it('交替 CJK 和英文（bigram 不跨语言）', () => {
    const result = tokenize('a中b');
    expect(result).toContain('a');
    expect(result).toContain('中');
    expect(result).toContain('b');
    // 不应产生 'a中' 或 '中b' 的 bigram
    expect(result).not.toContain('a中');
    expect(result).not.toContain('中b');
  });
});

describe('边界测试：QueryParser 极端输入', () => {
  const parser = new QueryParser();

  it('空查询', async () => {
    const result = await parser.parse('');
    expect(result.text).toBe('');
    expect(result.from).toBeUndefined();
    expect(result.domains).toBeUndefined();
  });

  it('只有空格', async () => {
    const result = await parser.parse('   ');
    expect(result.text).toBe('');
  });

  it('只有 domain: 操作符，无搜索词', async () => {
    const result = await parser.parse('domain:example.com');
    expect(result.text).toBe('');
    expect(result.domains).toEqual(['example.com']);
  });

  it('只有 tag: 操作符，无搜索词', async () => {
    const result = await parser.parse('tag:rust');
    expect(result.text).toBe('');
    expect(result.tags).toEqual(['rust']);
  });

  it('只有 NOT 排除词', async () => {
    const result = await parser.parse('-rust');
    expect(result.excludeTerms).toEqual(['rust']);
  });

  it('只有时间短语', async () => {
    const result = await parser.parse('昨天');
    expect(result.from).toBeDefined();
    expect(result.to).toBeDefined();
  });

  it('多个 domain: 操作符', async () => {
    const result = await parser.parse('domain:a.com domain:b.com rust');
    expect(result.domains).toEqual(['a.com', 'b.com']);
    expect(result.text).toContain('rust');
  });

  it('嵌套引号处理', async () => {
    const result = await parser.parse('"hello "world""');
    // 应至少提取一个短语
    expect(result.phrases).toBeDefined();
    expect(result.phrases!.length).toBeGreaterThan(0);
  });

  it('连续 OR 操作符', async () => {
    const result = await parser.parse('rust OR OR go');
    expect(result.orGroups).toBeDefined();
  });

  it('超长查询不崩溃', async () => {
    const long = 'rust '.repeat(1000);
    const result = await parser.parse(long);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('特殊字符查询', async () => {
    const result = await parser.parse('<script>alert("xss")</script>');
    expect(result.text).toBeDefined();
  });

  it('domain: 后跟空格（无域名）', async () => {
    const result = await parser.parse('domain: rust');
    // \S+ 不匹配空格，所以 domain: 不会被提取
    expect(result.text).toContain('domain:');
  });

  it('中文冒号 domain：语法', async () => {
    const result = await parser.parse('domain：example.com rust');
    expect(result.domains).toEqual(['example.com']);
  });
});

describe('边界测试：URL 规范化', () => {
  it('无效 URL 返回原字符串', () => {
    expect(canonicalizeUrl('not-a-url')).toBe('not-a-url');
  });

  it('空字符串', () => {
    expect(canonicalizeUrl('')).toBe('');
  });

  it('移除 hash', () => {
    const result = canonicalizeUrl('https://example.com/page#section');
    expect(result).not.toContain('#section');
  });

  it('移除跟踪参数', () => {
    const result = canonicalizeUrl('https://example.com/page?utm_source=foo&id=123');
    expect(result).not.toContain('utm_source');
    expect(result).toContain('id=123');
  });

  it('保留正常参数', () => {
    const result = canonicalizeUrl('https://example.com/page?q=test&page=2');
    expect(result).toContain('q=test');
    expect(result).toContain('page=2');
  });

  it('ref= 参数被保留（合法导航参数），reference 也不被移除', () => {
    const result1 = canonicalizeUrl('https://example.com?ref=foo');
    expect(result1).toContain('ref=foo');
    const result2 = canonicalizeUrl('https://example.com?reference=foo');
    expect(result2).toContain('reference=foo');
  });

  it('超长 URL 不崩溃', () => {
    const longParam = 'x'.repeat(10000);
    const result = canonicalizeUrl(`https://example.com?p=${longParam}`);
    expect(result).toContain(longParam);
  });
});

describe('边界测试：敏感 URL 检测', () => {
  it('无效 URL 不敏感', () => {
    expect(isSensitiveUrl('not-a-url').sensitive).toBe(false);
  });

  it('空字符串不敏感', () => {
    expect(isSensitiveUrl('').sensitive).toBe(false);
  });

  it('银行域名被检测', () => {
    expect(isSensitiveUrl('https://icbc.com.cn/').sensitive).toBe(true);
  });

  it('银行子域名被检测', () => {
    expect(isSensitiveUrl('https://my.icbc.com.cn/').sensitive).toBe(true);
  });

  it('普通域名不被误判', () => {
    expect(isSensitiveUrl('https://example.com/').sensitive).toBe(false);
  });

  it('foodbank 不被误判为银行', () => {
    expect(isSensitiveUrl('https://foodbank.org/').sensitive).toBe(false);
  });

  it('databank 不被误判为银行', () => {
    expect(isSensitiveUrl('https://databank.com/').sensitive).toBe(false);
  });

  it('登录路径被检测', () => {
    expect(isSensitiveUrl('https://example.com/login').sensitive).toBe(true);
  });

  it('/administrator 不被误判为 /admin', () => {
    expect(isSensitiveUrl('https://example.com/administrator').sensitive).toBe(false);
  });

  it('URL 编码的路径', () => {
    // %2f 是 /
    expect(isSensitiveUrl('https://example.com/%2fadmin').sensitive).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(isSensitiveUrl('https://ICBC.COM.CN/').sensitive).toBe(true);
    expect(isSensitiveUrl('https://PayPal.COM/').sensitive).toBe(true);
  });
});

describe('边界测试：浏览器页面检测', () => {
  it('chrome:// 页面', () => {
    expect(isBrowserPage('chrome://settings')).toBe(true);
  });

  it('edge:// 页面', () => {
    expect(isBrowserPage('edge://settings')).toBe(true);
  });

  it('扩展商店页面', () => {
    expect(isBrowserPage('https://chromewebstore.google.com/')).toBe(true);
  });

  it('普通页面不是浏览器页', () => {
    expect(isBrowserPage('https://example.com/')).toBe(false);
  });

  it('无效 URL 被视为浏览器页', () => {
    expect(isBrowserPage('not-a-url')).toBe(true);
  });
});

describe('边界测试：注册域提取', () => {
  it('普通域名', () => {
    expect(getRegistrableDomain('example.com')).toBe('example.com');
  });

  it('子域名', () => {
    expect(getRegistrableDomain('sub.example.com')).toBe('example.com');
  });

  it('com.cn 双段后缀', () => {
    expect(getRegistrableDomain('sub.example.com.cn')).toBe('example.com.cn');
  });

  it('co.uk 双段后缀', () => {
    expect(getRegistrableDomain('sub.example.co.uk')).toBe('example.co.uk');
  });

  it('单标签', () => {
    expect(getRegistrableDomain('localhost')).toBe('localhost');
  });

  it('空字符串', () => {
    expect(getRegistrableDomain('')).toBe('');
  });
});

describe('边界测试：formatDate / formatDuration', () => {
  it('formatDuration 零', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formatDuration 负数', () => {
    expect(formatDuration(-1000)).toBe('0s');
  });

  it('formatDuration 超大值', () => {
    const result = formatDuration(Number.MAX_SAFE_INTEGER);
    expect(result).toContain('h');
  });

  it('formatDate 有效时间戳', () => {
    const result = formatDate(Date.now());
    expect(result).toContain('今天');
  });
});
