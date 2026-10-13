import { describe, it, expect } from 'vitest';
import { shouldAutoCapture } from '../src/content/reading-threshold';
import type { ReadingSnapshot } from '../src/shared/types';

function snap(overrides: Partial<ReadingSnapshot> = {}): ReadingSnapshot {
  return {
    url: 'https://example.com/a',
    title: 'A',
    startedAt: 0,
    activeDurationMs: 10_000,
    maxScrollRatio: 0.25,
    visibility: 'visible',
    routeVersion: 0,
    ...overrides,
  };
}

describe('shouldAutoCapture', () => {
  it('达到全部阈值时采集', () => {
    expect(shouldAutoCapture(snap(), { minReadingDurationMs: 10_000, minScrollRatio: 0.25 })).toBe(true);
  });

  it('页面不可见时不采集', () => {
    expect(shouldAutoCapture(snap({ visibility: 'hidden' }), { minReadingDurationMs: 10_000, minScrollRatio: 0.25 })).toBe(false);
  });

  it('时长不足不采集', () => {
    expect(shouldAutoCapture(snap({ activeDurationMs: 9_999 }), { minReadingDurationMs: 10_000, minScrollRatio: 0.25 })).toBe(false);
  });

  it('滚动不足不采集', () => {
    expect(shouldAutoCapture(snap({ maxScrollRatio: 0.24 }), { minReadingDurationMs: 10_000, minScrollRatio: 0.25 })).toBe(false);
  });
});
