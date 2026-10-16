// ===== 采集上报（architecture.md 5.3）=====
// 将阅读进度与手动采集请求发送到 Service Worker。

import type { ReadingSnapshot, ExtractedArticle } from '../shared/types';

/** 发送阅读进度（单向，不需要响应） */
export function reportReadingProgress(snapshot: ReadingSnapshot): void {
  try {
    chrome.runtime.sendMessage({ type: 'READING_PROGRESS', payload: snapshot }).catch(() => {
      // SW 正在重启等情况：静默失败，下个周期重试
    });
  } catch {
    // 扩展上下文失效（扩展被更新/卸载），停止发送
  }
}

/** 发送手动采集请求，返回保存结果 */
export async function requestManualCapture(article: ExtractedArticle): Promise<{ ok: boolean; outcome?: unknown; error?: string }> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'MANUAL_CAPTURE_REQUEST',
      payload: article,
    });
    return response ?? { ok: false, error: '无响应' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 监听来自 SW 的触发指令（右键"立即保存此页"） */
export function onManualCaptureTrigger(handler: () => void): () => void {
  const listener = (raw: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
    if (
      typeof raw === 'object' &&
      raw !== null &&
      (raw as { type?: unknown }).type === 'TRIGGER_MANUAL_CAPTURE'
    ) {
      handler();
      sendResponse({ ok: true });
    }
    return false; // 同步处理
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
