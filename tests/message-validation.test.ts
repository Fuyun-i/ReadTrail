// MessageValidation 单元测试
// 覆盖各消息类型的 payload 校验

import { describe, it, expect } from 'vitest';
import { validateMessagePayload } from '../src/background/message-validation';
import { AppError } from '../src/shared/errors';
import type { WorkerMessage } from '../src/shared/messages';

function msg(type: string, payload?: unknown): WorkerMessage {
  return { type, payload } as unknown as WorkerMessage;
}

describe('MessageValidation', () => {
  it('(1) SEARCH payload 缺 query → 不报错（query 是可选的）', () => {
    // query 在 SearchInput 中是可选的，空对象应通过
    expect(() => validateMessagePayload(msg('SEARCH', {}))).not.toThrow();
  });

  it('(2) SEARCH payload query 超长 → 错误', () => {
    const longQuery = 'a'.repeat(501);
    expect(() => validateMessagePayload(msg('SEARCH', { query: longQuery }))).toThrow(AppError);
  });

  it('(3) SEARCH payload 非法 limit → 错误', () => {
    expect(() => validateMessagePayload(msg('SEARCH', { limit: 0 }))).toThrow(AppError);
    expect(() => validateMessagePayload(msg('SEARCH', { limit: 201 }))).toThrow(AppError);
  });

  it('(4) SEARCH 合法 payload 通过', () => {
    expect(() => validateMessagePayload(msg('SEARCH', { query: 'rust async', limit: 30, sort: 'relevance' }))).not.toThrow();
  });

  it('(5) UPDATE_SETTINGS payload 部分字段', () => {
    expect(() => validateMessagePayload(msg('UPDATE_SETTINGS', { enabled: false }))).not.toThrow();
    expect(() => validateMessagePayload(msg('UPDATE_SETTINGS', { searchResultLimit: 50 }))).not.toThrow();
  });

  it('(6) UPDATE_SETTINGS 非法 minScrollRatio → 错误', () => {
    expect(() => validateMessagePayload(msg('UPDATE_SETTINGS', { minScrollRatio: 2 }))).toThrow(AppError);
  });

  it('(7) UPDATE_SETTINGS 非法 enabled 类型 → 错误', () => {
    expect(() => validateMessagePayload(msg('UPDATE_SETTINGS', { enabled: 'yes' }))).toThrow(AppError);
  });

  it('(8) IMPORT_JSON payload 缺 data → 错误', () => {
    expect(() => validateMessagePayload(msg('IMPORT_JSON', {}))).toThrow(AppError);
  });

  it('(9) IMPORT_JSON 合法 payload 通过', () => {
    expect(() => validateMessagePayload(msg('IMPORT_JSON', { data: { pages: [] } }))).not.toThrow();
    expect(() => validateMessagePayload(msg('IMPORT_JSON', { data: { pages: [] }, options: { mode: 'merge' } }))).not.toThrow();
  });

  it('(10) DELETE_PAGE 缺 pageId → 错误', () => {
    expect(() => validateMessagePayload(msg('DELETE_PAGE', {}))).toThrow(AppError);
  });

  it('(11) DELETE_PAGE 合法 payload 通过', () => {
    expect(() => validateMessagePayload(msg('DELETE_PAGE', { pageId: 'page-123' }))).not.toThrow();
  });

  it('(12) DELETE_PAGE 缺 payload → 错误', () => {
    expect(() => validateMessagePayload(msg('DELETE_PAGE'))).toThrow(AppError);
  });

  it('(13) CAPTURE_CANDIDATE 合法 payload 通过', () => {
    expect(() => validateMessagePayload(msg('CAPTURE_CANDIDATE', {
      url: 'https://example.com/page',
      title: 'Example',
      text: 'Some content here that is long enough.',
      readingDurationMs: 15000,
      maxScrollRatio: 0.5,
      tabId: 1,
      windowId: 1,
      isIncognito: false,
      source: 'auto',
    }))).not.toThrow();
  });

  it('(14) CAPTURE_CANDIDATE 缺 text → 错误', () => {
    expect(() => validateMessagePayload(msg('CAPTURE_CANDIDATE', {
      url: 'https://example.com',
      readingDurationMs: 15000,
      maxScrollRatio: 0.5,
      tabId: 1,
      windowId: 1,
      isIncognito: false,
    }))).toThrow(AppError);
  });

  it('(15) EXPORT_JSON 无 payload 通过（可选）', () => {
    expect(() => validateMessagePayload(msg('EXPORT_JSON'))).not.toThrow();
    expect(() => validateMessagePayload(msg('EXPORT_JSON', { includeVisits: true }))).not.toThrow();
  });

  it('(16) CLEAR_BEFORE 缺 payload → 错误', () => {
    expect(() => validateMessagePayload(msg('CLEAR_BEFORE'))).toThrow(AppError);
  });

  it('(17) CLEAR_BEFORE 合法 payload 通过', () => {
    expect(() => validateMessagePayload(msg('CLEAR_BEFORE', { before: Date.now() }))).not.toThrow();
  });

  it('(18) 未知消息类型不报错', () => {
    expect(() => validateMessagePayload(msg('UNKNOWN_TYPE', { anything: true }))).not.toThrow();
  });
});
