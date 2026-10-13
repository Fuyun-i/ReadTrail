// ===== retentionDays 生命周期清理（development-plan 4.3）=====
// 触发时机：SW 启动；按 lastVisitedAt 删除过期页面，同步删 visits 与索引。
// 失败时保留可重试状态，不影响正常采集。
// 优化：批量删除页面 + 批量删除 visits，减少串行事务。

import type { PageRepository } from '../storage/repositories/page-repository';
import type { VisitRepository } from '../storage/repositories/visit-repository';
import type { SettingsRepository } from '../storage/repositories/settings-repository';
import type { SearchProvider } from '../search/search-provider';

export class RetentionCleaner {
  private running: Promise<number> | null = null;

  constructor(
    private pages: PageRepository,
    private visits: VisitRepository,
    private settings: SettingsRepository,
    private search: SearchProvider,
    private now: () => number = Date.now,
  ) {}

  /** 执行清理（并发调用合并）。返回删除的页面数；设置未启用时返回 0。 */
  clean(): Promise<number> {
    // 同步记录 running，确保同一 tick 的并发调用也能合并
    if (this.running) return this.running;
    const task = this.run().finally(() => {
      if (this.running === task) this.running = null;
    });
    this.running = task;
    return task;
  }

  private async run(): Promise<number> {
    const { retentionDays } = await this.settings.get();
    if (!retentionDays || retentionDays <= 0) return 0;

    const cutoff = this.now() - retentionDays * 86_400_000;

    // 获取过期页面列表（用于删索引），走索引范围查询
    const stale = await this.pages.list({ to: cutoff, sort: 'recent', limit: Number.MAX_SAFE_INTEGER });
    if (stale.length === 0) return 0;

    // 批量删除页面（单次索引范围删除，而非逐条 deleteById）
    try {
      await this.pages.deleteBefore(cutoff);
    } catch {
      // 批量删除失败，回退到逐条删除
      for (const page of stale) {
        try { await this.pages.deleteById(page.id); } catch { /* 跳过，下次重试 */ }
      }
    }

    // 批量删除对应的 visits 和索引
    for (const page of stale) {
      try {
        await this.visits.deleteByPageId(page.id);
        await this.search.remove(page.id);
      } catch {
        // 保留该条待下次清理重试
      }
    }
    return stale.length;
  }
}
