// ===== 设置仓库（architecture.md 第 10 节）=====

import type { UserSettings, ValidationResult } from '../../shared/types';
import { openDatabase, dbGet, dbPut, DB_NAME, DB_VERSION } from '../db';
import { applyMigrations } from '../migrations';

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  minReadingDurationMs: 10_000,
  minScrollRatio: 0.25,
  minTextLength: 300,
  excludedDomains: [],
  includedDomains: [],
  retentionDays: undefined,
  searchResultLimit: 30,
};

const SETTINGS_KEY = 'app';

/** 合并设置：跳过 undefined 值，避免覆盖默认值 */
function mergeSettings(base: UserSettings, patch: Partial<UserSettings>): UserSettings {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export class SettingsRepository {
  private dbPromise: Promise<IDBDatabase>;
  private cache?: UserSettings;

  constructor(db?: IDBDatabase) {
    this.dbPromise = db ? Promise.resolve(db) : openDatabase(DB_NAME, DB_VERSION, applyMigrations);
  }

  async get(): Promise<UserSettings> {
    if (this.cache) return this.cache;
    const db = await this.dbPromise;
    const stored = await dbGet<{ id: string; settings: UserSettings }>(db, 'settings', SETTINGS_KEY);
    this.cache = stored ? mergeSettings(DEFAULT_SETTINGS, stored.settings) : { ...DEFAULT_SETTINGS };
    return this.cache;
  }

  async update(patch: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.get();
    const next: UserSettings = { ...current, ...patch };
    const validation = this.validate(next);
    if (!validation.valid) {
      const error = new Error(validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '));
      error.name = 'SETTINGS_INVALID';
      throw error;
    }
    const db = await this.dbPromise;
    await dbPut(db, 'settings', { id: SETTINGS_KEY, settings: next });
    this.cache = next;
    return next;
  }

  async reset(): Promise<UserSettings> {
    const db = await this.dbPromise;
    await dbPut(db, 'settings', { id: SETTINGS_KEY, settings: DEFAULT_SETTINGS });
    this.cache = { ...DEFAULT_SETTINGS };
    return this.cache;
  }

  validate(settings: UserSettings): ValidationResult {
    const errors: Array<{ field: string; message: string }> = [];

    if (typeof settings.enabled !== 'boolean') {
      errors.push({ field: 'enabled', message: '必须是布尔值' });
    }
    if (!Number.isFinite(settings.minReadingDurationMs) || settings.minReadingDurationMs < 0) {
      errors.push({ field: 'minReadingDurationMs', message: '必须是非负数字' });
    }
    if (!Number.isFinite(settings.minScrollRatio) || settings.minScrollRatio < 0 || settings.minScrollRatio > 1) {
      errors.push({ field: 'minScrollRatio', message: '必须是 0~1 之间的数字' });
    }
    if (!Number.isFinite(settings.minTextLength) || settings.minTextLength < 0) {
      errors.push({ field: 'minTextLength', message: '必须是非负数字' });
    }
    if (!Array.isArray(settings.excludedDomains) || settings.excludedDomains.some((d) => typeof d !== 'string')) {
      errors.push({ field: 'excludedDomains', message: '必须是字符串数组' });
    }
    if (!Array.isArray(settings.includedDomains) || settings.includedDomains.some((d) => typeof d !== 'string')) {
      errors.push({ field: 'includedDomains', message: '必须是字符串数组' });
    }
    if (settings.retentionDays !== undefined && (!Number.isFinite(settings.retentionDays) || settings.retentionDays <= 0)) {
      errors.push({ field: 'retentionDays', message: '必须是正数字' });
    }
    if (!Number.isFinite(settings.searchResultLimit) || settings.searchResultLimit < 1 || settings.searchResultLimit > 200) {
      errors.push({ field: 'searchResultLimit', message: '必须是 1~200 之间的数字' });
    }

    return { valid: errors.length === 0, errors };
  }
}
