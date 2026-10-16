// ===== WorkerMessage payload 运行时校验器（development-plan 5.3）=====
// 为每种消息定义字段级校验；区分错误码；保持幂等行为。

import type { WorkerMessage } from '../shared/messages';
import { AppError } from '../shared/errors';
import type { CaptureCandidate, SearchInput, UserSettings, ExportOptions, ImportOptions } from '../shared/types';

type PayloadValidator = (payload: unknown) => void;

const MAX_QUERY_LENGTH = 500;
const MAX_PAGE_ID_LENGTH = 128;
const MAX_URL_LENGTH = 2048;
const MAX_TEXT_LENGTH = 2_000_000;

function requireObject(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new AppError('INVALID_MESSAGE', 'payload 必须是对象');
  }
  return payload as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, field: string, maxLen: number): string {
  const value = obj[field];
  if (typeof value !== 'string') {
    throw new AppError('INVALID_MESSAGE', `字段 ${field} 必须是字符串`);
  }
  if (value.length > maxLen) {
    throw new AppError('INVALID_MESSAGE', `字段 ${field} 超过长度上限 ${maxLen}`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, field: string, min: number, max: number): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('INVALID_MESSAGE', `字段 ${field} 必须是有限数字`);
  }
  if (value < min || value > max) {
    throw new AppError('INVALID_MESSAGE', `字段 ${field} 超出范围 [${min}, ${max}]`);
  }
  return value;
}

function optionalNumber(obj: Record<string, unknown>, field: string, min: number, max: number): void {
  if (obj[field] !== undefined) requireNumber(obj, field, min, max);
}

function optionalEnum<T extends string>(obj: Record<string, unknown>, field: string, values: readonly T[]): void {
  const value = obj[field];
  if (value === undefined) return;
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new AppError('INVALID_MESSAGE', `字段 ${field} 必须是 ${values.join('/')} 之一`);
  }
}

function optionalStringArray(obj: Record<string, unknown>, field: string, maxItems: number, maxItemLen: number): void {
  const value = obj[field];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > maxItems || value.some((v) => typeof v !== 'string' || (v as string).length > maxItemLen)) {
    throw new AppError('INVALID_MESSAGE', `字段 ${field} 必须是不超过 ${maxItems} 项的字符串数组`);
  }
}

const CAPTURE_CANDIDATE_MAX = {
  text: MAX_TEXT_LENGTH,
  excerpt: 5_000,
  title: 1_000,
};

/** 校验 CaptureCandidate 载荷 */
export function validateCaptureCandidate(payload: unknown): CaptureCandidate {
  const obj = requireObject(payload);
  requireString(obj, 'url', MAX_URL_LENGTH);
  if (typeof obj.title === 'string' && obj.title.length > CAPTURE_CANDIDATE_MAX.title) {
    throw new AppError('INVALID_MESSAGE', `字段 title 超过长度上限`);
  }
  requireString(obj, 'text', CAPTURE_CANDIDATE_MAX.text);
  if (obj.excerpt !== undefined && typeof obj.excerpt !== 'string') {
    throw new AppError('INVALID_MESSAGE', '字段 excerpt 必须是字符串');
  }
  requireNumber(obj, 'readingDurationMs', 0, 24 * 3600 * 1000);
  requireNumber(obj, 'maxScrollRatio', 0, 1);
  // tabId/windowId/isIncognito 由 Service Worker 从 sender.tab 派生，不由客户端提供
  optionalEnum(obj, 'source', ['auto', 'manual'] as const);
  return obj as unknown as CaptureCandidate;
}

/** 校验 SearchInput 载荷 */
export function validateSearchInput(payload: unknown): SearchInput {
  const obj = requireObject(payload);
  if (obj.query !== undefined && typeof obj.query !== 'string') {
    throw new AppError('INVALID_MESSAGE', '字段 query 必须是字符串');
  }
  if (typeof obj.query === 'string' && obj.query.length > MAX_QUERY_LENGTH) {
    throw new AppError('INVALID_MESSAGE', `字段 query 超过长度上限 ${MAX_QUERY_LENGTH}`);
  }
  optionalNumber(obj, 'from', 0, 8.64e15);
  optionalNumber(obj, 'to', 0, 8.64e15);
  if (obj.domain !== undefined) {
    requireString(obj, 'domain', 500);
  }
  optionalEnum(obj, 'source', ['auto', 'manual'] as const);
  optionalNumber(obj, 'limit', 1, 200);
  optionalNumber(obj, 'offset', 0, 1e9);
  optionalEnum(obj, 'sort', ['relevance', 'recent', 'frequent'] as const);
  return obj as unknown as SearchInput;
}

/** 校验 UpdateSettings 载荷（部分更新） */
export function validateSettingsPatch(payload: unknown): Partial<UserSettings> {
  const obj = requireObject(payload);
  if (obj.enabled !== undefined && typeof obj.enabled !== 'boolean') {
    throw new AppError('SETTINGS_INVALID', '字段 enabled 必须是布尔值');
  }
  optionalNumber(obj, 'minReadingDurationMs', 0, 24 * 3600 * 1000);
  optionalNumber(obj, 'minScrollRatio', 0, 1);
  optionalNumber(obj, 'minTextLength', 0, 1_000_000);
  optionalNumber(obj, 'retentionDays', 0.1, 365 * 10);
  optionalNumber(obj, 'searchResultLimit', 1, 200);
  optionalStringArray(obj, 'excludedDomains', 500, 200);
  optionalStringArray(obj, 'includedDomains', 500, 200);
  return obj as Partial<UserSettings>;
}

/** 校验 ExportOptions 载荷 */
export function validateExportOptions(payload: unknown): ExportOptions {
  if (payload === undefined || payload === null) return {};
  const obj = requireObject(payload);
  optionalNumber(obj, 'from', 0, 8.64e15);
  optionalNumber(obj, 'to', 0, 8.64e15);
  if (obj.pageIds !== undefined) {
    if (!Array.isArray(obj.pageIds) || obj.pageIds.length > 10_000) {
      throw new AppError('INVALID_MESSAGE', '字段 pageIds 必须是不超过 10000 项的数组');
    }
    obj.pageIds.forEach((id, i) => {
      if (typeof id !== 'string' || id.length > MAX_PAGE_ID_LENGTH) {
        throw new AppError('INVALID_MESSAGE', `pageIds[${i}] 必须是字符串`);
      }
    });
  }
  if (obj.includeVisits !== undefined && typeof obj.includeVisits !== 'boolean') {
    throw new AppError('INVALID_MESSAGE', '字段 includeVisits 必须是布尔值');
  }
  return obj as ExportOptions;
}

/** 校验 ImportJson 载荷 */
export function validateImportPayload(payload: unknown): { data: unknown; options?: ImportOptions } {
  const obj = requireObject(payload);
  if (!('data' in obj)) {
    throw new AppError('INVALID_MESSAGE', '缺少 data 字段');
  }
  if (obj.options !== undefined) {
    const opts = requireObject(obj.options);
    optionalEnum(opts, 'mode', ['merge', 'replace'] as const);
  }
  return obj as { data: unknown; options?: ImportOptions };
}

/** 按 type 分派的 payload 校验器表（undefined = 无 payload 或免检） */
const VALIDATORS: Record<string, PayloadValidator | undefined> = {
  CAPTURE_CANDIDATE: validateCaptureCandidate,
  SEARCH: validateSearchInput,
  GET_PAGE: (p) => { requireString(requireObject(p), 'pageId', MAX_PAGE_ID_LENGTH); },
  DELETE_PAGE: (p) => { requireString(requireObject(p), 'pageId', MAX_PAGE_ID_LENGTH); },
  LIST_PAGES: (p) => {
    if (p === undefined) return;
    const obj = requireObject(p);
    optionalNumber(obj, 'offset', 0, 1e9);
    optionalNumber(obj, 'limit', 1, 1000);
  },
  UPDATE_SETTINGS: validateSettingsPatch,
  INDEX_HEALTH: () => {},
  REBUILD_INDEX: () => {},
  GET_SETTINGS: () => {},
  EXPORT_JSON: validateExportOptions,
  EXPORT_MARKDOWN: (p) => {
    if (p === undefined) return;
    const obj = requireObject(p);
    if (obj.pageIds !== undefined) {
      if (!Array.isArray(obj.pageIds) || obj.pageIds.length > 10_000) {
        throw new AppError('INVALID_MESSAGE', '字段 pageIds 必须是不超过 10000 项的数组');
      }
    }
  },
  IMPORT_JSON: validateImportPayload,
  CLEAR_ALL: () => {},
  CLEAR_BEFORE: (p) => { requireNumber(requireObject(p), 'before', 0, 8.64e15); },
  OPEN_LIBRARY: (p) => {
    if (p === undefined) return;
    const obj = requireObject(p);
    if (obj.query !== undefined && (typeof obj.query !== 'string' || obj.query.length > MAX_QUERY_LENGTH)) {
      throw new AppError('INVALID_MESSAGE', '字段 query 非法');
    }
    optionalEnum(obj, 'section', ['search', 'history', 'settings'] as const);
  },
  GET_TAGS: () => {},
  UPDATE_TAGS: (p) => {
    const obj = requireObject(p);
    requireString(obj, 'pageId', MAX_PAGE_ID_LENGTH);
    optionalStringArray(obj, 'tags', 100, 50);
  },
  GET_RELATED: (p) => { requireString(requireObject(p), 'pageId', MAX_PAGE_ID_LENGTH); },
};

/** 消息入口统一调用：未知类型在 MessageRouter 已处理；这里校验 payload */
export function validateMessagePayload(message: WorkerMessage): void {
  const validator = VALIDATORS[message.type];
  if (!validator) return; // 未知类型交给 router
  if (!('payload' in message) || message.payload === undefined) {
    // 允许缺省 payload 的消息类型
    if (['SEARCH', 'GET_PAGE', 'DELETE_PAGE', 'UPDATE_SETTINGS', 'IMPORT_JSON', 'CLEAR_BEFORE'].includes(message.type)) {
      throw new AppError('INVALID_MESSAGE', `消息 ${message.type} 缺少 payload`);
    }
    return;
  }
  validator((message as { payload: unknown }).payload);
}

// OPEN_LIBRARY 的 payload 可选，手动放宽 requiresResponse 之外的处理
VALIDATORS.OPEN_LIBRARY = VALIDATORS.OPEN_LIBRARY ?? (() => {});
