// ===== 正文提取（architecture.md 5.2 ArticleExtractor）=====
// 提取顺序：Readability → 语义区域（article/main/[role=main]）→ 可见文本降级。
// 删除 script/style/nav 等噪音节点；正文低于阈值时仍返回结果（由后台决定跳过）。

import type { ExtractedArticle } from '../shared/types';

type ReadabilityModule = {
  parse(): {
    title?: string;
    textContent?: string;
    excerpt?: string;
    byline?: string;
    publishedTime?: string;
  } | null;
};

let readabilityCtor: (new (doc: Document) => ReadabilityModule) | null = null;
let readabilityLoadAttempted = false;

async function getReadability(): Promise<(new (doc: Document) => ReadabilityModule) | null> {
  if (readabilityLoadAttempted) return readabilityCtor;
  readabilityLoadAttempted = true;
  try {
    const mod = (await import('@mozilla/readability')) as unknown as {
      Readability: new (doc: Document) => ReadabilityModule;
    };
    readabilityCtor = mod.Readability ?? null;
  } catch {
    readabilityCtor = null;
  }
  return readabilityCtor;
}

const MIN_TEXT_LENGTH = 120; // 低于此值尝试下一级策略

export async function extractArticle(): Promise<ExtractedArticle> {
  const url = location.href;

  // 1. Readability
  const Ctor = await getReadability();
  if (Ctor) {
    try {
      const docClone = document.cloneNode(true) as Document;
      const reader = new Ctor(docClone);
      const parsed = reader.parse();
      if (parsed?.textContent) {
        const text = cleanText(parsed.textContent);
        if (text.length >= MIN_TEXT_LENGTH) {
          return {
            url,
            title: parsed.title || document.title,
            text,
            excerpt: parsed.excerpt || makeExcerpt(text),
            author: parsed.byline || undefined,
            publishedAt: parseDate(parsed.publishedTime),
            wordCount: text.length,
            extractionMethod: 'readability',
          };
        }
      }
    } catch {
      // Readability 失败，进入下一级
    }
  }

  // 2. 语义区域
  const semanticRoot =
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.querySelector('[role="main"]');
  if (semanticRoot) {
    const clone = semanticRoot.cloneNode(true) as HTMLElement;
    stripNoise(clone);
    const text = cleanText(clone.textContent ?? '');
    if (text.length >= MIN_TEXT_LENGTH) {
      return {
        url,
        title: document.title,
        text,
        excerpt: makeExcerpt(text),
        wordCount: text.length,
        extractionMethod: 'semantic',
      };
    }
  }

  // 3. 可见文本降级（L-3: 使用 innerText 获取可见文本，避免 cloneNode(true) 的开销）
  const text = cleanText(document.body.innerText ?? document.body.textContent ?? '');

  return {
    url,
    title: document.title,
    text,
    excerpt: makeExcerpt(text),
    wordCount: text.length,
    extractionMethod: 'fallback',
  };
}

/** 移除脚本、样式、广告、导航、Cookie 同意等噪音节点 */
function stripNoise(root: HTMLElement): void {
  const selector = [
    'script', 'style', 'noscript', 'iframe', 'svg',
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    '[class*="cookie" i]', '[id*="cookie" i]', '[class*="consent" i]',
    '[class*="advert" i]', '[class*="ad-" i]', '[class*="-ad" i]',
    '[class*="sidebar" i]', '[class*="comment" i]', '[class*="share" i]',
    '[aria-hidden="true"]',
  ].join(',');
  root.querySelectorAll(selector).forEach((el) => el.remove());
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function makeExcerpt(text: string, max = 160): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd() + '…';
}

function parseDate(raw?: string): number | undefined {
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : ms;
}
