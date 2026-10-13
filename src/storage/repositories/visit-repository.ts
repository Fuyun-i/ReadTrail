// ===== 访问记录仓库 =====

import type { VisitRecord } from '../../shared/types';
import {
  openDatabase,
  dbGetAll,
  dbGetAllByIndex,
  dbPut,
  dbDelete,
  dbClear,
  dbCountByIndex,
  transactionDone,
  DB_NAME,
  DB_VERSION,
} from '../db';
import { applyMigrations } from '../migrations';

let visitSeq = 0;

export function makeVisitId(prefix = 'v'): string {
  visitSeq = (visitSeq + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${visitSeq.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class VisitRepository {
  private dbPromise: Promise<IDBDatabase>;

  constructor(db?: IDBDatabase) {
    this.dbPromise = db ? Promise.resolve(db) : openDatabase(DB_NAME, DB_VERSION, applyMigrations);
  }

  async create(record: VisitRecord): Promise<void> {
    const db = await this.dbPromise;
    await dbPut(db, 'visits', record);
  }

  async listByPageId(pageId: string): Promise<VisitRecord[]> {
    const db = await this.dbPromise;
    const records = await dbGetAllByIndex<VisitRecord>(db, 'visits', 'pageId', pageId);
    return records.sort((a, b) => a.startedAt - b.startedAt);
  }

  /** 获取全部访问记录（用于备份导出，单次 getAll 替代 N+1 查询） */
  async listAll(): Promise<VisitRecord[]> {
    const db = await this.dbPromise;
    return dbGetAll<VisitRecord>(db, 'visits');
  }

  /** 按 pageId 计数（使用索引 count，不加载记录数据） */
  async countByPageId(pageId: string): Promise<number> {
    const db = await this.dbPromise;
    return dbCountByIndex(db, 'visits', 'pageId', pageId);
  }

  /** 按 pageId 批量删除（单事务游标遍历，替代逐条独立事务） */
  async deleteByPageId(pageId: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('visits', 'readwrite');
    const index = tx.objectStore('visits').index('pageId');
    await new Promise<void>((resolve, reject) => {
      const cursorReq = index.openKeyCursor(pageId);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          tx.objectStore('visits').delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error('cursor error'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('tx error'));
      tx.onabort = () => reject(tx.error ?? new Error('tx aborted'));
    });
  }

  async deleteAll(): Promise<void> {
    const db = await this.dbPromise;
    await dbClear(db, 'visits');
  }
}
