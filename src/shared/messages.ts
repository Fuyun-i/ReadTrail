// ===== 消息协议（architecture.md 5.3 / 第 6 节）=====

import type {
  CaptureCandidate,
  ExtractedArticle,
  ReadingSnapshot,
  SearchInput,
  SearchResult,
  UserSettings,
  PageRecord,
  SearchHealth,
  ExportOptions,
  ImportOptions,
  ImportReport,
  ValidationResult,
} from './types';

type TagSummary = { tag: string; count: number };

/** Content Script → Service Worker */
export type ContentToWorkerMessage =
  | { type: 'READING_PROGRESS'; payload: ReadingSnapshot }
  | { type: 'MANUAL_CAPTURE_REQUEST'; payload: ExtractedArticle };

/** New Tab / 任意扩展页 → Service Worker */
export type WorkerMessage =
  | { type: 'CAPTURE_CANDIDATE'; payload: CaptureCandidate }
  | { type: 'SEARCH'; requestId: string; payload: SearchInput }
  | { type: 'GET_PAGE'; requestId: string; payload: { pageId: string } }
  | { type: 'DELETE_PAGE'; requestId: string; payload: { pageId: string } }
  | { type: 'LIST_PAGES'; requestId: string; payload?: { offset?: number; limit?: number } }
  | { type: 'GET_SETTINGS'; requestId: string }
  | { type: 'UPDATE_SETTINGS'; requestId: string; payload: Partial<UserSettings> }
  | { type: 'REBUILD_INDEX'; requestId: string }
  | { type: 'INDEX_HEALTH'; requestId: string }
  | { type: 'EXPORT_JSON'; requestId: string; payload?: ExportOptions }
  | { type: 'EXPORT_MARKDOWN'; requestId: string; payload?: { pageIds?: string[] } }
  | { type: 'IMPORT_JSON'; requestId: string; payload: { data: unknown; options?: ImportOptions } }
  | { type: 'CLEAR_ALL'; requestId: string }
  | { type: 'CLEAR_BEFORE'; requestId: string; payload: { before: number } }
  | { type: 'GET_TAGS'; requestId: string }
  | { type: 'UPDATE_TAGS'; requestId: string; payload: { pageId: string; tags: string[] } }
  | { type: 'GET_SEARCH_HISTORY'; requestId: string }
  | { type: 'CLEAR_SEARCH_HISTORY'; requestId: string }
  | { type: 'GET_RELATED'; requestId: string; payload: { pageId: string } }
  /** 打开（或激活）独立记录库；可携带查询与目标分区（popup → SW） */
  | { type: 'OPEN_LIBRARY'; requestId?: string; payload?: { query?: string; section?: 'search' | 'history' | 'settings' } };

export type WorkerError = {
  code: string;
  message: string;
  details?: unknown;
};

export type WorkerResponse<T = unknown> = {
  requestId: string;
  ok: boolean;
  data?: T;
  error?: WorkerError;
};

// 各消息对应的 data 类型映射，供 UI 侧获得类型化响应
export interface WorkerResponseMap {
  SEARCH: SearchResult[];
  GET_PAGE: PageRecord;
  DELETE_PAGE: { deleted: boolean };
  LIST_PAGES: PageRecord[];
  GET_SETTINGS: UserSettings;
  UPDATE_SETTINGS: { settings: UserSettings; validation: ValidationResult };
  REBUILD_INDEX: { rebuilt: number };
  INDEX_HEALTH: SearchHealth;
  EXPORT_JSON: { downloaded: boolean };
  EXPORT_MARKDOWN: { downloaded: boolean };
  IMPORT_JSON: ImportReport;
  CLEAR_ALL: { cleared: boolean };
  CLEAR_BEFORE: { cleared: number };
  OPEN_LIBRARY: { opened: boolean };
  GET_TAGS: TagSummary[];
  UPDATE_TAGS: { page: PageRecord };
  GET_SEARCH_HISTORY: Array<{ query: string; timestamp: number }>;
  CLEAR_SEARCH_HISTORY: { cleared: boolean };
  GET_RELATED: SearchResult[];
}

export type { TagSummary };

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}
