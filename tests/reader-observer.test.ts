// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReaderObserver } from '../src/content/reader-observer';

describe('ReaderObserver', () => {
  let observer: ReaderObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
    // jsdom 默认 visibilityState 为 'visible'
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    // 设置基本页面尺寸
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 2000, writable: true, configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 800, writable: true, configurable: true,
    });
    Object.defineProperty(window, 'scrollY', {
      value: 0, writable: true, configurable: true,
    });
    document.title = 'Test Page';
    observer = new ReaderObserver(5000);
  });

  afterEach(() => {
    observer?.stop();
    vi.useRealTimers();
  });

  it('(1) start 后定时 tick 累计 activeDurationMs', async () => {
    observer.start();
    // 推进 5 秒
    vi.advanceTimersByTime(5000);
    const snap = observer.getSnapshot();
    expect(snap.activeDurationMs).toBeGreaterThanOrEqual(4000);
    expect(snap.activeDurationMs).toBeLessThanOrEqual(6000);
  });

  it('(2) visibilitychange hidden → 暂停计时', async () => {
    observer.start();
    // 先累计 5 秒
    vi.advanceTimersByTime(5000);
    const beforeHide = observer.getSnapshot().activeDurationMs;
    expect(beforeHide).toBeGreaterThan(0);

    // 切换到 hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // 再推进 5 秒，activeDurationMs 不应增加
    vi.advanceTimersByTime(5000);
    const afterHide = observer.getSnapshot().activeDurationMs;
    expect(afterHide).toBeCloseTo(beforeHide, -2); // 允许小误差
    expect(observer.getSnapshot().visibility).toBe('hidden');
  });

  it('(3) visibilitychange visible → 恢复计时', async () => {
    observer.start();
    // 切到 hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(5000);

    // 切回 visible
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const beforeResume = observer.getSnapshot().activeDurationMs;

    // 再推进 5 秒，应恢复计时
    vi.advanceTimersByTime(5000);
    const afterResume = observer.getSnapshot().activeDurationMs;
    expect(afterResume).toBeGreaterThan(beforeResume);
    expect(observer.getSnapshot().visibility).toBe('visible');
  });

  it('(4) scroll 事件更新 maxScrollRatio', async () => {
    observer.start();
    // scrollY=600, scrollHeight=2000, innerHeight=800 → ratio=600/1200=0.5
    Object.defineProperty(window, 'scrollY', { value: 600, configurable: true });
    window.dispatchEvent(new Event('scroll'));

    expect(observer.getSnapshot().maxScrollRatio).toBeCloseTo(0.5, 1);

    // 滚到底
    Object.defineProperty(window, 'scrollY', { value: 1200, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(observer.getSnapshot().maxScrollRatio).toBeCloseTo(1, 1);
  });

  it('(5) SPA 路由变化 → 重置计时 + routeVersion++', async () => {
    observer.start();
    vi.advanceTimersByTime(10000);
    expect(observer.getSnapshot().activeDurationMs).toBeGreaterThan(5000);

    // 模拟 SPA 路由变化
    const initialUrl = window.location.href;
    // jsdom 允许通过 history.pushState 改变 URL
    window.history.pushState({}, '', '/new-page');
    // 触发 tick 检测 URL 变化
    vi.advanceTimersByTime(5000);

    const snap = observer.getSnapshot();
    expect(snap.routeVersion).toBe(1);
    expect(snap.activeDurationMs).toBeLessThan(6000); // 重置后只累计了 5 秒
  });

  it('(6) MutationObserver 检测 title 变化', async () => {
    observer.start();
    // 修改 title（同时改变 URL 模拟 SPA 路由）
    window.history.pushState({}, '', '/title-changed');
    document.title = 'New Title';
    // MutationObserver 是异步的，需要等待
    await vi.waitFor(() => {
      vi.advanceTimersByTime(100);
    });
    // 触发 tick 也会检测 URL 变化
    vi.advanceTimersByTime(5000);
    const snap = observer.getSnapshot();
    expect(snap.routeVersion).toBeGreaterThanOrEqual(1);
  });

  it('(7) stop 清理所有监听', async () => {
    observer.start();
    observer.stop();

    // stop 后 scroll 不应更新
    Object.defineProperty(window, 'scrollY', { value: 600, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(observer.getSnapshot().maxScrollRatio).toBe(0);

    // stop 后 visibilitychange 不应影响
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(observer.getSnapshot().visibility).toBe('visible');
  });

  it('(8) getSnapshot 返回正确快照', async () => {
    observer.start();
    vi.advanceTimersByTime(5000);

    const snap = observer.getSnapshot();
    expect(snap.url).toBe(window.location.href);
    expect(snap.title).toBe('Test Page');
    expect(snap.startedAt).toBeGreaterThan(0);
    expect(snap.activeDurationMs).toBeGreaterThan(0);
    expect(snap.maxScrollRatio).toBeGreaterThanOrEqual(0);
    expect(snap.maxScrollRatio).toBeLessThanOrEqual(1);
    expect(snap.visibility).toBe('visible');
    expect(snap.routeVersion).toBe(0);
  });

  it('(9) 无滚动空间页面 maxScrollRatio=1', async () => {
    // 页面高度等于窗口高度 → 无滚动空间
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });

    observer.start();
    window.dispatchEvent(new Event('scroll'));

    expect(observer.getSnapshot().maxScrollRatio).toBe(1);
  });
});
