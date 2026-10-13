// ===== 阅读行为观察（architecture.md 5.1 PageObserver）=====
// - 监听 visibilitychange，不可见时暂停有效阅读计时
// - 监听滚动并计算最大滚动比例
// - 监听 SPA 路由（pushState / replaceState / popstate / title 变化），URL 变化时重置
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
  private currentTitle = document.title;
  private timer: ReturnType<typeof setInterval> | null = null;
  private titleObserver: MutationObserver | null = null;
  private listeners = new Set<(snapshot: ReadingSnapshot) => void>();
  private stopped = false;

  constructor(private tickIntervalMs = 5000) {}

  start(): void {
    if (this.timer) return;
    this.lastTickAt = Date.now();

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('popstate', this.onRouteChange);

    // SPA 路由检测：MutationObserver 监听 <title> 变化
    // 许多 SPA 框架（React/Vue 等）在路由切换时会更新 document.title，
    // 但可能不触发 popstate（如 pushState），title 变化可作为路由切换的补充信号
    this.titleObserver = new MutationObserver(() => {
      if (document.title !== this.currentTitle) {
        this.currentTitle = document.title;
        // title 变化不一定意味着 URL 变化，但值得检查
        if (location.href !== this.currentUrl) {
          this.onRouteChange();
        }
      }
    });
    this.titleObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    this.timer = setInterval(this.tick, this.tickIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.titleObserver) {
      this.titleObserver.disconnect();
      this.titleObserver = null;
    }
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('popstate', this.onRouteChange);
    this.listeners.clear();
  }

  getSnapshot(): ReadingSnapshot {
    return {
      url: this.currentUrl,
      title: this.currentTitle,
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
    // SPA 路由检测：不钩 history.pushState/replaceState（避免污染页面全局对象），
    // 改为每次 tick 轮询 location.href，pushState/replaceState/popstate 均能覆盖
    if (location.href !== this.currentUrl) {
      this.onRouteChange();
    }
    // title 轮询作为 MutationObserver 的补充（某些框架延迟更新 title）
    if (document.title !== this.currentTitle) {
      this.currentTitle = document.title;
    }

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
    this.currentTitle = document.title;
    this.startedAt = Date.now();
    this.lastTickAt = Date.now();
    this.activeDurationMs = 0;
    this.maxScrollRatio = 0;
    this.routeVersion++;
  };
}
