// ===== 新标签页：与 SW 通信的客户端封装 =====
// 所有请求都带 requestId，响应做运行时校验（validation.md 第 4 节要求）

import type {
  PageRecord,
  SearchResult,
  SearchInput,
  UserSettings,
  SearchHealth,
  ImportReport,
  ValidationResult,
} from '../shared/types';
import type { WorkerMessage } from '../shared/messages';

let seq = 0;

function nextRequestId(): string {
  seq += 1;
  return `req_${Date.now().toString(36)}_${seq}`;
}

/** 分布式 Omit：对联合类型的每个成员分别 omit */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

type OutgoingMessage = DistributiveOmit<WorkerMessage, 'requestId'> & { requestId?: string };

export async function send<T>(message: OutgoingMessage): Promise<T> {
  const requestId = message.requestId ?? nextRequestId();
  const response = (await chrome.runtime.sendMessage({ ...message, requestId })) as {
    requestId?: string;
    ok?: boolean;
    data?: T;
    error?: { code: string; message: string };
  };

  // 响应运行时校验：不信任未知结构
  if (!response || typeof response !== 'object') {
    throw new Error('扩展响应格式错误');
  }
  if (response.requestId && response.requestId !== requestId) {
    throw new Error('扩展响应 requestId 不匹配');
  }
  if (!response.ok) {
    throw new Error(response.error?.message ?? `请求失败 (${response.error?.code ?? 'UNKNOWN'})`);
  }
  return response.data as T;
}

export const api = {
  search(input: SearchInput): Promise<SearchResult[]> {
    return send({ type: 'SEARCH', payload: input });
  },
  listPages(offset = 0, limit = 50): Promise<PageRecord[]> {
    return send({ type: 'LIST_PAGES', payload: { offset, limit } });
  },
  getPage(pageId: string): Promise<PageRecord> {
    return send({ type: 'GET_PAGE', payload: { pageId } });
  },
  deletePage(pageId: string): Promise<{ deleted: boolean }> {
    return send({ type: 'DELETE_PAGE', payload: { pageId } });
  },
  getSettings(): Promise<UserSettings> {
    return send({ type: 'GET_SETTINGS' });
  },
  updateSettings(patch: Partial<UserSettings>): Promise<{ settings: UserSettings; validation: ValidationResult }> {
    return send({ type: 'UPDATE_SETTINGS', payload: patch });
  },
  rebuildIndex(): Promise<{ rebuilt: number }> {
    return send({ type: 'REBUILD_INDEX' });
  },
  indexHealth(): Promise<SearchHealth> {
    return send({ type: 'INDEX_HEALTH' });
  },
  exportJson(): Promise<{ downloaded: boolean }> {
    return send({ type: 'EXPORT_JSON' });
  },
  exportMarkdown(): Promise<{ downloaded: boolean }> {
    return send({ type: 'EXPORT_MARKDOWN' });
  },
  importJson(jsonText: string, mode: 'merge' | 'replace'): Promise<ImportReport> {
    let data: unknown;
    try {
      data = JSON.parse(jsonText);
    } catch {
      return Promise.reject(new Error('文件不是合法 JSON'));
    }
    return send({ type: 'IMPORT_JSON', payload: { data, options: { mode } } });
  },
  clearBefore(before: number): Promise<{ cleared: number }> {
    return send({ type: 'CLEAR_BEFORE', payload: { before } });
  },
  clearAll(): Promise<{ cleared: boolean }> {
    return send({ type: 'CLEAR_ALL' });
  },
  getTags(): Promise<Array<{ tag: string; count: number }>> {
    return send({ type: 'GET_TAGS' });
  },
  updateTags(pageId: string, tags: string[]): Promise<{ page: PageRecord }> {
    return send({ type: 'UPDATE_TAGS', payload: { pageId, tags } });
  },
  getSearchHistory(): Promise<Array<{ query: string; timestamp: number }>> {
    return send({ type: 'GET_SEARCH_HISTORY' });
  },
  clearSearchHistory(): Promise<{ cleared: boolean }> {
    return send({ type: 'CLEAR_SEARCH_HISTORY' });
  },
  getRelated(pageId: string): Promise<SearchResult[]> {
    return send({ type: 'GET_RELATED', payload: { pageId } });
  },
};

/** base64 → 下载文件 */
export function downloadBase64(base64: string, filename: string, mime: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
