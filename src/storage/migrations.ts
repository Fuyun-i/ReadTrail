// ===== 数据库结构定义与迁移 =====
// 对应 architecture.md 第 8 节的 object stores 约定

import type { StoreName } from './db';

/**
 * object store 结构声明：
 * v1 — pages / visits / settings / meta
 * v2 — pages 新增 visitCount 索引（用于"按访问次数排序"走索引而非全量加载）
 * v3 — pages 新增 tags 多值索引（用于"按标签筛选"走索引而非全量加载）
 */
export const STORES: Record<StoreName, { keyPath: string; indexes: Array<{ name: string; keyPath: string | string[] }> }> = {
  pages: {
    keyPath: 'id',
    indexes: [
      { name: 'canonicalUrl', keyPath: 'canonicalUrl' },
      { name: 'domain', keyPath: 'domain' },
      { name: 'lastVisitedAt', keyPath: 'lastVisitedAt' },
      { name: 'visitCount', keyPath: 'visitCount' },
      { name: 'tags', keyPath: 'tags' },
    ],
  },
  visits: {
    keyPath: 'id',
    indexes: [
      { name: 'pageId', keyPath: 'pageId' },
      { name: 'startedAt', keyPath: 'startedAt' },
    ],
  },
  settings: { keyPath: 'id', indexes: [] },
  meta: { keyPath: 'key', indexes: [] },
};

export function applyMigrations(db: IDBDatabase, oldVersion: number, newVersion: number, tx?: IDBTransaction): void {
  // 每个旧版本依次升级到下一个版本，未来加版本时在 switch 中追加
  for (let v = oldVersion; v < newVersion; v++) {
    switch (v) {
      case 0:
        createStoreV1(db);
        break;
      case 1:
        upgradeToV2(tx);
        break;
      case 2:
        upgradeToV3(tx);
        break;
      default:
        throw new Error(`Unknown database version ${v}, cannot migrate from ${oldVersion} to ${newVersion}`);
    }
  }
}

function createStoreV1(db: IDBDatabase): void {
  for (const [name, def] of Object.entries(STORES) as Array<[StoreName, (typeof STORES)[StoreName]]>) {
    const store = db.createObjectStore(name, { keyPath: def.keyPath });
    for (const idx of def.indexes) {
      // v1 建表时包含所有索引（含 v3 的 tags），
      // 这样全新安装直接到最新版本，不需要逐版本迁移
      if (idx.name === 'tags') {
        // tags 是多值索引（MultiEntry），keyPath 是数组
        store.createIndex(idx.name, idx.keyPath, { multiEntry: true });
      } else {
        store.createIndex(idx.name, idx.keyPath);
      }
    }
  }
}

/** v1 → v2：为 pages store 添加 visitCount 索引 */
function upgradeToV2(tx?: IDBTransaction): void {
  if (!tx) return;
  const store = tx.objectStore('pages');
  if (!store.indexNames.contains('visitCount')) {
    store.createIndex('visitCount', 'visitCount');
  }
}

/** v2 → v3：为 pages store 添加 tags 多值索引 */
function upgradeToV3(tx?: IDBTransaction): void {
  if (!tx) return;
  const store = tx.objectStore('pages');
  if (!store.indexNames.contains('tags')) {
    // multiEntry: true 使得 tags: ['rust', 'async'] 的记录
    // 可以通过 index.get('rust') 和 index.get('async') 分别命中
    store.createIndex('tags', 'tags', { multiEntry: true });
  }
}
