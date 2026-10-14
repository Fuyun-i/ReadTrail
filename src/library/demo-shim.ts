// 非扩展环境的演示降级：库页面在普通浏览器（http:// 预览）下没有 chrome.runtime，
// 注入一层演示数据 shim，让页面可浏览、可截图；扩展环境中检测到真实 API 即不生效。
import type { PageRecord, SearchResult, UserSettings, SearchHealth } from '../shared/types';
import type { WorkerMessage } from '../shared/messages';

type OutgoingMessage = Omit<WorkerMessage, 'requestId'> & { requestId?: string };
type ResponseOf<T> = { requestId?: string; ok: boolean; data?: T; error?: { code: string; message: string } };

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 演示记录：模拟「阅读阈值自动捕获」后的典型数据 */
const DEMO_PAGES: PageRecord[] = [
  {
    id: 'demo-1',
    canonicalUrl: 'https://developer.chrome.com/docs/extensions/develop/mv3/intro',
    url: 'https://developer.chrome.com/docs/extensions/develop/mv3/intro',
    title: 'Manifest V3 概览 - Chrome for Developers',
    domain: 'developer.chrome.com',
    text: 'Manifest V3 是 Chrome 扩展平台的最新版本，核心变化包括：Service Worker 取代后台页面、Promise 化的扩展 API、远程托管代码不再允许。MV3 强调隐私、安全与性能，扩展通过声明式内容注入与权限最小化获得用户信任。迁移路径上，大部分后台逻辑可以平移到 Service Worker，需要注意生命周期短、不能常驻内存的限制。',
    excerpt: 'MV3 核心变化：Service Worker 取代后台页面、Promise 化 API、禁止远程托管代码，强调隐私与性能。',
    firstVisitedAt: now - 3 * DAY,
    lastVisitedAt: now - 6 * HOUR,
    visitCount: 4,
    readingDurationMs: 420_000,
    maxScrollRatio: 0.92,
    source: 'auto',
    status: 'captured',
    createdAt: now - 3 * DAY,
    updatedAt: now - 6 * HOUR,
  },
  {
    id: 'demo-2',
    canonicalUrl: 'https://developer.mozilla.org/zh-CN/docs/Web/API/IndexedDB_API',
    url: 'https://developer.mozilla.org/zh-CN/docs/Web/API/IndexedDB_API',
    title: 'IndexedDB API - MDN Web Docs',
    domain: 'developer.mozilla.org',
    text: 'IndexedDB 是浏览器内置的事务型键值数据库，适合存储大量结构化数据。核心概念：对象仓库（Object Store）类似关系表、索引（Index）支持按非主键查询、游标（Cursor）用于遍历。所有读写都在事务中进行，事务按作用域与模式决定并发行为。相比 localStorage，IndexedDB 支持二进制数据与异步接口，是客户端大规模存储的首选。',
    excerpt: '事务型键值数据库：对象仓库、索引、游标三件套，支持二进制与异步，客户端大规模存储首选。',
    author: 'MDN contributors',
    firstVisitedAt: now - 7 * DAY,
    lastVisitedAt: now - DAY,
    visitCount: 6,
    readingDurationMs: 660_000,
    maxScrollRatio: 0.87,
    source: 'auto',
    status: 'captured',
    createdAt: now - 7 * DAY,
    updatedAt: now - DAY,
  },
  {
    id: 'demo-3',
    canonicalUrl: 'https://flexsearch.dev/',
    url: 'https://flexsearch.dev/',
    title: 'FlexSearch — Next-Generation JavaScript Full-Text Search',
    domain: 'flexsearch.dev',
    text: 'FlexSearch 是一套极快的 JavaScript 全文检索引擎，零依赖、内存占用低，支持中文分词、前缀匹配、模糊搜索与布尔查询。它通过压缩词典与缓存策略，在百万级文档上仍保持毫秒级响应。API 设计简单：创建 Index、add 文档、search 查询三步即可集成，适合浏览器本地检索场景。',
    excerpt: '零依赖极速全文检索：支持中文分词与前缀/模糊/布尔查询，百万文档毫秒级响应。',
    author: 'Thomas Wilkerling',
    firstVisitedAt: now - 10 * DAY,
    lastVisitedAt: now - 2 * DAY,
    visitCount: 3,
    readingDurationMs: 300_000,
    maxScrollRatio: 0.64,
    source: 'auto',
    status: 'captured',
    createdAt: now - 10 * DAY,
    updatedAt: now - 2 * DAY,
  },
  {
    id: 'demo-4',
    canonicalUrl: 'https://react.dev/reference/react/hooks',
    url: 'https://react.dev/reference/react/hooks',
    title: 'React Hooks Reference',
    domain: 'react.dev',
    text: 'Hooks 让函数组件拥有状态与副作用能力。常用 Hook：useState 管理本地状态、useEffect 处理副作用、useMemo/useCallback 缓存计算与回调、useContext 跨层级传递。自定义 Hook 以 use 开头，把可复用的状态逻辑从组件中抽离。使用时遵守两条规则：只在顶层调用、只在 React 函数中调用。',
    excerpt: 'useState/useEffect/useMemo 核心三件套，自定义 Hook 抽离可复用状态逻辑。',
    firstVisitedAt: now - 14 * DAY,
    lastVisitedAt: now - 5 * HOUR,
    visitCount: 8,
    readingDurationMs: 540_000,
    maxScrollRatio: 0.78,
    source: 'auto',
    status: 'captured',
    createdAt: now - 14 * DAY,
    updatedAt: now - 5 * HOUR,
  },
  {
    id: 'demo-5',
    canonicalUrl: 'https://esbuild.github.io/',
    url: 'https://esbuild.github.io/',
    title: 'esbuild - The JavaScript Bundler',
    domain: 'esbuild.github.io',
    text: 'esbuild 用 Go 编写，构建速度比传统打包器快 10-100 倍。特性：极致并行的编译管线、原生代码无运行时开销、内置 JS/TS/JSX 支持、Code Splitting 与 Tree Shaking。常见用法是 CLI 配合 --bundle --outdir，或以 JS API 嵌入构建脚本。对中小项目几乎是零配置开箱即用。',
    excerpt: 'Go 编写的极速打包器：比传统工具快 10-100 倍，内置 TS/JSX、Tree Shaking 开箱即用。',
    firstVisitedAt: now - 5 * DAY,
    lastVisitedAt: now - 3 * DAY,
    visitCount: 2,
    readingDurationMs: 180_000,
    maxScrollRatio: 0.51,
    source: 'auto',
    status: 'captured',
    createdAt: now - 5 * DAY,
    updatedAt: now - 3 * DAY,
  },
];

const DEMO_SETTINGS: UserSettings = {
  enabled: true,
  minReadingDurationMs: 10_000,
  minScrollRatio: 0.25,
  minTextLength: 300,
  excludedDomains: [],
  includedDomains: [],
  retentionDays: undefined,
  searchResultLimit: 30,
};

const DEMO_HEALTH: SearchHealth = {
  ready: true,
  databaseCount: DEMO_PAGES.length,
  indexedCount: DEMO_PAGES.length,
  needsRebuild: false,
};

/** 简单关键词打分：标题/域名/摘要/正文命中计数 */
function demoSearch(input: { query: string; domain?: string; sort?: string }): SearchResult[] {
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  let list = DEMO_PAGES.filter((p) => {
    if (input.domain && !p.domain.includes(input.domain)) return false;
    if (!terms.length) return true;
    const haystack = `${p.title} ${p.domain} ${p.excerpt} ${p.text}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });

  const toResult = (page: PageRecord): SearchResult => {
    const matchedFields: SearchResult['matchedFields'] = [];
    const highlights: SearchResult['highlights'] = [];
    for (const term of terms) {
      for (const field of ['title', 'domain', 'excerpt', 'text'] as const) {
        const idx = page[field].toLowerCase().indexOf(term);
        if (idx >= 0) {
          matchedFields.push(field);
          highlights.push({ field, text: page[field].slice(idx, idx + term.length), start: idx, end: idx + term.length });
        }
      }
    }
    return { page, score: matchedFields.length, matchedFields: [...new Set(matchedFields)], highlights };
  };

  const results = list.map(toResult);
  const sort = input.sort ?? 'relevance';
  if (sort === 'recent') {
    results.sort((a, b) => b.page.lastVisitedAt - a.page.lastVisitedAt);
  } else if (sort === 'frequent') {
    results.sort((a, b) => b.page.visitCount - a.page.visitCount);
  } else {
    results.sort((a, b) => b.score - a.score);
  }
  return results;
}

function handle(message: OutgoingMessage): unknown {
  // WorkerMessage 各成员的 payload 形状不同，按 type 收窄后取值
  const payload = (message as { payload?: unknown }).payload;
  switch (message.type) {
    case 'SEARCH':
      return demoSearch(payload as { query: string; domain?: string; sort?: string });
    case 'LIST_PAGES':
      return [...DEMO_PAGES].sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
    case 'GET_PAGE':
      return DEMO_PAGES.find((p) => p.id === (payload as { pageId: string }).pageId);
    case 'DELETE_PAGE': {
      const pageId = (payload as { pageId: string }).pageId;
      const idx = DEMO_PAGES.findIndex((p) => p.id === pageId);
      if (idx >= 0) DEMO_PAGES.splice(idx, 1);
      return { deleted: idx >= 0 };
    }
    case 'GET_SETTINGS':
      return { ...DEMO_SETTINGS };
    case 'UPDATE_SETTINGS':
      Object.assign(DEMO_SETTINGS, payload);
      return { settings: { ...DEMO_SETTINGS }, validation: { valid: true, errors: [] } };
    case 'INDEX_HEALTH':
      return { ...DEMO_HEALTH };
    default:
      throw new Error(`演示模式不支持: ${message.type}`);
  }
}

/** 检测扩展 API 是否可用；不可用则注入演示 shim，返回 true 表示已注入 */
export function installDemoShimIfNeeded(): boolean {
  const w = globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } };
  if (w.chrome?.runtime?.sendMessage) return false;

  w.chrome = {
    runtime: {
      sendMessage: async (message: OutgoingMessage) => {
        try {
          return { requestId: message.requestId, ok: true, data: handle(message) } satisfies ResponseOf<unknown>;
        } catch (err) {
          return {
            requestId: message.requestId,
            ok: false,
            error: { code: 'DEMO_UNSUPPORTED', message: err instanceof Error ? err.message : String(err) },
          } satisfies ResponseOf<never>;
        }
      },
    },
  };
  return true;
}
