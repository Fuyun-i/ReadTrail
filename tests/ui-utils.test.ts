// UI 工具函数测试

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatDate, formatDuration } from '../src/ui/utils';

describe('formatDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('(1) 今天 → 显示「今天 HH:MM」', () => {
    const now = new Date(2026, 5, 15, 14, 30);
    vi.setSystemTime(now);
    const result = formatDate(now.getTime());
    expect(result).toBe('今天 14:30');
  });

  it('(2) 昨天 → 显示日期格式', () => {
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0));
    const yesterday = new Date(2026, 5, 14, 10, 15);
    const result = formatDate(yesterday.getTime());
    expect(result).toBe('2026-06-14');
  });

  it('(3) 更早日期 → 显示完整日期', () => {
    vi.setSystemTime(new Date(2026, 5, 15));
    const old = new Date(2025, 0, 1);
    const result = formatDate(old.getTime());
    expect(result).toBe('2025-01-01');
  });
});

describe('formatDuration', () => {
  it('(4) 0 或负数 → 0s', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-100)).toBe('0s');
  });

  it('(5) 秒级', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(30000)).toBe('30s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('(6) 分钟级', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(90000)).toBe('1m30s');
    expect(formatDuration(600000)).toBe('10m');
  });

  it('(7) 小时级', () => {
    expect(formatDuration(3600000)).toBe('1h');
    expect(formatDuration(3900000)).toBe('1h5m');
    expect(formatDuration(7200000)).toBe('2h');
  });
});
