// ===== Service Worker 启动索引恢复（development-plan 3.1）=====
// 目标：SW 重启后无需手动重建即可搜索。
// 原则：IndexedDB 为准，内存索引只是可重建缓存。
// 保证：恢复失败不删数据、只置 needsRebuild；并发请求合并为单次重建。
// 优化：分页流式加载，避免全量 getAll 导致内存溢出。

import type { PageRepository } from '../storage/repositories/page-repository';
import type { SearchProvider } from '../search/search-provider';

export type RecoveryState = 'idle' | 'running' | 'done' | 'failed';

/** 流式从数据库重建索引（供 IndexRecovery 和手动 REBUILD_INDEX 共用） */
export async function rebuildFromDatabase(
  pages: PageRepository,
  search: SearchProvider,
  chunkSize = 500,
): Promise<number> {
  await pages.ready();
  return search.rebuildStream(
    (offset, limit) => pages.list({ sort: 'recent', offset, limit }),
    chunkSize,
  );
}

export class IndexRecovery {
  private state: RecoveryState = 'idle';
  private pending: Promise<void> | null = null;

  constructor(
    private pages: PageRepository,
    private search: SearchProvider,
  ) {}

  /** 当前恢复状态（供 health 查询与测试断言） */
  get status(): RecoveryState {
    return this.state;
  }

  /**
   * 触发一次性恢复。已恢复完成则直接返回；进行中则复用同一个 Promise；
   * 失败后允许再次调用重试。
   */
  ensureRecovered(): Promise<void> {
    if (this.state === 'done') return Promise.resolve();
    if (this.pending) return this.pending;

    this.state = 'running';
    this.pending = this.run()
      .then(() => {
        this.state = 'done';
      })
      .catch(() => {
        this.state = 'failed';
        // 恢复失败：不清数据库，标记索引需要重建，等待手动或下次启动重试
        this.search.markNeedsRebuild();
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /** 手动重建后调用：状态与手动操作对齐，避免互相覆盖 */
  markDone(): void {
    this.state = 'done';
    this.pending = null;
  }

  private async run(): Promise<void> {
    await rebuildFromDatabase(this.pages, this.search);
  }
}
