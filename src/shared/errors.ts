// 错误码（architecture.md 第 6 节）

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'PAGE_NOT_FOUND'
  | 'DATABASE_ERROR'
  | 'INDEX_ERROR'
  | 'EXTRACTION_ERROR'
  | 'PRIVACY_BLOCKED'
  | 'SETTINGS_INVALID'
  | 'REBUILD_FAILED';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

/** 把任意抛出的值归一化为 { code, message, details } */
export function toErrorInfo(err: unknown): {
  code: ErrorCode;
  message: string;
  details?: unknown;
} {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) {
    // 按错误名称做粗分类
    const name = err.name.toLowerCase();
    if (name.includes('network') || name.includes('fetch')) {
      return { code: 'DATABASE_ERROR', message: err.message };
    }
    if (name.includes('extract')) {
      return { code: 'EXTRACTION_ERROR', message: err.message };
    }
    if (name.includes('index')) {
      return { code: 'INDEX_ERROR', message: err.message };
    }
    if (name.includes('settings')) {
      return { code: 'SETTINGS_INVALID', message: err.message };
    }
    return { code: 'DATABASE_ERROR', message: err.message };
  }
  return { code: 'DATABASE_ERROR', message: String(err) };
}
