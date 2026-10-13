// ===== 阅读行为观察（architecture.md 5.1 PageObserver）=====
// - 监听 visibilitychange，不可见时暂停有效阅读计时
// - 监听滚动并计算最大滚动比例
// - 监听 SPA 路由（pushState / replaceState / popstate），URL 变化时重置
// - 周期性回调进度，避免只在页面关闭时提交

import type { ReadingSnapshot } from '../shared/types';

export class ReaderObserver {
  private startedAt = Date.now();
  private activeDurationMs = 0;
  private lastTickAt = Date.now();
  private maxScrollRatio = 0;
  private routeVersion = 0;
  private visibility: 'visible' | 'hidden' = document.visibilityState === 'visible' ? 'visible' : 'hidden';
  private currentUrl = location.href;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(snapshot: ReadingSnapshot) => void>();
  private stopped = false;

  constructor(private tickIntervalMs = 5000) {}

  start(): void {
    if (this.timer) return;
    this.lastTickAt = Date.now();

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('popstate', this.onRouteChange);
    wrapHistoryMethod('pushState', this.onRouteChange);
    wrapHistoryMethod('replaceState', this.onRouteChange);

    this.timer = setInterval(this.tick, this.tickIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('popstate', this.onRouteChange);
    this.listeners.clear();
  }

  getSnapshot(): ReadingSnapshot {
    return {
      url: this.currentUrl,
      title: document.title,
      startedAt: this.startedAt,
      activeDurationMs: Math.round(this.activeDurationMs),
      maxScrollRatio: this.maxScrollRatio,
      visibility: this.visibility,
      routeVersion: this.routeVersion,
    };
  }

  onChange(listener: (snapshot: ReadingSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- 内部 ----

  private tick = (): void => {
    const now = Date.now();
    if (this.visibility === 'visible') {
      this.activeDurationMs += now - this.lastTickAt;
    }
    this.lastTickAt = now;

    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  };

  private onVisibilityChange = (): void => {
    const now = Date.now();
    if (this.visibility === 'visible') {
      // 即将离开前台：结算这一段前台时间
      this.activeDurationMs += now - this.lastTickAt;
    }
    this.visibility = document.visibilityState === 'visible' ? 'visible' : 'hidden';
    this.lastTickAt = now;
  };

  private onScroll = (): void => {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - window.innerHeight;
    if (scrollable <= 0) {
      // 页面无滚动空间视为读到底
      this.maxScrollRatio = Math.max(this.maxScrollRatio, 1);
      return;
    }
    const ratio = Math.min(1, Math.max(0, window.scrollY / scrollable));
    this.maxScrollRatio = Math.max(this.maxScrollRatio, ratio);
  };

  private onRouteChange = (): void => {
    if (location.href === this.currentUrl) return;
    // SPA 路由变化：重置计时与滚动，routeVersion 递增
    this.currentUrl = location.href;
    this.startedAt = Date.now();
    this.lastTickAt = Date.now();
    this.activeDurationMs = 0;
    this.maxScrollRatio = 0;
    this.routeVersion++;
  };
}

function wrapHistoryMethod(name: 'pushState' | 'replaceState', notify: () => void): void {
  const original = history[name].bind(history);
  Object.defineProperty(history, name, {
    value: (...args: Parameters<History['pushState']>) => {
      const result = original(...args);
      notify();
      return result;
    },
    configurable: true,
    writable: true,
  });
}
