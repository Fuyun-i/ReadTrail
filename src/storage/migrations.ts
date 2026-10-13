// ===== 数据库结构定义与迁移 =====
// 对应 architecture.md 第 8 节的 object stores 约定

import type { StoreName } from './db';

/**
 * object store 结构声明：
 * v1 — pages / visits / settings / meta
 */
export const STORES: Record<StoreName, { keyPath: string; indexes: Array<{ name: string; keyPath: string | string[] }> }> = {
  pages: {
    keyPath: 'id',
    indexes: [
      { name: 'canonicalUrl', keyPath: 'canonicalUrl' },
      { name: 'domain', keyPath: 'domain' },
      { name: 'lastVisitedAt', keyPath: 'lastVisitedAt' },
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

export function applyMigrations(db: IDBDatabase, oldVersion: number, _newVersion: number): void {
  // 每个旧版本依次升级到下一个版本，未来加版本时在 switch 中追加
  for (let v = oldVersion; v < db.version; v++) {
    switch (v) {
      case 0:
        createStoreV1(db);
        break;
      default:
        break;
    }
  }
}

function createStoreV1(db: IDBDatabase): void {
  for (const [name, def] of Object.entries(STORES) as Array<[StoreName, (typeof STORES)[StoreName]]>) {
    const store = db.createObjectStore(name, { keyPath: def.keyPath });
    for (const idx of def.indexes) {
      store.createIndex(idx.name, idx.keyPath);
    }
  }
}
