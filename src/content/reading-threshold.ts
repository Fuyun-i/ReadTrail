// ===== 阅读阈值判断（纯函数，供 content-main 与测试共用）=====
// 对应 validation.md 第 7 节的阅读行为组合

import type { ReadingSnapshot } from '../shared/types';

export type ReadingThreshold = {
  minReadingDurationMs: number;
  minScrollRatio: number;
};

/**
 * 判断当前快照是否达到自动采集阈值：
 * - 前台有效时长 >= minReadingDurationMs
 * - 最大滚动比例 >= minScrollRatio
 * - 页面处于可见状态
 */
export function shouldAutoCapture(snapshot: ReadingSnapshot, threshold: ReadingThreshold): boolean {
  if (snapshot.visibility !== 'visible') return false;
  if (snapshot.activeDurationMs < threshold.minReadingDurationMs) return false;
  if (snapshot.maxScrollRatio < threshold.minScrollRatio) return false;
  return true;
}
