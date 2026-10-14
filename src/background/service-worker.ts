// ===== Service Worker 入口 =====
// 装配：仓库 / 搜索 / 隐私 / 协调器 / 路由 / 右键菜单 / 标签页事件

import type { WorkerMessage, WorkerResponse } from '../shared/messages';
import type { CaptureCandidate, PageRecord, ExportOptions, SearchInput } from '../shared/types';
import { AppError } from '../shared/errors';
import { PageRepository } from '../storage/repositories/page-repository';
import { VisitRepository } from '../storage/repositories/visit-repository';
import { SettingsRepository } from '../storage/repositories/settings-repository';
import { FlexSearchProvider } from '../search/flex-search-provider';
import { QueryParser } from '../search/query-parser';
import { PrivacyPolicy } from './privacy-policy';
import { CaptureCoordinator } from './capture-coordinator';
import { MessageRouter } from './message-router';
import { BackupService } from './backup-service';
import { IndexRecovery, rebuildFromDatabase } from './index-recovery';
import { RetentionCleaner } from './retention-cleaner';
import { SearchHistoryRepository } from '../storage/repositories/search-history-repository';

// ---- 辅助函数 ----

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

/** 安全的 Blob → base64 编码，避免 String.fromCharCode spread 栈溢出 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB per chunk
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    // 使用 apply 而非 spread，避免大数组的栈溢出
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/** 通过 chrome.downloads API 直接下载 Blob，不走消息通道，不受消息体大小限制 */
async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const downloadId = await chrome.downloads.download({ url, filename, saveAs: true });
  // 下载完成后释放 blob URL，避免内存泄漏
  const listener = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id === downloadId && delta.state?.current === 'complete') {
      URL.revokeObjectURL(url);
      chrome.downloads.onChanged.removeListener(listener);
    }
  };
  chrome.downloads.onChanged.addListener(listener);
}

// ---- 搜索输入归一化（development-plan 3.2 / 3.3）----
// 1. 用户设置中的 searchResultLimit 作为默认/上限，不在 UI 和 Provider 各自写死。
// 2. QueryParser 解析 domain: 语法与时间短语；解析失败退回原始关键词，不阻断搜索。
// 3. 域名合并规则：独立筛选框与查询内 domain: 取并集（OR）。
// 4. 时间取交集；limit/offset 归一化为非整数安全值。

async function normalizeSearchInput(raw: SearchInput): Promise<SearchInput> {
  const settings = await settingsRepo.get();
  const cap = settings.searchResultLimit;
  const offset = clampInt(raw.offset, 0, Number.MAX_SAFE_INTEGER, 0);

  // QueryParser：解析失败退回原始查询
  let text = typeof raw.query === 'string' ? raw.query : '';
  let parsedFrom: number | undefined;
  let parsedTo: number | undefined;
  const parserDomains: string[] = [];
  const parserTags: string[] = [];
  let parserPhrases: string[] | undefined;
  let parserExcludeTerms: string[] | undefined;
  let parserOrGroups: string[][] | undefined;
  try {
    const parsed = await queryParser.parse(text);
    text = parsed.text;
    parsedFrom = parsed.from;
    parsedTo = parsed.to;
    if (parsed.domains) parserDomains.push(...parsed.domains);
    if (parsed.tags) parserTags.push(...parsed.tags);
    parserPhrases = parsed.phrases;
    parserExcludeTerms = parsed.excludeTerms;
    parserOrGroups = parsed.orGroups;
  } catch {
    // 保留原始 text
  }

  // 域名 OR 合并：筛选框 + 查询内 domain:（去重、小写、去 www 前缀）
  const domains = new Set<string>();
  if (raw.domain?.trim()) domains.add(normalizeDomain(raw.domain));
  for (const d of parserDomains) domains.add(normalizeDomain(d));

  // 时间交集
  const from = raw.from !== undefined && parsedFrom !== undefined
    ? Math.max(raw.from, parsedFrom)
    : raw.from ?? parsedFrom;
  const to = raw.to !== undefined && parsedTo !== undefined
    ? Math.min(raw.to, parsedTo)
    : raw.to ?? parsedTo;

  const searchInput: SearchInput = {
    query: text,
    from,
    to,
    domain: domains.size ? [...domains].join('|') : undefined, // provider 侧按 OR 展开
    limit: clampInt(raw.limit, 1, cap, cap),
    offset,
    sort: raw.sort ?? 'relevance',
  };
  if (raw.source) searchInput.source = raw.source;
  if (parserTags.length) searchInput.tags = parserTags;
  if (parserPhrases) searchInput.phrases = parserPhrases;
  if (parserExcludeTerms) searchInput.excludeTerms = parserExcludeTerms;
  if (parserOrGroups) searchInput.orGroups = parserOrGroups;
  return searchInput;
}

// ---- 单例装配（SW 重启后从 IndexedDB 恢复，不依赖内存状态之外的任何东西）----
const pageRepo = new PageRepository();
const visitRepo = new VisitRepository();
const settingsRepo = new SettingsRepository();
const searchHistoryRepo = new SearchHistoryRepository();
const queryParser = new QueryParser();
const searchProvider = new FlexSearchProvider(async (ids: string[], listOptions) => {
  if (ids.length === 0) {
    // 空查询场景：走索引查询，只取需要的条数，不全量加载
    return pageRepo.list({
      limit: listOptions?.limit ?? 30,
      offset: listOptions?.offset ?? 0,
      sort: listOptions?.sort ?? 'recent',
      from: listOptions?.from,
      to: listOptions?.to,
      domain: listOptions?.domain,
    });
  }
  return pageRepo.getByIds(ids);
});
const privacy = new PrivacyPolicy(() => settingsRepo.get());
const coordinator = new CaptureCoordinator(privacy, pageRepo, visitRepo, settingsRepo, searchProvider);
const backupService = new BackupService(pageRepo, visitRepo, searchProvider);
const router = new MessageRouter();
const indexRecovery = new IndexRecovery(pageRepo, searchProvider);
const retentionCleaner = new RetentionCleaner(pageRepo, visitRepo, settingsRepo, searchProvider);

// ---- 请求持久化存储：防止浏览器在磁盘压力下静默清除 IndexedDB 数据 ----
navigator.storage?.persist?.();

// ---- 启动恢复（fire-and-forget）：SW 每次唤醒先重建索引，搜索请求会等待它完成 ----
void indexRecovery.ensureRecovered();
// ---- 启动清理（fire-and-forget）：按 retentionDays 删除过期数据 ----
void retentionCleaner.clean().catch(() => {});

// ---- 右键菜单 ----
const MENU_SAVE_ID = 'readtrail-save-now';

chrome.runtime.onInstalled.addListener(() => {
  // 安装/更新时请求持久化存储（顶层也已调用，这里确保 onInstalled 时也触发）
  navigator.storage?.persist?.();

  chrome.contextMenus.create({
    id: MENU_SAVE_ID,
    title: 'ReadTrail：立即保存此页',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_SAVE_ID || !tab?.id) return;
  try {
    // 向内容脚本发起手动采集请求；失败（如浏览器页面）时静默忽略
    await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_MANUAL_CAPTURE' });
  } catch {
    // 内容脚本未注入（浏览器页面等），忽略
  }
});

// ---- 统一消息入口 ----
// 内容脚本消息（type 为 READING_PROGRESS / MANUAL_CAPTURE_REQUEST）与
// 扩展页 WorkerMessage（带 requestId）共用 onMessage；按 requestId 区分。
chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  handleAnyMessage(raw, sender).then(sendResponse).catch((err) => {
    sendResponse({ requestId: '', ok: false, error: { code: 'DATABASE_ERROR', message: String(err) } });
  });
  return true; // 异步响应
});

async function handleAnyMessage(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (typeof raw === 'object' && raw !== null) {
    const type = (raw as { type?: unknown }).type;
    const hasRequestId = 'requestId' in (raw as Record<string, unknown>);
    // 带 requestId 的协议消息，或无需 requestId 的 OPEN_LIBRARY，都走路由
    if (typeof type === 'string' && (hasRequestId || type === 'OPEN_LIBRARY')) {
      return router.route(raw);
    }
  }
  return handleRuntimeMessage(raw, sender);
}

async function handleRuntimeMessage(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { code: 'INVALID_MESSAGE', message: '消息必须是对象' } };
  }
  const msg = raw as { type?: string; payload?: unknown };

  switch (msg.type) {
    case 'READING_PROGRESS': {
      // 单向进度消息：暂不处理（保留扩展点），立即返回
      return { ok: true };
    }
    case 'GET_CONTENT_THRESHOLD': {
      // 内容脚本获取用户阈值与记录开关（4.1 / E-021）：只下发必要字段
      const s = await settingsRepo.get();
      return {
        ok: true,
        data: {
          minReadingDurationMs: s.minReadingDurationMs,
          minScrollRatio: s.minScrollRatio,
          minTextLength: s.minTextLength,
          enabled: s.enabled,
        },
      };
    }
    case 'CAPTURE_CANDIDATE': {
      // 内容脚本在阅读达到阈值后自动提交的候选
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload || typeof payload.url !== 'string' || typeof payload.text !== 'string') {
        return { ok: false, error: { code: 'INVALID_MESSAGE', message: '采集候选载荷不完整' } };
      }
      const candidate: CaptureCandidate = {
        url: payload.url as string,
        title: typeof payload.title === 'string' ? (payload.title as string) : '',
        text: payload.text as string,
        excerpt: typeof payload.excerpt === 'string' ? (payload.excerpt as string) : '',
        readingDurationMs: typeof payload.readingDurationMs === 'number' ? (payload.readingDurationMs as number) : 0,
        maxScrollRatio: typeof payload.maxScrollRatio === 'number' ? (payload.maxScrollRatio as number) : 0,
        tabId: sender.tab?.id ?? 0,
        windowId: sender.tab?.windowId ?? 0,
        isIncognito: sender.tab?.incognito ?? false,
        source: 'auto',
      };
      const outcome = await coordinator.handleCandidate(candidate);
      return { ok: true, data: outcome.status };
    }
    case 'MANUAL_CAPTURE_REQUEST': {
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload || typeof payload.url !== 'string' || typeof payload.text !== 'string') {
        return { ok: false, error: { code: 'INVALID_MESSAGE', message: '手动采集载荷不完整' } };
      }
      const tabId = sender.tab?.id ?? 0;
      const windowId = sender.tab?.windowId ?? 0;
      const candidate: CaptureCandidate = {
        url: payload.url as string,
        title: typeof payload.title === 'string' ? (payload.title as string) : '',
        text: payload.text as string,
        excerpt: typeof payload.excerpt === 'string' ? (payload.excerpt as string) : '',
        readingDurationMs: 0, // 手动保存无视阅读阈值
        maxScrollRatio: 0,
        tabId,
        windowId,
        isIncognito: sender.tab?.incognito ?? false,
        source: 'manual',
      };
      const outcome = await coordinator.handleCandidate(candidate);
      return { ok: true, data: outcome };
    }
    default:
      return { ok: false, error: { code: 'INVALID_MESSAGE', message: `未知消息类型: ${String(msg.type)}` } };
  }
}

// ---- 扩展页消息（WorkerMessage 协议）----

async function handleWorkerMessage(message: WorkerMessage): Promise<unknown> {
  switch (message.type) {
    case 'SEARCH': {
      // 等待启动恢复完成后再执行查询：避免重启后短暂搜不到历史记录
      await indexRecovery.ensureRecovered();
      return searchProvider.search(await normalizeSearchInput(message.payload));
    }
    case 'GET_PAGE': {
      const page = await pageRepo.findById(message.payload.pageId);
      if (!page) throw new AppError('PAGE_NOT_FOUND', `页面不存在: ${message.payload.pageId}`);
      return page;
    }
    case 'DELETE_PAGE': {
      await pageRepo.deleteById(message.payload.pageId);
      await visitRepo.deleteByPageId(message.payload.pageId);
      await searchProvider.remove(message.payload.pageId);
      return { deleted: true };
    }
    case 'LIST_PAGES':
      return pageRepo.list(message.payload ?? {});
    case 'GET_SETTINGS':
      return settingsRepo.get();
    case 'UPDATE_SETTINGS': {
      const settings = await settingsRepo.update(message.payload);
      return { settings, validation: settingsRepo.validate(settings) };
    }
    case 'REBUILD_INDEX': {
      const count = await rebuildFromDatabase(pageRepo, searchProvider);
      indexRecovery.markDone(); // 手动重建与启动恢复对齐，避免互相覆盖
      return { rebuilt: count };
    }
    case 'INDEX_HEALTH': {
      const dbCount = await pageRepo.count();
      const health = await searchProvider.health(dbCount);
      // 恢复尚未完成时明确告知处理中状态
      return { ...health, recovering: indexRecovery.status === 'running' };
    }
    case 'EXPORT_JSON': {
      const blob = await backupService.exportJson((message.payload ?? {}) as ExportOptions);
      const filename = `readtrail-backup-${new Date().toISOString().slice(0, 10)}.json`;
      await downloadBlob(blob, filename);
      return { downloaded: true };
    }
    case 'EXPORT_MARKDOWN': {
      const blob = await backupService.exportMarkdown(message.payload?.pageIds);
      const filename = `readtrail-export-${new Date().toISOString().slice(0, 10)}.md`;
      await downloadBlob(blob, filename);
      return { downloaded: true };
    }
    case 'IMPORT_JSON': {
      const blob = new Blob([JSON.stringify(message.payload.data)], { type: 'application/json' });
      return backupService.importJson(blob, message.payload.options);
    }
    case 'CLEAR_ALL': {
      await pageRepo.deleteAll();
      await visitRepo.deleteAll();
      await searchProvider.clear();
      return { cleared: true };
    }
    case 'CLEAR_BEFORE': {
      // 分批删除 lastVisitedAt < before 的页面，同步删 visits 和索引
      const { before } = (message as { payload: { before: number } }).payload;
      let cleared = 0;
      while (true) {
        const batch = await pageRepo.list({ to: before, sort: 'recent', limit: 500 });
        if (batch.length === 0) break;
        for (const page of batch) {
          await pageRepo.deleteById(page.id);
          await visitRepo.deleteByPageId(page.id);
          await searchProvider.remove(page.id);
          cleared++;
        }
        if (batch.length < 500) break;
      }
      return { cleared };
    }
    case 'OPEN_LIBRARY': {
      // 打开独立记录库；已有记录库标签页时激活之（E-013/E-014/E-016）
      const payload = (message as { payload?: { query?: string; section?: 'search' | 'history' | 'settings' } }).payload ?? {};
      const section = payload.section === 'history' || payload.section === 'settings' ? payload.section : 'search';
      const url = new URL(chrome.runtime.getURL('library/library.html'));
      if (section !== 'search') url.searchParams.set('section', section);
      if (payload.query) url.searchParams.set('q', payload.query);

      const tabs = await chrome.tabs.query({ url: `${chrome.runtime.getURL('library/library.html')}*` });
      const existing = tabs.find((t) => !t.incognito && t.id !== undefined);
      if (existing?.id !== undefined) {
        await chrome.tabs.update(existing.id, { active: true, url: url.toString() });
        if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: url.toString() });
      }
      return { opened: true };
    }
    case 'GET_TAGS': {
      return pageRepo.listAllTags();
    }
    case 'UPDATE_TAGS': {
      const { pageId, tags } = message.payload;
      const page = await pageRepo.findById(pageId);
      if (!page) throw new AppError('PAGE_NOT_FOUND', `页面不存在: ${pageId}`);
      // 全量替换标签
      const updated = { ...page, tags: tags.map((t) => t.trim().toLowerCase()).filter(Boolean), updatedAt: Date.now() };
      await pageRepo.overwrite(updated);
      await searchProvider.update(updated);
      return { page: updated };
    }
    case 'GET_SEARCH_HISTORY': {
      return searchHistoryRepo.getAll();
    }
    case 'CLEAR_SEARCH_HISTORY': {
      await searchHistoryRepo.clear();
      return { cleared: true };
    }
    case 'GET_RELATED': {
      const { pageId } = message.payload;
      const page = await pageRepo.findById(pageId);
      if (!page) return [];
      // 基于 title + excerpt 搜索相似文章
      const queryText = (page.title + ' ' + page.excerpt).trim();
      if (!queryText) return [];
      const results = await searchProvider.search({
        query: queryText,
        limit: 6,
        sort: 'relevance',
      });
      // 排除自身，取 top 5
      return results.filter((r) => r.page.id !== pageId).slice(0, 5);
    }
    default:
      throw new AppError('INVALID_MESSAGE', '未处理的消息类型');
  }
}

// WorkerMessage 路由注册（handleAnyMessage 中按 requestId 分发到这里）
router.register('SEARCH', handleWorkerMessage);
router.register('GET_PAGE', handleWorkerMessage);
router.register('DELETE_PAGE', handleWorkerMessage);
router.register('LIST_PAGES', handleWorkerMessage);
router.register('GET_SETTINGS', handleWorkerMessage);
router.register('UPDATE_SETTINGS', handleWorkerMessage);
router.register('REBUILD_INDEX', handleWorkerMessage);
router.register('INDEX_HEALTH', handleWorkerMessage);
router.register('EXPORT_JSON', handleWorkerMessage);
router.register('EXPORT_MARKDOWN', handleWorkerMessage);
router.register('IMPORT_JSON', handleWorkerMessage);
router.register('CLEAR_ALL', handleWorkerMessage);
router.register('CLEAR_BEFORE', handleWorkerMessage);
router.register('OPEN_LIBRARY', handleWorkerMessage);
router.register('GET_TAGS', handleWorkerMessage);
router.register('UPDATE_TAGS', handleWorkerMessage);
router.register('GET_SEARCH_HISTORY', handleWorkerMessage);
router.register('CLEAR_SEARCH_HISTORY', handleWorkerMessage);
router.register('GET_RELATED', handleWorkerMessage);

// 导出给测试使用
export { router, pageRepo, visitRepo, settingsRepo, searchHistoryRepo, searchProvider, coordinator, handleWorkerMessage, normalizeSearchInput, indexRecovery, retentionCleaner };

export type { PageRecord, WorkerResponse };
