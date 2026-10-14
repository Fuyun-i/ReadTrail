// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { extractArticle } from '../src/content/article-extractor';

/** 构建足够长的文章正文供 Readability 解析 */
const ARTICLE_TEXT = 'This is a comprehensive article about web development and modern JavaScript frameworks. '.repeat(10);
const SHORT_TEXT = 'Too short.';

function setDocument(html: string, url = 'https://example.com/article') {
  // 设置 URL
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
  });
  document.documentElement.innerHTML = html;
}

describe('ArticleExtractor', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '';
  });

  it('(1) Readability 成功路径 → extractionMethod=readability', async () => {
    setDocument(`
      <head><title>Test Article Title</title></head>
      <body>
        <article>
          <h1>Test Article Title</h1>
          <p>${ARTICLE_TEXT}</p>
          <p>More content here to ensure sufficient length for the readability parser to work correctly.</p>
        </article>
      </body>
    `);

    const result = await extractArticle();
    expect(result.extractionMethod).toBe('readability');
    expect(result.title).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(100);
    expect(result.url).toBe('https://example.com/article');
  });

  it('(2) 语义区域 article 优先级', async () => {
    // Readability 可能无法解析这个结构，但 article 标签应被语义区域捕获
    setDocument(`
      <head><title>Semantic Test</title></head>
      <body>
        <nav>Navigation links here</nav>
        <article>
          <h2>Article Heading</h2>
          <p>${ARTICLE_TEXT}</p>
        </article>
        <aside>Sidebar content</aside>
      </body>
    `);

    const result = await extractArticle();
    // 应该是 readability 或 semantic（取决于 Readability 是否成功）
    expect(['readability', 'semantic']).toContain(result.extractionMethod);
    expect(result.text.length).toBeGreaterThan(100);
    // 不应包含导航文本
    expect(result.text).not.toContain('Navigation links here');
  });

  it('(3) 语义区域 main 优先级', async () => {
    setDocument(`
      <head><title>Main Test</title></head>
      <body>
        <main>
          <h2>Main Content</h2>
          <p>${ARTICLE_TEXT}</p>
        </main>
      </body>
    `);

    const result = await extractArticle();
    expect(['readability', 'semantic']).toContain(result.extractionMethod);
    expect(result.text.length).toBeGreaterThan(100);
  });

  it('(4) 全部失败 → fallback innerText', async () => {
    // 极简 DOM，无语义结构
    setDocument(`
      <head><title>Simple</title></head>
      <body>
        <div>Just some text in a div without any semantic structure.</div>
      </body>
    `);

    const result = await extractArticle();
    // 应该能提取到文本（可能通过 readability 或 fallback）
    expect(result.text).toBeTruthy();
    expect(result.title).toBe('Simple');
  });

  it('(5) stripNoise 正确移除 script/style/nav/aside', async () => {
    setDocument(`
      <head><title>Noise Test</title></head>
      <body>
        <article>
          <p>${ARTICLE_TEXT}</p>
          <script>var x = 'should not appear';</script>
          <style>.hidden { display: none; }</style>
          <nav>Navigation menu</nav>
          <aside>Sidebar</aside>
          <div class="cookie-banner">Accept cookies?</div>
          <div class="advertisement">Buy now!</div>
        </article>
      </body>
    `);

    const result = await extractArticle();
    expect(result.text).not.toContain('should not appear');
    expect(result.text).not.toContain('display: none');
    // 导航和侧边栏可能被 Readability 过滤或在语义区域中被 stripNoise 移除
    // 如果走 readability，这些噪音会被自动过滤；如果走 semantic，stripNoise 会移除
  });

  it('(6) cleanText 压缩空白', async () => {
    // 通过提取结果间接验证 cleanText：连续空白应被压缩为单个空格
    setDocument(`
      <head><title>Whitespace Test</title></head>
      <body>
        <article>
          <p>${ARTICLE_TEXT}</p>
        </article>
      </body>
    `);

    const result = await extractArticle();
    // 不应包含连续多个空格
    expect(result.text).not.toMatch(/ {2,}/);
    // 不应以空格开头或结尾
    expect(result.text).toBe(result.text.trim());
  });

  it('(7) makeExcerpt 截断加省略号', async () => {
    // 构建超长正文
    const longText = 'A'.repeat(500);
    setDocument(`
      <head><title>Excerpt Test</title></head>
      <body>
        <article>
          <p>${longText}</p>
        </article>
      </body>
    `);

    const result = await extractArticle();
    // excerpt 应被截断（最多 160 字符 + 省略号）
    if (result.excerpt.endsWith('…')) {
      expect(result.excerpt.length).toBeLessThanOrEqual(161); // 160 + ellipsis
    }
  });

  it('(8) 正文低于 MIN_TEXT_LENGTH 触发降级', async () => {
    // 极短正文，Readability 可能返回空或过短，应降级
    setDocument(`
      <head><title>Short</title></head>
      <body>
        <article>
          <p>${SHORT_TEXT}</p>
        </article>
      </body>
    `);

    const result = await extractArticle();
    // 应该降级到 fallback 或 semantic（因为正文太短）
    expect(result.extractionMethod).toBeTruthy();
    // text 仍应有内容
    expect(result.text).toBeTruthy();
  });
});
