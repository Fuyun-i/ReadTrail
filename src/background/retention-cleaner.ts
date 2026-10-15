// ===== retentionDays 生命周期清理（development-plan 4.3）=====
// 触发时机：SW 启动；按 lastVisitedAt 删除过期页面，同步删 visits 与索引。
// 失败时保留可重试状态，不影响正常采集。
// 优化：分批加载过期记录（每批 500 条），避免全量 getAll 导致内存溢出。

import type { PageRepository } from '../storage/repositories/page-repository';
import type { VisitRepository } from '../storage/repositories/visit-repository';
import type { SettingsRepository } from '../storage/repositories/settings-repository';
import type { SearchProvider } from '../search/search-provider';

const CLEAN_BATCH_SIZE = 500;

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
    let totalDeleted = 0;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;

    // 分批加载过期记录并逐批删除，避免一次性全量加载到内存。
    // 不使用 offset：删除后记录不再出现在 to: cutoff 的查询结果中，
    // 每次查询自然返回下一批未删除的过期记录。
    while (true) {
      const batch = await this.pages.list({
        to: cutoff,
        sort: 'recent',
        limit: CLEAN_BATCH_SIZE,
      });
      if (batch.length === 0) break;

      let deletedThisBatch = 0;
      for (const page of batch) {
        // 页面 → visits → 索引 顺序删除；单条失败跳过并继续，不阻塞其他清理
        try {
          await this.pages.deleteById(page.id);
          await this.visits.deleteByPageId(page.id);
          await this.search.remove(page.id);
          totalDeleted++;
          deletedThisBatch++;
        } catch {
          // 保留该条待下次清理重试
        }
      }

      // 连续多批全部删除失败（如磁盘配额满、IDB 只读）→ 放弃，避免无限循环
      if (deletedThisBatch === 0) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
      } else {
        consecutiveFailures = 0;
      }

      // 不足一批说明已到末尾
      if (batch.length < CLEAN_BATCH_SIZE) break;
    }

    return totalDeleted;
  }
}
