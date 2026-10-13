// ===== 内容脚本入口 =====
// 装配 ReaderObserver + ArticleExtractor + CaptureReporter：
// - 周期上报阅读进度
// - 达到阈值（时长 + 滚动）后提取正文并提交 CAPTURE_CANDIDATE（阈值来自用户设置）
// - 右键触发手动保存

import type { ReadingSnapshot, CaptureCandidate } from '../shared/types';
import { ReaderObserver } from './reader-observer';
import { extractArticle } from './article-extractor';
import { reportReadingProgress, requestManualCapture, onManualCaptureTrigger } from './capture-reporter';
import { isBrowserPage, isSensitiveUrl } from '../shared/url';

// 4.2 敏感 URL 提前过滤：浏览器页/商店页/敏感页不注入采集逻辑（后台保留二次校验）
const urlAllowed = !isBrowserPage(location.href) && !isSensitiveUrl(location.href).sensitive;

const observer = new ReaderObserver(5000);
let lastCapturedRouteVersion = -1; // 每个 SPA 路由只自动保存一次
let capturing = false;

// 用户阈值（development-plan 4.1）：初始默认，随后从后台读取；读取失败保持默认
let threshold = { minReadingDurationMs: 10_000, minScrollRatio: 0.25, minTextLength: 300 };
// 自动记录开关（E-021/E-023）：内容脚本在提取前判断；关闭时不观察、不提取、不提交
let autoEnabled = true;
let thresholdLoaded = false;
let lastConfigFetchAt = 0;
const CONFIG_REFRESH_MS = 30_000; // 开关需新鲜：每 30s 重新拉取（暂停/恢复同步到已打开页面）

async function loadThreshold(): Promise<void> {
  const now = Date.now();
  if (thresholdLoaded && now - lastConfigFetchAt < CONFIG_REFRESH_MS) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONTENT_THRESHOLD' });
    if (response?.ok && response.data) {
      threshold = {
        minReadingDurationMs: Number(response.data.minReadingDurationMs) || threshold.minReadingDurationMs,
        minScrollRatio: Number(response.data.minScrollRatio) || threshold.minScrollRatio,
        minTextLength: Number(response.data.minTextLength) || threshold.minTextLength,
      };
      if (typeof response.data.enabled === 'boolean') autoEnabled = response.data.enabled;
    }
  } catch {
    // SW 重启中：保持当前值，下个周期重试
    return;
  }
  thresholdLoaded = true;
  lastConfigFetchAt = now;
}

/** 检查阈值并在满足时提交候选 */
async function maybeCapture(snapshot: ReadingSnapshot): Promise<void> {
  if (capturing) return;
  if (snapshot.routeVersion === lastCapturedRouteVersion) return;
  if (snapshot.visibility !== 'visible') return;

  // 首次检查前先尝试加载用户阈值与记录开关（后台是最终校验方）
  await loadThreshold();

  // E-021/E-023：自动记录关闭时不观察、不提取、不提交。
  // 注意不标记 routeVersion：恢复开关后当前路由仍应可被采集（时长已重新累计）。
  if (!autoEnabled) return;

  if (snapshot.activeDurationMs < threshold.minReadingDurationMs) return;
  if (snapshot.maxScrollRatio < threshold.minScrollRatio) return;

  capturing = true;
  try {
    const article = await extractArticle();

    // 提前检查 minTextLength：正文太短就不发消息，避免无谓的 SW 通信
    if (article.text.length < threshold.minTextLength) return;

    const candidate: Omit<CaptureCandidate, 'tabId' | 'windowId' | 'isIncognito'> = {
      url: article.url,
      title: article.title,
      text: article.text,
      excerpt: article.excerpt,
      readingDurationMs: snapshot.activeDurationMs,
      maxScrollRatio: snapshot.maxScrollRatio,
      source: 'auto',
    };
    await chrome.runtime.sendMessage({ type: 'CAPTURE_CANDIDATE', payload: candidate });
    // 只有发送成功才标记本路由已保存；SW 重启等失败场景下个周期重试
    lastCapturedRouteVersion = snapshot.routeVersion;
  } catch {
    // SW 重启中：不标记 routeVersion，下个周期自动重试
  } finally {
    capturing = false;
  }
}

function init(): void {
  // 4.2：敏感页 / 浏览器页不启动观察与提取（双保险之一，后台仍会校验）
  if (!urlAllowed) return;

  // 周期进度上报 + 阈值检查
  observer.onChange((snapshot) => {
    reportReadingProgress(snapshot);
    void maybeCapture(snapshot);
  });

  // 页面即将卸载：立即结算一次（关闭标签页前已提交）
  window.addEventListener('pagehide', () => {
    const snapshot = observer.getSnapshot();
    reportReadingProgress(snapshot);
    void maybeCapture(snapshot);
  });

  onManualCaptureTrigger(() => {
    void (async () => {
      const article = await extractArticle();
      const result = await requestManualCapture(article);
      if (!result.ok) {
        console.warn('[ReadTrail] 手动保存失败:', result.error);
      }
    })();
  });

  observer.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
